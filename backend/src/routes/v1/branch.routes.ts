import { Router } from 'express';
import { branchController } from '../../controllers/branch.controller';
import { promotionController } from '../../controllers/promotion.controller';
import { authenticated } from '../../middleware/authenticated';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requireBranchQuota } from '../../middleware/requireBranchQuota';
import { requireModule } from '../../middleware/requireModule';
import { requirePremium } from '../../middleware/requirePremium';

export const branchRoutes = Router();

// All /v1/branches/* routes require an authenticated business owner (ADMIN).
// They go through the composed `authenticated` chain (authMiddleware +
// ensureNotBlocked + touchLastSeen) followed by requireAdmin. The whole area is
// also gated by the 'branches' module: when the super admin disables it for the
// tenant (or system-wide), these endpoints respond 403 MODULE_DISABLED
// (Req 10.4/10.5).
const branchesModule = requireModule('branches');

// GET /v1/branches
branchRoutes.get('/', ...authenticated, requireAdmin, branchesModule, branchController.list);

// POST /v1/branches
branchRoutes.post(
  '/',
  ...authenticated,
  requireAdmin,
  branchesModule,
  requireBranchQuota,
  branchController.create
);

// GET /v1/branches/:id
branchRoutes.get('/:id', ...authenticated, requireAdmin, branchesModule, branchController.get);

// PATCH /v1/branches/:id
branchRoutes.patch('/:id', ...authenticated, requireAdmin, branchesModule, branchController.update);

// --- Config por sucursal ---

// Schedule (horarios)
branchRoutes.get(
  '/:id/schedule',
  ...authenticated,
  requireAdmin,
  branchesModule,
  branchController.getSchedule
);
branchRoutes.post(
  '/:id/schedule',
  ...authenticated,
  requireAdmin,
  branchesModule,
  branchController.updateSchedule
);

// Holidays (dias de asueto)
branchRoutes.get(
  '/:id/holidays',
  ...authenticated,
  requireAdmin,
  branchesModule,
  branchController.listHolidays
);
branchRoutes.post(
  '/:id/holidays',
  ...authenticated,
  requireAdmin,
  branchesModule,
  branchController.addHoliday
);
branchRoutes.delete(
  '/:id/holidays/:holidayId',
  ...authenticated,
  requireAdmin,
  branchesModule,
  branchController.removeHoliday
);

// Services (categorias)
branchRoutes.get(
  '/:id/services',
  ...authenticated,
  requireAdmin,
  branchesModule,
  branchController.listServices
);
branchRoutes.post(
  '/:id/services',
  ...authenticated,
  requireAdmin,
  branchesModule,
  branchController.createService
);

// Promotions (promociones informativas por sucursal)
//
// `list` NO lleva requirePremium: los negocios free pueden ver el estado de sus
// promociones. Crear/editar/borrar SI llevan requirePremium (free -> 403
// PREMIUM_REQUIRED), que ademas salta bajo impersonacion del super admin.
branchRoutes.get(
  '/:id/promotions',
  ...authenticated,
  requireAdmin,
  branchesModule,
  promotionController.list
);
branchRoutes.post(
  '/:id/promotions',
  ...authenticated,
  requireAdmin,
  branchesModule,
  requirePremium,
  promotionController.create
);
branchRoutes.patch(
  '/:id/promotions/:promoId',
  ...authenticated,
  requireAdmin,
  branchesModule,
  requirePremium,
  promotionController.update
);
branchRoutes.delete(
  '/:id/promotions/:promoId',
  ...authenticated,
  requireAdmin,
  branchesModule,
  requirePremium,
  promotionController.remove
);
