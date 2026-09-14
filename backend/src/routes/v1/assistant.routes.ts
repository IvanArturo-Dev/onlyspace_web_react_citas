import { Router } from 'express';
import { assistantController } from '../../controllers/assistant.controller';
import { authenticated } from '../../middleware/authenticated';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requirePremium } from '../../middleware/requirePremium';

export const assistantRoutes = Router();

// Gestion de asistentes (sub-usuarios) por parte del emprendedor. Todas las
// rutas requieren la cadena `authenticated` (auth + ensureNotBlocked +
// touchLastSeen) seguida de `requireAdmin`: solo el emprendedor (ADMIN) puede
// administrar a sus asistentes. El scoping por tenant lo hace el servicio via
// `req.user.tenant_id`, de modo que un emprendedor solo ve/modifica los suyos.

// GET /v1/assistants
assistantRoutes.get('/', ...authenticated, requireAdmin, assistantController.list);

// POST /v1/assistants
assistantRoutes.post('/', ...authenticated, requireAdmin, requirePremium, assistantController.invite);

// PATCH /v1/assistants/:id
assistantRoutes.patch('/:id', ...authenticated, requireAdmin, assistantController.setStatus);
