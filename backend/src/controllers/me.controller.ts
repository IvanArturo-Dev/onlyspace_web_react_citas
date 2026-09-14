import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { prisma } from '../database/prisma.service';
import { AuditAction } from '@prisma/client';
import { loyaltyService } from '../services/loyalty.service';
import { reviewService } from '../services/review.service';
import { favoriteService } from '../services/favorite.service';
import { businessService } from '../services/business.service';
import { brandingService } from '../services/branding.service';
import { tenantService } from '../services/tenant.service';
import { cancellationPolicyService } from '../services/cancellationPolicy.service';
import { bookingSettingsService } from '../services/bookingSettings.service';
import { notificationService } from '../services/notification.service';
import { isPremiumEffective } from '../services/subscription.service';
import {
  googleAccountService,
  verifyState,
} from '../services/google-account.service';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';
import type {
  LoyaltyProgressView,
  LoyaltyRewardView,
} from '../services/loyalty.service';

/**
 * Branding devuelto a los tenants free: todos los campos en null para que el
 * panel no aplique la personalizacion guardada mientras no sea premium
 * (Property 2). Los datos reales permanecen en la DB.
 */
const DEFAULT_BRANDING = {
  logo_url: null,
  brand_color: null,
  banner_title: null,
  banner_text: null,
  banner_link: null,
} as const;

