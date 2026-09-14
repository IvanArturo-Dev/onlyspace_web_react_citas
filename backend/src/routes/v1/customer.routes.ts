import { Router } from 'express';
import { customerController } from '../../controllers/customer.controller';
import { authenticated } from '../../middleware/authenticated';
import { requireStaff } from '../../middleware/requireStaff';
import { requireAdmin } from '../../middleware/requireAdmin';

export const customerRoutes = Router();

// All /v1/customers/* routes are client-management endpoints. Managing clients
// is staff-only: the entrepreneur (ADMIN) OR one of their assistants
// (ASSISTANT/colaborador). They go through the composed `authenticated` chain
// (authMiddleware + ensureNotBlocked + touchLastSeen) followed by
// `requireStaff`, mirroring appointment.routes.ts. A CLIENT (final customer)
// gets 403 FORBIDDEN. Tenant scoping is enforced by the handlers via
// `req.user.tenant_id`, which the login pins to the entrepreneur's tenant for
// both roles, so an assistant can only manage that tenant's clients.

// GET /v1/customers
customerRoutes.get('/', ...authenticated, requireStaff, customerController.list);

// GET /v1/customers/:id
customerRoutes.get('/:id', ...authenticated, requireStaff, customerController.get);

// POST /v1/customers
customerRoutes.post('/', ...authenticated, requireStaff, customerController.create);

// --- Estado de cancelacion / deuda (Requirement 3.2, 3.3) ------------------
// Estas rutas tienen un segmento extra (/cancellation-state,
// /confirm-penalty-payment) por lo que no colisionan con las genericas /:id;
// aun asi se declaran ANTES de PUT/PATCH/DELETE /:id por claridad.

// GET /v1/customers/:id/cancellation-state — estado de cancelacion (staff).
customerRoutes.get(
  '/:id/cancellation-state',
  ...authenticated,
  requireStaff,
  customerController.cancellationState
);

// POST /v1/customers/:id/confirm-penalty-payment — confirma pago de deuda (ADMIN).
customerRoutes.post(
  '/:id/confirm-penalty-payment',
  ...authenticated,
  requireAdmin,
  customerController.confirmPenaltyPayment
);

// PUT /v1/customers/:id
customerRoutes.put('/:id', ...authenticated, requireStaff, customerController.update);

// PATCH /v1/customers/:id
customerRoutes.patch('/:id', ...authenticated, requireStaff, customerController.patch);

// DELETE /v1/customers/:id
customerRoutes.delete('/:id', ...authenticated, requireStaff, customerController.delete);
