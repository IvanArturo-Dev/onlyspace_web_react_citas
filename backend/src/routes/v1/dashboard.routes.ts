import { Router } from 'express';
import { dashboardController } from '../../controllers/dashboard.controller';
import { authMiddleware } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/requireAdmin';

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

// GET /v1/dashboard/monthly-behavior?months=6 — series mensuales (ADMIN, tenant-scoped)
dashboardRoutes.get('/monthly-behavior', authMiddleware, requireAdmin, dashboardController.getMonthlyBehavior);

// GET /v1/dashboard/client-rankings?limit=5 — rankings de clientes (ADMIN, tenant-scoped)
dashboardRoutes.get('/client-rankings', authMiddleware, requireAdmin, dashboardController.getClientRankings);
