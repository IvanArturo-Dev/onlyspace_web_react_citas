import { Router } from 'express';
import { meController } from '../../controllers/me.controller';
import { authenticated } from '../../middleware/authenticated';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requireStaff } from '../../middleware/requireStaff';
import { requirePremium } from '../../middleware/requirePremium';

export const meRoutes = Router();

// All /v1/me/* routes require authentication, so they go through the composed
// `authenticated` chain (authMiddleware + ensureNotBlocked + touchLastSeen).

// GET /v1/me/tenant
meRoutes.get('/tenant', ...authenticated, requireAdmin, meController.getTenant);

// PATCH /v1/me/tenant — ADMIN-only update of the business name (tenant.name).
// Dato basico: NO requiere premium (a diferencia de PATCH /branding).
meRoutes.patch('/tenant', ...authenticated, requireAdmin, meController.updateTenant);

// GET /v1/me/business — ADMIN-only WhatsApp business profile (number + template).
meRoutes.get('/business', ...authenticated, requireAdmin, meController.getBusiness);

// PATCH /v1/me/business — ADMIN-only update of WhatsApp number + template.
meRoutes.patch('/business', ...authenticated, requireAdmin, meController.updateBusiness);

// GET /v1/me/appointments — any authenticated user (client or admin) can see
// their own bookings.
meRoutes.get('/appointments', ...authenticated, meController.getMyAppointments);

// GET /v1/me/loyalty — any authenticated user sees only THEIR OWN loyalty
// progress and rewards, scoped to their tenant (Requirement 7.3).
meRoutes.get('/loyalty', ...authenticated, meController.getMyLoyalty);

// --- Cliente: recompensas, resenas y favoritos -----------------------------
// Estas rutas son para CUALQUIER usuario logueado (cliente o admin); NO llevan
// requireAdmin. La resolucion del/los customer del usuario por email dentro de
// su tenant se hace en el controlador (patron de getMyLoyalty). Aisladas por
// identidad y tenant (Requirement 7.1).

// POST /v1/me/rewards/:id/claim — el cliente reclama su recompensa EARNED; se
// genera un claim_code y pasa a CLAIMED (Requirement 2.1, 2.2).
meRoutes.post('/rewards/:id/claim', ...authenticated, meController.claimReward);

// GET /v1/me/coupons — panel "Mis cupones": recompensas del cliente con estado
// y expiracion (Requirement 5.1, 5.2).
meRoutes.get('/coupons', ...authenticated, meController.getMyCoupons);

// POST /v1/me/reviews — crear/editar la resena de una cita COMPLETED propia
// (Requirement 3.1).
meRoutes.post('/reviews', ...authenticated, meController.createOrUpdateReview);

// GET /v1/me/reviews — resenas del propio cliente (Requirement 3.4).
meRoutes.get('/reviews', ...authenticated, meController.getMyReviews);

// GET /v1/me/favorites — negocios favoritos del propio usuario (Requirement 4.2).
meRoutes.get('/favorites', ...authenticated, meController.listFavorites);

// POST /v1/me/favorites/:tenantId — marca/desmarca un negocio como favorito
// (toggle idempotente, Requirement 4.2).
meRoutes.post('/favorites/:tenantId', ...authenticated, meController.toggleFavorite);

// --- Entrepreneur branding + ads (ADMIN-only, tenant-scoped) ---------------
// The branding/ads configuration is exclusive to the tenant's ADMIN
// (Requirement 3.5, 6.2). Data is stored regardless of premium status; premium
// only gates whether it surfaces in the public portal.

// GET /v1/me/branding — read branding fields (logo, color, banner).
meRoutes.get('/branding', ...authenticated, requireAdmin, meController.getBranding);

// PATCH /v1/me/branding — update branding fields (brand_color validated).
// Premium-only mutation (Property 1): free -> 403 PREMIUM_REQUIRED.
meRoutes.patch('/branding', ...authenticated, requireAdmin, requirePremium, meController.updateBranding);