export const meController = {
  /**
   * Returns the business WhatsApp profile (whatsapp_number, whatsapp_template)
   * for the authenticated admin's tenant. ADMIN-only, tenant-scoped.
   */
  async getBusiness(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const profile = await businessService.getBusinessProfile(tenantId);
      res.status(200).json({ success: true, data: profile });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  /**
   * Updates the business WhatsApp profile (whatsapp_number, whatsapp_template)
   * for the authenticated admin's tenant. ADMIN-only, tenant-scoped. The number
   * is validated (optional +, 8-15 digits) and an empty value clears it.
   */
  async updateBusiness(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { whatsapp_number, whatsapp_template } = req.body;

    try {
      const profile = await businessService.updateBusinessProfile(tenantId, {
        whatsapp_number,
        whatsapp_template,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'tenant',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: profile });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  /**
   * Returns the business data for the authenticated admin's tenant, including
   * the booking code and the public portal path. Always scoped to the tenant
   * carried by the verified JWT.
   */
  async getTenant(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          booking_code: true,
          booking_enabled: true,
          subscription_status: true,
          subscription_expires_at: true,
        },
      });

      if (!tenant) {
        res.status(404).json({
          success: false,
          error: {
            code: 'TENANT_NOT_FOUND',
            message: 'Tenant not found',
          },
        });
        return;
      }

      // Dias restantes de suscripcion/prueba (>=0). Sirve para avisar en la UI
      // "te quedan X dias de prueba". null si no hay fecha de expiracion.
      let daysLeft: number | null = null;
      if (tenant.subscription_expires_at) {
        const ms = new Date(tenant.subscription_expires_at).getTime() - Date.now();
        daysLeft = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
      }

      res.status(200).json({
        success: true,
        data: {
          id: tenant.id,
          name: tenant.name,
          booking_code: tenant.booking_code,
          booking_enabled: tenant.booking_enabled,
          is_premium: isPremiumEffective(tenant),
          subscription_status: tenant.subscription_status,
          subscription_expires_at: tenant.subscription_expires_at,
          days_left: daysLeft,
          portal_path: tenant.booking_code
            ? `/reservar/${tenant.booking_code}`
            : null,
        },
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  /**
   * Updates the business name (`tenant.name`) for the authenticated admin's
   * tenant. ADMIN-only, tenant-scoped, NO premium required (the name is a basic
   * datum any owner can edit). Validated (required, 1..100 after trim). Audited
   * as UPDATE on 'tenant' (matching updateBusiness/updateBranding).
   */
  async updateTenant(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { name } = req.body ?? {};

    try {
      const updated = await tenantService.updateName(tenantId, name);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'tenant',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  /**
   * Returns the appointments booked by the authenticated user, across all
   * tenants, matched by the user's own email (`booked_by_email`). Only the
   * caller's own appointments are ever returned (Property 8); appointments of
   * other clients are never exposed.
   */
  async getMyAppointments(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true },
      });

      if (!user?.email) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const appointments = await prisma.appointment.findMany({
        where: { booked_by_email: user.email },
        orderBy: { start_time: 'desc' },
        include: {
          service: { select: { name: true } },
          tenant: { select: { name: true } },
        },
      });

      const data = appointments.map((appt) => ({
        id: appt.id,
        start_time: appt.start_time,
        end_time: appt.end_time,
        status: appt.status,
        service_name: appt.service?.name ?? null,
        business_name: appt.tenant?.name ?? null,
        // Expose the video-call URL and modality so the client can join an
        // online appointment from "Mis citas" (Requirement 3.2/3.3). The
        // findMany has no root `select`, so both scalar columns are already
        // loaded on each row.
        video_call_url: appt.video_call_url ?? null,
        modality: appt.modality ?? 'in_person',
      }));

      res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  /**
   * Returns the authenticated client's OWN loyalty progress and rewards
   * (Requirement 7.3). Clients book with `booked_by_email`, but loyalty is keyed
   * by `customer_id`, so we resolve the Customer row(s) matching the user's own
   * email WITHIN the user's tenant (scoped by the JWT `tenant_id`). This keeps a
   * client from ever seeing another client's or another tenant's data.
   *
   * If the user has no Customer record in their tenant, an empty progress and
   * rewards payload is returned.
   */
  async getMyLoyalty(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true },
      });

      const emptyPayload = { progress: [] as LoyaltyProgressView[], rewards: [] as LoyaltyRewardView[] };

      if (!user?.email) {
        res.status(200).json({ success: true, data: emptyPayload });
        return;
      }

      // Resolve the caller's customer records within their own tenant only.
      const customers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, email: user.email },
        select: { id: true },
      });

      if (customers.length === 0) {
        res.status(200).json({ success: true, data: emptyPayload });
        return;
      }

      // Aggregate progress and rewards across the caller's customer records in
      // this tenant (usually a single one). Progress is per-program: sum the
      // caller's own counts per program across their customer ids.
      const progressByProgram = new Map<string, LoyaltyProgressView>();
      const rewards: LoyaltyRewardView[] = [];

      for (const customer of customers) {
        const progress = await loyaltyService.progressForCustomer(tenantId, customer.id);
        for (const entry of progress) {
          const existing = progressByProgram.get(entry.program.id);
          if (existing) {
            existing.count += entry.count;
          } else {
            progressByProgram.set(entry.program.id, { ...entry });
          }
        }

        const customerRewards = await loyaltyService.listRewards(tenantId, {
          customerId: customer.id,
        });
        rewards.push(...customerRewards);
      }

      res.status(200).json({
        success: true,
        data: {
          progress: Array.from(progressByProgram.values()),
          rewards,
        },
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  /**
   * Reclama una recompensa del propio cliente (Requirement 2.1, 2.2, 7.1).
   * Como la lealtad se indexa por `customer_id` y el cliente reserva por email,
   * se resuelven los Customer del usuario dentro de SU tenant (patron de
   * getMyLoyalty) y se intenta reclamar la recompensa con cada customer_id: como
   * `loyaltyService.claim` valida por customer_id, una recompensa que no
   * pertenece a ese customer devuelve 404 REWARD_NOT_FOUND. Se itera y se usa el
   * customer que SI la posee; si ninguno la posee (o el usuario no tiene
   * customers) se propaga el 404. Devuelve la recompensa reclamada, con su
   * `claim_code`.
   */
  async claimReward(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const rewardId = req.params.id;

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true },
      });

      if (!user?.email) {
        throw new HttpError('Recompensa no encontrada', 404, 'REWARD_NOT_FOUND');
      }

      const customers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, email: user.email },
        select: { id: true },
      });

      if (customers.length === 0) {
        throw new HttpError('Recompensa no encontrada', 404, 'REWARD_NOT_FOUND');
      }

      // Intenta reclamar con cada customer del usuario. Un 404 significa que la
      // recompensa no es de ese customer: se prueba el siguiente. Cualquier otro
      // error (400/409) es del estado de la recompensa y se propaga tal cual.
      let lastNotFound: HttpError | null = null;
      for (const customer of customers) {
        try {
          const reward = await loyaltyService.claim(tenantId, rewardId, customer.id);
          res.status(200).json({ success: true, data: reward });
          return;
        } catch (error: any) {
          if (error?.statusCode === 404) {
            lastNotFound = error;
            continue;
          }
          throw error;
        }
      }

      // Ningun customer del usuario posee la recompensa.
      throw lastNotFound ?? new HttpError('Recompensa no encontrada', 404, 'REWARD_NOT_FOUND');
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Devuelve las recompensas (cupones) del propio cliente (Requirement 5.1,
   * 5.2, 7.1). Resuelve los Customer del usuario dentro de su tenant y agrega
   * las recompensas de cada uno via `loyaltyService.listRewards`. Cada
   * recompensa incluye status, reward_text, expires_at y claim_code.
   */
  async getMyCoupons(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true },
      });

      if (!user?.email) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const customers = await prisma.customer.findMany({
        where: { tenant_id: tenantId, email: user.email },
        select: { id: true },
      });

      if (customers.length === 0) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const rewards: LoyaltyRewardView[] = [];
      for (const customer of customers) {
        const customerRewards = await loyaltyService.listRewards(tenantId, {
          customerId: customer.id,
        });
        rewards.push(...customerRewards);
      }

      res.status(200).json({ success: true, data: rewards });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Crea o edita la resena de una cita COMPLETED del propio cliente
   * (Requirement 3.1). El body lleva { appointment_id, rating, comment? }. El
   * servicio valida que la cita sea del usuario (por email) y este COMPLETED,
   * y que el rating sea entero 1-5. Aislado por tenant y por usuario.
   */
  async createOrUpdateReview(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { appointment_id, rating, comment } = req.body ?? {};

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true },
      });

      if (!user?.email) {
        throw new HttpError('No puedes acceder a esta cita', 403, 'FORBIDDEN');
      }

      const review = await reviewService.upsertReview(
        tenantId,
        user.email,
        appointment_id,
        rating,
        comment
      );

      res.status(200).json({ success: true, data: review });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Lista las resenas del propio cliente en su tenant (Requirement 3.4). Se
   * resuelve el email del usuario y se delega en `reviewService.getMyReviews`,
   * que solo devuelve resenas de citas reservadas por ese email.
   */
  async getMyReviews(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true },
      });

      if (!user?.email) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const reviews = await reviewService.getMyReviews(tenantId, user.email);
      res.status(200).json({ success: true, data: reviews });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Lista los negocios favoritos del propio usuario (Requirement 4.2). Los
   * favoritos son por usuario (user_id), no por tenant, de modo que el listado
   * cruza todos los negocios que el usuario marco. Nunca expone favoritos de
   * otros usuarios.
   */
  async listFavorites(req: AuthRequest, res: Response): Promise<void> {
    try {
      const favorites = await favoriteService.list(req.user!.id);
      res.status(200).json({ success: true, data: favorites });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Marca/desmarca un negocio como favorito para el propio usuario
   * (Requirement 4.2, toggle idempotente). Valida que el tenant exista (404 si
   * no). Devuelve { favorited: boolean }.
   */
  async toggleFavorite(req: AuthRequest, res: Response): Promise<void> {
    const targetTenantId = req.params.tenantId;

    try {
      const result = await favoriteService.toggle(req.user!.id, targetTenantId);
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Returns the branding fields (logo, brand color, banner) for the
   * authenticated admin's tenant. ADMIN-only, tenant-scoped (Requirement 3.5,
   * 6.2). The data is returned regardless of premium status — premium only
   * gates whether it surfaces. If the tenant is NOT premium (effective), a
   * DEFAULT (empty) branding is returned so the panel does not apply the saved
   * personalization while free (Property 2). The stored data is NOT deleted —
   * reactivating premium restores it.
   */
  async getBranding(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { subscription_status: true, subscription_expires_at: true },
      });

      if (!tenant || !isPremiumEffective(tenant)) {
        res.status(200).json({ success: true, data: DEFAULT_BRANDING });
        return;
      }

      const branding = await brandingService.getBranding(tenantId);
      res.status(200).json({ success: true, data: branding });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Updates the branding fields for the authenticated admin's tenant.
   * ADMIN-only, tenant-scoped. brand_color is validated (hex). Audited.
   */
  async updateBranding(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { logo_url, brand_color, banner_title, banner_text, banner_link } =
      req.body ?? {};
    try {
      const branding = await brandingService.updateBranding(tenantId, {
        logo_url,
        brand_color,
        banner_title,
        banner_text,
        banner_link,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'tenant',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: branding });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Lists the ads owned by the authenticated admin's tenant. ADMIN-only,
   * tenant-scoped (Property 4).
   */
  async listAds(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const ads = await brandingService.listAds(tenantId);
      res.status(200).json({ success: true, data: ads });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Creates an ad for the authenticated admin's tenant. `title` required.
   * ADMIN-only, tenant-scoped. Audited.
   */
  async createAd(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { title, body, image_url, link_url, is_active } = req.body ?? {};
    try {
      const ad = await brandingService.createAd(tenantId, {
        title,
        body,
        image_url,
        link_url,
        is_active,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'advertisement',
        resource_id: ad.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: ad });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Updates an ad owned by the authenticated admin's tenant. The ad must belong
   * to the tenant (else 404 AD_NOT_FOUND). ADMIN-only, tenant-scoped. Audited.
   */
  async updateAd(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { id } = req.params;
    const { title, body, image_url, link_url, is_active } = req.body ?? {};
    try {
      const ad = await brandingService.updateAd(tenantId, id, {
        title,
        body,
        image_url,
        link_url,
        is_active,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'advertisement',
        resource_id: id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: ad });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Deletes an ad owned by the authenticated admin's tenant. The ad must belong
   * to the tenant (else 404 AD_NOT_FOUND). ADMIN-only, tenant-scoped. Audited.
   */
  async deleteAd(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { id } = req.params;
    try {
      await brandingService.deleteAd(tenantId, id);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.DELETE,
        resource_type: 'advertisement',
        resource_id: id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: { id } });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  // --- Google Workspace integration (ADMIN-only, tenant-scoped) -------------
  // These endpoints manage the entrepreneur's Google connection. The role guard
  // (requireAdmin) is applied at the route level, so an ASSISTANT/CLIENT gets a
  // 403 before reaching any of these handlers (Requirements 1.6, 6.3). Tokens
  // (access/refresh) are NEVER returned in any response.

  /**
   * Returns the Google connection status + toggles for the authenticated
   * admin's tenant. Never includes tokens (Requirement 1.1).
   */
  async getGoogleStatus(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const status = await googleAccountService.getStatus(tenantId);
      res.status(200).json({ success: true, data: status });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Returns the Google Workspace OAuth authorization URL + a signed state that
   * binds the tenant to the flow (Requirement 1.2). The frontend redirects the
   * browser to `auth_url`; the `state` is verified back in the callback.
   */
  async getGoogleConnectUrl(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const { auth_url, state } = googleAccountService.getConnectUrl(tenantId);
      res.status(200).json({ success: true, data: { auth_url, state } });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Processes the Google OAuth callback. Accepts `code` and `state` from the
   * query string or the request body (the frontend receives them on its own
   * redirect route and forwards them here in an authenticated call). The `state`
   * is verified and its tenant_id MUST match the caller's tenant (else 403),
   * preventing a valid state from one tenant being replayed by another.
   * Tokens are exchanged/persisted (encrypted) by the service and NEVER returned
   * (Requirement 1.3, 5.1). Audited as UPDATE on 'google_account'.
   */
  async googleCallback(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const code = (req.body?.code ?? req.query?.code) as string | undefined;
    const state = (req.body?.state ?? req.query?.state) as string | undefined;

    try {
      if (!code || typeof code !== 'string') {
        throw new HttpError('Falta el parametro code', 400, 'OAUTH_CODE_MISSING');
      }
      if (!state || typeof state !== 'string') {
        throw new HttpError('Falta el parametro state', 400, 'OAUTH_STATE_MISSING');
      }

      // verifyState throws HttpError 400 if the state is invalid/expired.
      const { tenant_id: stateTenantId } = verifyState(state);
      if (stateTenantId !== tenantId) {
        throw new HttpError(
          'El state OAuth no corresponde al tenant autenticado',
          403,
          'OAUTH_STATE_TENANT_MISMATCH'
        );
      }

      const status = await googleAccountService.handleCallback(tenantId, code);

      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'google_account',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      res.status(200).json({ success: true, data: status });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Updates the Google integration toggles (online_sessions / save_contacts)
   * for the authenticated admin's tenant. Only the fields present in the body
   * are applied (Requirement 3.1, 4.1). Audited as UPDATE on 'google_account'.
   */
  async updateGoogleSettings(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { online_sessions, save_contacts } = req.body ?? {};
    try {
      const status = await googleAccountService.updateSettings(tenantId, {
        online_sessions,
        save_contacts,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'google_account',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: status });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Disconnects the tenant's Google account (revoke + delete). Idempotent at
   * the service level. Audited as DELETE on 'google_account'.
   */
  async disconnectGoogle(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      await googleAccountService.disconnect(tenantId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.DELETE,
        resource_type: 'google_account',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: { disconnected: true } });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  // --- Cancellation policy (ADMIN-only, tenant-scoped) -----------------------
  // La politica de cancelacion (grace_hours, allowed_cancellations,
  // penalty_amount, reset_days) es configuracion sensible del negocio: solo el
  // ADMIN puede leerla/editarla (requireAdmin en la ruta). Tenant-scoped via
  // req.user.tenant_id (Requirement 1.1, 1.2).

  /**
   * Devuelve la politica de cancelacion del tenant, o los defaults si aun no se
   * ha configurado (getOrDefault). ADMIN-only, tenant-scoped.
   */
  async getCancellationPolicy(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const policy = await cancellationPolicyService.getOrDefault(tenantId);
      res.status(200).json({ success: true, data: policy });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Actualiza (upsert) la politica de cancelacion del tenant. Los campos son
   * validados en el servicio (>= 0, numericos) -> 400 VALIDATION_ERROR sin
   * persistir. ADMIN-only, tenant-scoped. Auditado como UPDATE sobre
   * 'cancellation_policy'.
   */
  async updateCancellationPolicy(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { grace_hours, allowed_cancellations, penalty_amount, reset_days } =
      req.body ?? {};
    try {
      const policy = await cancellationPolicyService.update(tenantId, {
        grace_hours,
        allowed_cancellations,
        penalty_amount,
        reset_days,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'cancellation_policy',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: policy });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  // --- Booking settings (ADMIN-only, tenant-scoped) --------------------------
  // Configuracion del agendado: por ahora el HORIZONTE de reserva
  // (booking_horizon_days). Solo el ADMIN puede leer/editarlo (requireAdmin en
  // la ruta). Tenant-scoped via req.user.tenant_id.

  /**
   * Devuelve el horizonte de agendado del tenant ({ booking_horizon_days }).
   * ADMIN-only, tenant-scoped.
   */
  async getBookingSettings(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const booking_horizon_days = await bookingSettingsService.getHorizon(tenantId);
      res.status(200).json({ success: true, data: { booking_horizon_days } });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Actualiza el horizonte de agendado del tenant. El valor se valida en el
   * servicio (entero >= 0 -> 400 VALIDATION_ERROR sin persistir). ADMIN-only,
   * tenant-scoped. Auditado como UPDATE sobre 'booking_settings'.
   */
  async updateBookingSettings(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { booking_horizon_days } = req.body ?? {};
    try {
      const result = await bookingSettingsService.updateHorizon(
        tenantId,
        booking_horizon_days
      );
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'booking_settings',
        resource_id: tenantId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  // --- In-app notifications (staff, tenant-scoped) ---------------------------
  // Bandeja/campana del emprendedor. Cualquier miembro del staff (ADMIN o
  // ASSISTANT) puede ver y marcar sus notificaciones. Aisladas por tenant via
  // req.user.tenant_id (Property 1, Requirement 6.2-6.5).

  /**
   * Lista las notificaciones in-app del tenant (mas recientes primero). Con
   * ?unread=1 devuelve solo las no leidas. `limit` opcional (?limit=). staff.
   */
  async listNotifications(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const unreadOnly = req.query.unread === '1';
    const limitRaw = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    try {
      const notifications = await notificationService.listForTenant(tenantId, {
        unreadOnly,
        limit,
      });
      res.status(200).json({ success: true, data: notifications });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Devuelve el contador de notificaciones no leidas del tenant. staff.
   */
  async unreadNotificationsCount(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const count = await notificationService.unreadCount(tenantId);
      res.status(200).json({ success: true, data: { count } });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Marca una notificacion del tenant como leida. Una notificacion ajena o
   * inexistente -> 404 NOTIFICATION_NOT_FOUND. staff.
   */
  async markNotificationRead(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const { id } = req.params;
    try {
      const notification = await notificationService.markRead(tenantId, id);
      res.status(200).json({ success: true, data: notification });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },

  /**
   * Marca todas las notificaciones no leidas del tenant como leidas. Devuelve
   * el numero de filas actualizadas. staff.
   */
  async markAllNotificationsRead(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    try {
      const result = await notificationService.markAllRead(tenantId);
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      sendMeError(res, error);
    }
  },
};

/**
 * Consistent error responder for the me controller: HttpError -> its
 * statusCode/code; anything else -> 500 INTERNAL_ERROR.
 */
function sendMeError(res: Response, error: any): void {
  if (error && error.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
