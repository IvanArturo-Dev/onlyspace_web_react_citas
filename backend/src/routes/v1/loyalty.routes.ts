import { Router } from 'express';
import { loyaltyController } from '../../controllers/loyalty.controller';
import { authenticated } from '../../middleware/authenticated';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requirePremium } from '../../middleware/requirePremium';
import { requireStaff } from '../../middleware/requireStaff';

export const loyaltyRoutes = Router();

// Endpoints de lealtad del emprendedor. Todas pasan por la cadena
// `authenticated` (auth + ensureNotBlocked + touchLastSeen). La administracion
// de programas y las metricas son ADMIN-only (`requireAdmin`); la consulta y el
// canje de recompensas los pueden operar el emprendedor o su asistente
// (`requireStaff` = ADMIN | ASSISTANT). El aislamiento por tenant lo garantiza
// el servicio via `req.user.tenant_id`.

// --- Programas (requireAdmin) ---
// Todos los endpoints de PROGRAMAS son premium-only (Property 3): free -> 403
// PREMIUM_REQUIRED. Las rutas de /rewards y /stats NO se gatean.
loyaltyRoutes.get('/programs', ...authenticated, requireAdmin, requirePremium, loyaltyController.listPrograms);
loyaltyRoutes.post(
  '/programs',
  ...authenticated,
  requireAdmin,
  requirePremium,
  loyaltyController.createProgram
);
loyaltyRoutes.get('/programs/:id', ...authenticated, requireAdmin, requirePremium, loyaltyController.getProgram);
loyaltyRoutes.patch('/programs/:id', ...authenticated, requireAdmin, requirePremium, loyaltyController.updateProgram);
loyaltyRoutes.patch(
  '/programs/:id/active',
  ...authenticated,
  requireAdmin,
  requirePremium,
  loyaltyController.setProgramActive
);

// --- Recompensas (requireStaff: ADMIN o ASSISTANT) ---
loyaltyRoutes.get('/rewards', ...authenticated, requireStaff, loyaltyController.listRewards);
loyaltyRoutes.patch(
  '/rewards/:id/redeem',
  ...authenticated,
  requireStaff,
  loyaltyController.redeemReward
);

// --- Metricas del emprendedor (requireAdmin) ---
loyaltyRoutes.get('/stats', ...authenticated, requireAdmin, loyaltyController.getStats);
