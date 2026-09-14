import { Response } from 'express';
import { AuditAction } from '@prisma/client';
import { AuthRequest } from '../types/express';
import { branchService } from '../services/branch.service';
import { scheduleService } from '../services/schedule.service';
import { holidayService } from '../services/holiday.service';
import { serviceService } from '../services/service.service';
import { writeAudit } from '../utils/audit';

/**
 * Maps an error to the standard JSON error response following the project
 * convention: HttpError -> its statusCode/code, otherwise 500 INTERNAL_ERROR.
 */
function sendError(res: Response, error: any): void {
  if (error?.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

/**
 * HTTP controller for the business owner's branch endpoints. Follows the
 * project convention: on error, map `statusCode`/`code` from HttpError,
 * otherwise respond 500 INTERNAL_ERROR. Create/update are audited best-effort.
 */
export const branchController = {
  async list(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    // Bajo impersonacion del super admin (soporte), se salta el gating premium.
    const bypassPremium = !!req.user?.impersonated_by;

    try {
      const branches = await branchService.list(tenantId, bypassPremium);
      res.status(200).json({ success: true, data: branches });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
    }
  },

  async get(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    // Bajo impersonacion del super admin (soporte), se salta el gating premium.
    const bypassPremium = !!req.user?.impersonated_by;

    try {
      const branch = await branchService.get(tenantId, branchId, bypassPremium);
      res.status(200).json({ success: true, data: branch });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
    }
  },

  async create(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const data = req.body;

    try {
      const branch = await branchService.create(tenantId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'branch',
        resource_id: branch.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: branch });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
    }
  },

  async update(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    const data = req.body;
    // Bajo impersonacion del super admin (soporte), se salta el gating premium.
    const bypassPremium = !!req.user?.impersonated_by;

    try {
      const branch = await branchService.update(tenantId, branchId, data, bypassPremium);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'branch',
        resource_id: branchId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: branch });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: { code: error.code, message: error.message },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
    }
  },

  // --- Schedule (horarios por sucursal) ---

  async getSchedule(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const schedule = await scheduleService.getBranchSchedule(tenantId, branchId);
      res.status(200).json({ success: true, data: schedule });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  async updateSchedule(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const schedule = await scheduleService.updateBranchSchedule(
        tenantId,
        branchId,
        req.body
      );
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'branch_schedule',
        resource_id: branchId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: schedule });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  // --- Holidays (dias de asueto por sucursal) ---

  async listHolidays(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const holidays = await holidayService.list(tenantId, branchId);
      res.status(200).json({ success: true, data: holidays });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  async addHoliday(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const holiday = await holidayService.add(tenantId, branchId, req.body);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'holiday',
        resource_id: holiday.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: holiday });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  async removeHoliday(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    const holidayId = req.params.holidayId;
    try {
      const removed = await holidayService.remove(tenantId, branchId, holidayId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.DELETE,
        resource_type: 'holiday',
        resource_id: holidayId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: removed });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  // --- Services (categorias por sucursal) ---

  async listServices(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const services = await serviceService.listByBranch(tenantId, branchId);
      res.status(200).json({ success: true, data: services });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  async createService(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const branchId = req.params.id;
    try {
      const service = await serviceService.createForBranch(tenantId, branchId, req.body);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'service',
        resource_id: service.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: service });
    } catch (error: any) {
      sendError(res, error);
    }
  },
};