// GET /v1/me/ads — list the tenant's own ads.
meRoutes.get('/ads', ...authenticated, requireAdmin, meController.listAds);

// POST /v1/me/ads — create an ad (title required). Premium-only mutation.
meRoutes.post('/ads', ...authenticated, requireAdmin, requirePremium, meController.createAd);

// PATCH /v1/me/ads/:id — update an ad owned by the tenant (else 404). Premium-only.
meRoutes.patch('/ads/:id', ...authenticated, requireAdmin, requirePremium, meController.updateAd);

// DELETE /v1/me/ads/:id — delete an ad owned by the tenant (else 404). Premium-only.
meRoutes.delete('/ads/:id', ...authenticated, requireAdmin, requirePremium, meController.deleteAd);

// --- Google Workspace integration (ADMIN-only, tenant-scoped) ---------------
// The Google connection is exclusive to the tenant's ADMIN: connecting,
// disconnecting and toggling settings all require ADMIN. An ASSISTANT/CLIENT
// receives 403 via requireAdmin BEFORE reaching the handler (Requirements 1.6,
// 6.3). No endpoint ever returns access/refresh tokens.

// GET /v1/me/google — connection status + toggles.
meRoutes.get('/google', ...authenticated, requireAdmin, meController.getGoogleStatus);

// GET /v1/me/google/connect — returns { auth_url, state } to start OAuth.
meRoutes.get('/google/connect', ...authenticated, requireAdmin, meController.getGoogleConnectUrl);

// GET|POST /v1/me/google/callback — completes OAuth with { code, state }.
//
// Google redirects the BROWSER to the frontend's redirect route after consent.
// Because this endpoint requires a JWT (`authenticated`), the browser cannot be
// redirected here directly by Google. Instead the frontend receives the
// `code` + `state` on its own redirect page and forwards them to this endpoint
// in an authenticated call. Both GET (code/state in query) and POST (code/state
// in body) are accepted so the frontend can pick whichever is simpler.
meRoutes.get('/google/callback', ...authenticated, requireAdmin, meController.googleCallback);
meRoutes.post('/google/callback', ...authenticated, requireAdmin, meController.googleCallback);

// PATCH /v1/me/google/settings — update online_sessions / save_contacts.
meRoutes.patch('/google/settings', ...authenticated, requireAdmin, meController.updateGoogleSettings);

// DELETE /v1/me/google — disconnect (revoke + delete). Idempotent.
meRoutes.delete('/google', ...authenticated, requireAdmin, meController.disconnectGoogle);

// --- Politica de cancelacion (ADMIN-only, tenant-scoped) -------------------
// Configuracion sensible del negocio: solo el ADMIN puede leer/editar la
// politica de cancelacion (Requirement 1.1, 1.2). Un ASSISTANT/CLIENT recibe
// 403 via requireAdmin antes de llegar al handler.

// GET /v1/me/cancellation-policy — lee la politica (o defaults).
meRoutes.get(
  '/cancellation-policy',
  ...authenticated,
  requireAdmin,
  meController.getCancellationPolicy
);

// PATCH /v1/me/cancellation-policy — actualiza la politica (validada en el service).
meRoutes.patch(
  '/cancellation-policy',
  ...authenticated,
  requireAdmin,
  meController.updateCancellationPolicy
);

// --- Booking settings (ADMIN-only, tenant-scoped) --------------------------
// Configuracion del agendado: horizonte de reserva (booking_horizon_days).
// Solo el ADMIN puede leer/editarlo. Un ASSISTANT/CLIENT recibe 403 via
// requireAdmin antes de llegar al handler.

// GET /v1/me/booking-settings — lee { booking_horizon_days }.
meRoutes.get(
  '/booking-settings',
  ...authenticated,
  requireAdmin,
  meController.getBookingSettings
);

// PATCH /v1/me/booking-settings — actualiza booking_horizon_days (validado en el service).
meRoutes.patch(
  '/booking-settings',
  ...authenticated,
  requireAdmin,
  meController.updateBookingSettings
);

