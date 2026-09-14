import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Utilidad de cifrado para tokens de Google (y otros secretos en reposo).
 *
 * Usa AES-256-GCM (cifrado autenticado): ademas de confidencialidad, el authTag
 * garantiza integridad. Si el ciphertext o el authTag se manipulan, `decrypt`
 * lanza un error en lugar de devolver datos corruptos.
 *
 * Formato de salida (todo base64, auto-contenido):
 *   base64(iv):base64(authTag):base64(ciphertext)
 *
 * La clave proviene de `process.env.GOOGLE_TOKEN_ENC_KEY` y debe representar
 * exactamente 32 bytes (AES-256). Se acepta en base64 o hex.
 *
 * IMPORTANTE: este modulo NUNCA logea el texto plano ni la clave.
 */

/** Algoritmo de cifrado autenticado. */
const ALGORITHM = 'aes-256-gcm';

/** Longitud requerida de la clave en bytes para AES-256. */
const KEY_LENGTH_BYTES = 32;

/** Longitud del IV recomendada para GCM (96 bits). */
const IV_LENGTH_BYTES = 12;

/** Longitud del authTag de GCM en bytes. */
const AUTH_TAG_LENGTH_BYTES = 16;

/** Nombre de la variable de entorno con la clave de cifrado. */
const KEY_ENV_VAR = 'GOOGLE_TOKEN_ENC_KEY';

/**
 * Intenta decodificar la clave desde base64 o hex y valida que sean 32 bytes.
 *
 * @throws Error con mensaje claro si la variable falta o la longitud es invalida.
 */
function resolveKey(): Buffer {
  const raw = process.env[KEY_ENV_VAR];

  if (!raw || raw.trim() === '') {
    throw new Error(
      `${KEY_ENV_VAR} no esta definida. Genera una clave de 32 bytes, ` +
        `p.ej. "openssl rand -base64 32", y agregala al entorno.`
    );
  }

  const candidate = raw.trim();

  // Preferimos hex si la cadena es hex valida de 64 caracteres (32 bytes),
  // de lo contrario intentamos base64.
  const isHex = /^[0-9a-fA-F]+$/.test(candidate) && candidate.length % 2 === 0;

  const decoded = isHex
    ? Buffer.from(candidate, 'hex')
    : Buffer.from(candidate, 'base64');

  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `${KEY_ENV_VAR} debe representar exactamente ${KEY_LENGTH_BYTES} bytes ` +
        `(base64 o hex); se obtuvieron ${decoded.length} bytes. ` +
        `Genera una clave valida, p.ej. "openssl rand -base64 32".`
    );
  }

  return decoded;
}

/**
 * Cifra un texto plano con AES-256-GCM.
 *
 * Genera un IV aleatorio en cada llamada, por lo que dos cifrados del mismo
 * texto producen salidas distintas.
 *
 * @param plaintext Texto a cifrar (p.ej. un refresh token).
 * @returns Cadena auto-contenida `base64(iv):base64(authTag):base64(ciphertext)`.
 * @throws Error si la clave falta o es invalida.
 */
export function encrypt(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_LENGTH_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Descifra una cadena producida por `encrypt`.
 *
 * Valida el authTag (integridad); si el ciphertext o el tag fueron manipulados,
 * lanza un error en lugar de devolver datos.
 *
 * @param ciphertext Cadena en formato `base64(iv):base64(authTag):base64(ciphertext)`.
 * @returns El texto plano original.
 * @throws Error si el formato es invalido, la clave falta/es invalida, o la
 *   verificacion de integridad (authTag) falla.
 */
export function decrypt(ciphertext: string): string {
  const key = resolveKey();

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error(
      'Formato de ciphertext invalido: se esperaba ' +
        'base64(iv):base64(authTag):base64(ciphertext).'
    );
  }

  const [ivB64, authTagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error('Formato de ciphertext invalido: IV con longitud incorrecta.');
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(
      'Formato de ciphertext invalido: authTag con longitud incorrecta.'
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // `final()` lanza si la verificacion de integridad falla.
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}
