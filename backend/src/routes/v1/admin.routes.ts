import { Router } from 'express';
import { adminController } from '../../controllers/admin.controller';
import { authorizationController } from '../../controllers/authorization.controller';
import { authMiddleware } from '../../middleware/auth';
import { requireSuperAdmin } from '../../middleware/requireSuperAdmin';

export const adminRoutes = Router();

// All admin endpoints require a valid JWT (authMiddleware) followed by the
// SUPERADMIN authorization guard (requireSuperAdmin).

// GET /v1/admin/overview
adminRoutes.get('/overview', authMiddleware, requireSuperAdmin, adminController.getOverview);

// GET /v1/admin/metrics
adminRoutes.get('/metrics', authMiddleware, requireSuperAdmin, adminController.getMetrics);

// GET /v1/admin/tenants
adminRoutes.get('/tenants', authMiddleware, requireSuperAdmin, adminController.listTenants);

// GET /v1/admin/audit
adminRoutes.get('/audit', authMiddleware, requireSuperAdmin, adminController.getAudit);

// GET /v1/admin/payments (historial de pagos - auditoria)
adminRoutes.get('/payments', authMiddleware, requireSuperAdmin, adminController.listPayments);

// GET /v1/admin/health
adminRoutes.get('/health', authMiddleware, requireSuperAdmin, adminController.getHealth);

// GET /v1/admin/realtime
adminRoutes.get('/realtime', authMiddleware, requireSuperAdmin, adminController.getRealtime);

// --- Administracion global de usuarios (Super Admin) ---

// GET /v1/admin/users
adminRoutes.get('/users', authMiddleware, requireSuperAdmin, adminController.listUsers);

// PATCH /v1/admin/users/:id/block
adminRoutes.patch(
  '/users/:id/block',
  authMiddleware,
  requireSuperAdmin,
  adminController.blockUser
);

// PATCH /v1/admin/users/:id/role
adminRoutes.patch(
  '/users/:id/role',
  authMiddleware,
  requireSuperAdmin,
  adminController.changeUserRole
);

// --- Suscripcion premium por tenant (Super Admin) ---

// GET /v1/admin/tenants/:id/subscription
adminRoutes.get(
  '/tenants/:id/subscription',
  authMiddleware,
  requireSuperAdmin,
  adminController.getTenantSubscription
);

// PATCH /v1/admin/tenants/:id/subscription
adminRoutes.patch(
  '/tenants/:id/subscription',
  authMiddleware,
  requireSuperAdmin,
  adminController.setTenantSubscription
);

// --- Metricas globales de lealtad (Super Admin) ---

// GET /v1/admin/loyalty/stats
adminRoutes.get(
  '/loyalty/stats',
  authMiddleware,
  requireSuperAdmin,
  adminController.getLoyaltyStats
);

// --- Conmutacion de modulos (Super Admin) ---

// GET /v1/admin/modules
adminRoutes.get('/modules', authMiddleware, requireSuperAdmin, adminController.listModules);

// PATCH /v1/admin/modules
adminRoutes.patch('/modules', authMiddleware, requireSuperAdmin, adminController.setModule);

// --- Autorizacion de administradores de citas (Super Admin) ---

// GET /v1/admin/authorized
adminRoutes.get(
  '/authorized',
  authMiddleware,
  requireSuperAdmin,
  authorizationController.list
);

// POST /v1/admin/authorized
adminRoutes.post(
  '/authorized',
  authMiddleware,
  requireSuperAdmin,
  authorizationController.authorize
);

// PATCH /v1/admin/authorized/:id
adminRoutes.patch(
  '/authorized/:id',
  authMiddleware,
  requireSuperAdmin,
  authorizationController.setStatus
);

// --- Banners del landing (Super Admin) ---

// GET /v1/admin/landing-banners
adminRoutes.get(
  '/landing-banners',
  authMiddleware,
  requireSuperAdmin,
  adminController.listLandingBanners
);

// POST /v1/admin/landing-banners
adminRoutes.post(
  '/landing-banners',
  authMiddleware,
  requireSuperAdmin,
  adminController.createLandingBanner
);

// PATCH /v1/admin/landing-banners/:id
adminRoutes.patch(
  '/landing-banners/:id',
  authMiddleware,
  requireSuperAdmin,
  adminController.updateLandingBanner
);

// DELETE /v1/admin/landing-banners/:id
adminRoutes.delete(
  '/landing-banners/:id',
  authMiddleware,
  requireSuperAdmin,
  adminController.deleteLandingBanner
);

// --- Modo soporte por impersonacion (Super Admin) ---

// POST /v1/admin/impersonation/:tenantId
adminRoutes.post(
  '/impersonation/:tenantId',
  authMiddleware,
  requireSuperAdmin,
  adminController.startImpersonation
);

// POST /v1/admin/impersonation/:tenantId/stop
adminRoutes.post(
  '/impersonation/:tenantId/stop',
  authMiddleware,
  requireSuperAdmin,
  adminController.stopImpersonation
);