// --- Business settings (ADMIN-only, tenant-scoped) -------------------------
// Configuracion del negocio: modalidad ofrecida (offered_modality),
// auto-asignacion de lista de espera (waitlist_auto_assign) y visibilidad del
// contacto en el portal publico (show_contact). Solo el ADMIN puede
// leerlo/editarlo. Un ASSISTANT/CLIENT recibe 403 via requireAdmin antes de
// llegar al handler (Requirement 2.1, 2.3, 4.1, 6.1, 6.4). Se usa /me/settings
// para no chocar con /me/business ni /me/booking-settings.

// GET /v1/me/settings — lee { offered_modality, waitlist_auto_assign, show_contact }.
meRoutes.get(
  '/settings',
  ...authenticated,
  requireAdmin,
  meController.getBusinessSettings
);

// PATCH /v1/me/settings — actualiza los flags presentes (offered_modality validado).
meRoutes.patch(
  '/settings',
  ...authenticated,
  requireAdmin,
  meController.updateBusinessSettings
);

// --- Guia de uso: progreso de configuracion (ADMIN-only, tenant-scoped) ----
// GET /v1/me/setup-progress — devuelve los pasos de configuracion del negocio
// (sucursal, servicio, horarios, modalidades, WhatsApp, marca [opcional] y
// compartir codigo/QR) con su estado, el porcentaje de avance obligatorio y si
// el negocio ya esta listo para recibir reservas. Solo el ADMIN puede leerlo;
// un ASSISTANT/CLIENT recibe 403 via requireAdmin antes de llegar al handler
// (Requirement 4.1, 4.2, 4.3, 4.5).
meRoutes.get(
  '/setup-progress',
  ...authenticated,
  requireAdmin,
  meController.getSetupProgress
);

// --- Notificaciones in-app (staff, tenant-scoped) --------------------------
// Bandeja/campana del emprendedor. Accesible por staff (ADMIN o ASSISTANT),
// aislada por tenant (Requirement 6.2-6.5). Las rutas ESTATICAS
// (/unread-count, /read-all) se declaran ANTES de la parametrica /:id/read
// para que "unread-count"/"read-all" no se capturen como un :id.

// GET /v1/me/notifications — lista (mas recientes primero); ?unread=1 filtra no leidas.
meRoutes.get('/notifications', ...authenticated, requireStaff, meController.listNotifications);

// GET /v1/me/notifications/unread-count — contador de no leidas.
meRoutes.get(
  '/notifications/unread-count',
  ...authenticated,
  requireStaff,
  meController.unreadNotificationsCount
);

// PATCH /v1/me/notifications/read-all — marca todas como leidas.
meRoutes.patch(
  '/notifications/read-all',
  ...authenticated,
  requireStaff,
  meController.markAllNotificationsRead
);

// PATCH /v1/me/notifications/:id/read — marca una como leida (404 si ajena).
meRoutes.patch(
  '/notifications/:id/read',
  ...authenticated,
  requireStaff,
  meController.markNotificationRead
);

// --- Suscripcion de pago (Mercado Pago, ADMIN-only, tenant-scoped) ---------
// El emprendedor crea/consulta/cancela su suscripcion recurrente en Mercado
// Pago. Solo el ADMIN del tenant puede gestionarla (requireAdmin). El webhook
// publico de MP vive fuera de este grupo autenticado (ver /v1/webhooks).
import { subscriptionMpController } from '../../controllers/subscription.mp.controller';

// POST /v1/me/subscription — crea el preapproval y devuelve { init_point, preapproval_id }.
meRoutes.post(
  '/subscription',
  ...authenticated,
  requireAdmin,
  subscriptionMpController.createSubscription
);

// GET /v1/me/subscription — estado de la suscripcion del tenant.
meRoutes.get(
  '/subscription',
  ...authenticated,
  requireAdmin,
  subscriptionMpController.getMySubscription
);

// POST /v1/me/subscription/cancel — cancela el preapproval en MP.
meRoutes.post(
  '/subscription/cancel',
  ...authenticated,
  requireAdmin,
  subscriptionMpController.cancelMySubscription
);
