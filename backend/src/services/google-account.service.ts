import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { encrypt, decrypt } from '../utils/crypto';
import { googleOAuthService } from './google-oauth.service';

/**
 * googleAccountService
 * ---------------------
 * Gestiona la conexion de la cuenta de Google del emprendedor (tenant): estado,
 * inicio del flujo OAuth (connect), procesamiento del callback (guardado cifrado
 * de tokens), desconexion (revoke + borrado), ajustes (toggles) y la obtencion
 * transparente de un access token valido (`ensureAccessToken`, con refresh).
 *
 * Reglas transversales:
 * - TODAS las operaciones se aislan por tenant (`where: { tenant_id }`).
 * - Los tokens (access/refresh) NUNCA se devuelven ni se logean.
 * - El refresh token se guarda SIEMPRE cifrado; el access token tambien.
 */

/** Estado de conexion expuesto al frontend. Nunca incluye tokens. */
export interface GoogleConnectionStatus {
  connected: boolean;
  google_email: string | null;
  online_sessions: boolean;
  save_contacts: boolean;
}

/** Resultado de `getConnectUrl`: URL de autorizacion + state firmado. */
export interface GoogleConnectUrl {
  auth_url: string;
  state: string;
}

/** Toggles editables de la integracion. */
export interface GoogleSettingsUpdate {
  online_sessions?: boolean;
  save_contacts?: boolean;
}

/** Margen (en ms) para considerar un access token "por expirar" y refrescarlo. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/** Vigencia del `state` firmado del flujo OAuth (10 minutos). */
const STATE_TTL_MS = 10 * 60_000;

/**
 * Resuelve el secreto para firmar el `state` OAuth.
 *
 * Reutiliza `JWT_SECRET` (ya requerido por la app) para no introducir otra
 * variable de entorno. El `state` firmado es autocontenido (no requiere
 * almacenamiento en DB) y evita CSRF/tampering: liga el tenant al flujo.
 */
function resolveStateSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new HttpError(
      'JWT_SECRET no esta configurado (requerido para firmar el state OAuth)',
      500,
      'OAUTH_STATE_NOT_CONFIGURED'
    );
  }
  return secret;
}

/** Codifica un objeto como base64url. */
function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Genera un `state` firmado que liga el tenantId al flujo OAuth.
 *
 * Formato: `base64url(payloadJson).base64url(hmacSha256)`.
 * El payload incluye tenant_id, un nonce aleatorio y una marca de tiempo para
 * poder expirar el state.
 */
function signState(tenantId: string): string {
  const payload = {
    tenant_id: tenantId,
    nonce: randomBytes(16).toString('hex'),
    ts: Date.now(),
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', resolveStateSecret())
    .update(payloadB64)
    .digest();
  return `${payloadB64}.${base64url(sig)}`;
}

/**
 * Verifica un `state` firmado y devuelve el tenantId contenido.
 *
 * @throws HttpError 400 si el formato es invalido, la firma no coincide o el
 *   state expiro.
 */
export function verifyState(state: string): { tenant_id: string } {
  const parts = state.split('.');
  if (parts.length !== 2) {
    throw new HttpError('State OAuth invalido', 400, 'OAUTH_STATE_INVALID');
  }

  const [payloadB64, sigB64] = parts;
  const expectedSig = createHmac('sha256', resolveStateSecret())
    .update(payloadB64)
    .digest();
  const providedSig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    throw new HttpError('State OAuth invalido', 400, 'OAUTH_STATE_INVALID');
  }

  let payload: { tenant_id?: string; ts?: number };
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );
  } catch {
    throw new HttpError('State OAuth invalido', 400, 'OAUTH_STATE_INVALID');
  }

  if (!payload.tenant_id || typeof payload.ts !== 'number') {
    throw new HttpError('State OAuth invalido', 400, 'OAUTH_STATE_INVALID');
  }
  if (Date.now() - payload.ts > STATE_TTL_MS) {
    throw new HttpError('State OAuth expirado', 400, 'OAUTH_STATE_EXPIRED');
  }

  return { tenant_id: payload.tenant_id };
}

