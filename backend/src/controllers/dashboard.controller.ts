import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { dashboardService } from '../services/dashboard.service';

export const dashboardController = {
  async getStats(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    try {
      const stats = await dashboardService.getDashboardStats(tenantId, start_date, end_date);
      res.status(200).json({ success: true, data: stats });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getAppointmentsTrend(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'start_date and end_date are required',
        },
      });
      return;
    }

    try {
      const trend = await dashboardService.getAppointmentsTrend(tenantId, start_date, end_date);
      res.status(200).json({ success: true, data: trend });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getServicesPopularity(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    try {
      const popularity = await dashboardService.getServicesPopularity(tenantId, start_date, end_date);
      res.status(200).json({ success: true, data: popularity });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getIncome(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'start_date and end_date are required',
        },
      });
      return;
    }

    try {
      const income = await dashboardService.getIncome(tenantId, start_date, end_date);
      res.status(200).json({ success: true, data: income });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getOccupancy(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    if (!start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'start_date and end_date are required',
        },
      });
      return;
    }

    try {
      const occupancy = await dashboardService.getOccupancy(tenantId, start_date, end_date);
      res.status(200).json({ success: true, data: occupancy });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getReport(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const type = req.query.type as string;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;

    if (!type || !start_date || !end_date) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'type, start_date, and end_date are required',
        },
      });
      return;
    }

    try {
      const report = await dashboardService.getReport(tenantId, type, start_date, end_date);
      res.status(200).json({ success: true, data: report });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },
};
