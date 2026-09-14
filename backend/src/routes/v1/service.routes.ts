import { Router } from 'express';
import { serviceController } from '../../controllers/service.controller';
import { authMiddleware } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requireServiceQuota } from '../../middleware/requireServiceQuota';

export const serviceRoutes = Router();

// GET /v1/services
serviceRoutes.get('/', authMiddleware, serviceController.list);

// GET /v1/services/:id
serviceRoutes.get('/:id', authMiddleware, serviceController.get);

// POST /v1/services — free limitado a 5 servicios (Property 4); premium sin limite.
serviceRoutes.post('/', authMiddleware, requireAdmin, requireServiceQuota, serviceController.create);

// PUT /v1/services/:id
serviceRoutes.put('/:id', authMiddleware, requireAdmin, serviceController.update);

// PATCH /v1/services/:id
serviceRoutes.patch('/:id', authMiddleware, requireAdmin, serviceController.patch);

// DELETE /v1/services/:id
serviceRoutes.delete('/:id', authMiddleware, requireAdmin, serviceController.delete);

// GET /v1/categories
serviceRoutes.get('/categories', authMiddleware, serviceController.listCategories);

// POST /v1/categories
serviceRoutes.post('/categories', authMiddleware, requireAdmin, serviceController.createCategory);