export const googleAccountService = {
  /**
   * Devuelve el estado de conexion del tenant. NUNCA incluye tokens.
   *
   * `connected` es true solo si existe el registro y su `status` es "connected".
   */
  async getStatus(tenantId: string): Promise<GoogleConnectionStatus> {
    const account = await prisma.googleAccount.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!account || account.status !== 'connected') {
      return {
        connected: false,
        google_email: account?.google_email ?? null,
        online_sessions: account?.online_sessions ?? false,
        save_contacts: account?.save_contacts ?? false,
      };
    }

    return {
      connected: true,
      google_email: account.google_email,
      online_sessions: account.online_sessions,
      save_contacts: account.save_contacts,
    };
  },

  /**
   * Genera la URL de autorizacion de Google Workspace + un `state` firmado que
   * liga el tenant al flujo (para verificarlo en el callback).
   */
  getConnectUrl(tenantId: string): GoogleConnectUrl {
    const state = signState(tenantId);
    const authUrl = googleOAuthService.getWorkspaceAuthorizationUrl(state);
    return { auth_url: authUrl, state };
  },

  /**
   * Procesa el callback OAuth: intercambia el `code` por tokens, obtiene el
   * perfil (email/sub) y hace UPSERT del GoogleAccount del tenant con los tokens
   * CIFRADOS.
   *
   * Manejo del refresh token ausente: Google solo devuelve refresh_token en el
   * primer consentimiento (o con prompt=consent). Si esta vez no llega, se
   * conserva el refresh_token previo cifrado si existe; si no hay ninguno, se
   * lanza un error claro pidiendo reconsentir.
   */
  async handleCallback(tenantId: string, code: string): Promise<GoogleConnectionStatus> {
    const tokenResponse = await googleOAuthService.exchangeCodeForToken(
      code,
      process.env.GOOGLE_CONNECT_REDIRECT_URI
    );

    const profile = await googleOAuthService.getProfile(tokenResponse.access_token);

    const existing = await prisma.googleAccount.findUnique({
      where: { tenant_id: tenantId },
    });

    // Resolver el refresh token cifrado a persistir.
    let encryptedRefreshToken: string;
    const newRefreshToken = (tokenResponse as { refresh_token?: string }).refresh_token;
    if (newRefreshToken) {
      encryptedRefreshToken = encrypt(newRefreshToken);
    } else if (existing?.refresh_token) {
      // Google no devolvio refresh_token nuevo: conservamos el previo cifrado.
      encryptedRefreshToken = existing.refresh_token;
    } else {
      throw new HttpError(
        'Google no devolvio un refresh token y no existe uno previo. ' +
          'Vuelve a conectar concediendo el consentimiento (prompt=consent).',
        400,
        'GOOGLE_REFRESH_TOKEN_MISSING'
      );
    }

    const encryptedAccessToken = encrypt(tokenResponse.access_token);
    const tokenExpiry = new Date(Date.now() + tokenResponse.expires_in * 1000);

    await prisma.googleAccount.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        google_email: profile.email,
        google_sub: profile.id ?? null,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expiry: tokenExpiry,
        scopes: tokenResponse.scope ?? null,
        status: 'connected',
      },
      update: {
        google_email: profile.email,
        google_sub: profile.id ?? null,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expiry: tokenExpiry,
        scopes: tokenResponse.scope ?? null,
        status: 'connected',
      },
    });

    return this.getStatus(tenantId);
  },

  /**
   * Desconecta la cuenta del tenant: revoca el token en Google (best-effort, no
   * lanza si falla) y borra el registro GoogleAccount.
   */
  async disconnect(tenantId: string): Promise<void> {
    const account = await prisma.googleAccount.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!account) {
      // Idempotente: nada que desconectar.
      return;
    }

    // Revocacion best-effort: intentamos revocar el refresh token (o access) sin
    // bloquear el borrado si Google falla.
    try {
      const tokenToRevoke = account.refresh_token
        ? decrypt(account.refresh_token)
        : account.access_token
          ? decrypt(account.access_token)
          : null;
      if (tokenToRevoke) {
        await googleOAuthService.revokeToken(tokenToRevoke);
      }
    } catch {
      // Ignorado: la revocacion es best-effort. No re-lanzamos.
    }

    await prisma.googleAccount.delete({ where: { tenant_id: tenantId } });
  },

  /**
   * Actualiza los toggles (online_sessions / save_contacts) del tenant.
   * Solo modifica los campos provistos. 404 si el tenant no esta conectado.
   */
  async updateSettings(
    tenantId: string,
    settings: GoogleSettingsUpdate
  ): Promise<GoogleConnectionStatus> {
    const account = await prisma.googleAccount.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!account) {
      throw new HttpError('Google no esta conectado', 404, 'GOOGLE_NOT_CONNECTED');
    }

    const data: GoogleSettingsUpdate = {};
    if (typeof settings.online_sessions === 'boolean') {
      data.online_sessions = settings.online_sessions;
    }
    if (typeof settings.save_contacts === 'boolean') {
      data.save_contacts = settings.save_contacts;
    }

    if (Object.keys(data).length > 0) {
      await prisma.googleAccount.update({
        where: { tenant_id: tenantId },
        data,
      });
    }

    return this.getStatus(tenantId);
  },

  /**
   * Devuelve un access token valido (descifrado) para el tenant, o `null` si el
   * tenant NO esta conectado (sin registro o status='revoked').
   *
   * Si el access token expiro (token_expiry <= ahora + margen), lo refresca con
   * el refresh token, re-cifra y persiste el nuevo access_token/token_expiry, y
   * devuelve el nuevo token.
   *
   * Si el refresh falla porque el refresh token fue revocado, marca
   * status='revoked' y devuelve null (no lanza).
   *
   * El token devuelto se usa solo en memoria para llamar a las APIs de Google;
   * nunca se logea.
   */
  async ensureAccessToken(tenantId: string): Promise<string | null> {
    const account = await prisma.googleAccount.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!account || account.status !== 'connected') {
      return null;
    }

    const now = Date.now();
    const expiresAt = account.token_expiry ? account.token_expiry.getTime() : 0;
    const stillValid =
      !!account.access_token && expiresAt - TOKEN_EXPIRY_MARGIN_MS > now;

    if (stillValid) {
      return decrypt(account.access_token as string);
    }

    // Necesitamos refrescar. El refresh_token es obligatorio en el modelo.
    let refreshResponse;
    try {
      const refreshToken = decrypt(account.refresh_token);
      refreshResponse = await googleOAuthService.refreshAccessToken(refreshToken);
    } catch {
      // Refresh fallido (token revocado / invalido): marcar como revoked y
      // tratar como no conectado en llamadas siguientes.
      await prisma.googleAccount.update({
        where: { tenant_id: tenantId },
        data: { status: 'revoked' },
      });
      return null;
    }

    const newAccessToken = refreshResponse.access_token;
    const encryptedAccessToken = encrypt(newAccessToken);
    const tokenExpiry = new Date(Date.now() + refreshResponse.expires_in * 1000);

    await prisma.googleAccount.update({
      where: { tenant_id: tenantId },
      data: {
        access_token: encryptedAccessToken,
        token_expiry: tokenExpiry,
      },
    });

    return newAccessToken;
  },
};
