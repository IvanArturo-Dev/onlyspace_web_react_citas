import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { appointmentService } from '../services/appointment.service';
import { scheduleService } from '../services/schedule.service';

export const availabilityController = {
  async getProfessionalAvailability(req: AuthRequest, res: Response): Promise<void> {
    const professionalId = req.params.professionalId;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;
    const tenantId = req.user!.tenant_id;

    try {
      // Get appointments for the professional in the date range
      const appointments = await appointmentService.listAppointments(tenantId, {
        professional_id: professionalId,
        start_date,
        end_date,
      });

      // Calculate availability (blocked times)
      const blockedTimes = appointments.appointments.map((appt: any) => ({
        start_time: appt.start_time,
        end_time: appt.end_time,
        status: appt.status,
      }));

      res.status(200).json({ 
        success: true, 
        professional_id: professionalId,
        date_range: { start_date, end_date },
        blocked_times: blockedTimes,
      });
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

  async getAvailableDates(req: AuthRequest, res: Response): Promise<void> {
    const professionalId = req.params.professionalId;

    try {
      // Get unique dates with appointments for this professional
      // For now, return a basic response
      res.status(200).json({ 
        success: true, 
        professional_id: professionalId,
        available_dates: [],
        message: 'Available dates endpoint - needs database query implementation',
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getAvailableTimes(req: AuthRequest, res: Response): Promise<void> {
    const professionalId = req.params.professionalId;
    const date = req.query.date as string;

    try {
      // Define business hours (9 AM to 6 PM)
      const businessHours = Array.from({ length: 10 }, (_, i) => 9 + i);
      const availableTimes = businessHours.map(h => `${h}:00`);

      res.status(200).json({ 
        success: true, 
        professional_id: professionalId,
        date,
        available_times: availableTimes,
        message: 'Available times - basic implementation',
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getSchedule(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const schedule = await scheduleService.getSchedule(tenantId);
      res.status(200).json({ success: true, data: schedule });
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

  async updateSchedule(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const data = req.body;

    try {
      const schedule = await scheduleService.updateSchedule(tenantId, data);
      res.status(200).json({ success: true, data: schedule });
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
