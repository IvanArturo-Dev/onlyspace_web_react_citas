import { Router } from 'express';
import { dashboardController } from '../../controllers/dashboard.controller';
import { authMiddleware } from '../../middleware/auth';

export const dashboardRoutes = Router();

// GET /v1/dashboard/stats
dashboardRoutes.get('/stats', authMiddleware, dashboardController.getStats);

// GET /v1/dashboard/appointments-trend
dashboardRoutes.get('/appointments-trend', authMiddleware, dashboardController.getAppointmentsTrend);

// GET /v1/dashboard/services-popularity
dashboardRoutes.get('/services-popularity', authMiddleware, dashboardController.getServicesPopularity);

// GET /v1/dashboard/income
dashboardRoutes.get('/income', authMiddleware, dashboardController.getIncome);

// GET /v1/dashboard/occupancy
dashboardRoutes.get('/occupancy', authMiddleware, dashboardController.getOccupancy);

// GET /v1/dashboard/report
dashboardRoutes.get('/report', authMiddleware, dashboardController.getReport);
