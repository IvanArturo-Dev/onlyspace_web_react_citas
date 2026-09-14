import { Router } from 'express';
import { availabilityController } from '../../controllers/availability.controller';
import { authMiddleware } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/requireAdmin';

export const availabilityRoutes = Router();

// GET /v1/availability/professionals/:professionalId
availabilityRoutes.get('/professionals/:professionalId', authMiddleware, availabilityController.getProfessionalAvailability);

// GET /v1/availability/dates/:professionalId
availabilityRoutes.get('/dates/:professionalId', authMiddleware, availabilityController.getAvailableDates);

// GET /v1/availability/times/:professionalId
availabilityRoutes.get('/times/:professionalId', authMiddleware, availabilityController.getAvailableTimes);

// GET /v1/availability/schedule
availabilityRoutes.get('/schedule', authMiddleware, requireAdmin, availabilityController.getSchedule);

// POST /v1/availability/schedule
availabilityRoutes.post('/schedule', authMiddleware, requireAdmin, availabilityController.updateSchedule);
