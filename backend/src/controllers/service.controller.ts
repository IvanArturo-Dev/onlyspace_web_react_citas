import { Response } from 'express';
import { AuditAction } from '@prisma/client';
import { AuthRequest } from '../types/express';
import { serviceService } from '../services/service.service';
import { writeAudit } from '../utils/audit';

export const serviceController = {
  async list(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const categoryId = req.query.category_id as string;
    const isActive = req.query.is_active !== 'false';

    try {
      const services = await serviceService.listServices(tenantId, categoryId, isActive);
      res.status(200).json({ success: true, data: services });
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

  async get(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const serviceId = req.params.id;

    try {
      const service = await serviceService.getService(tenantId, serviceId);
      res.status(200).json({ success: true, data: service });
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

  async create(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const data = req.body;

    try {
      const service = await serviceService.createService(tenantId, data);
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

  async update(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const serviceId = req.params.id;
    const data = req.body;

    try {
      const service = await serviceService.updateService(tenantId, serviceId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'service',
        resource_id: serviceId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: service });
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

  async patch(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const serviceId = req.params.id;
    const data = req.body;

    try {
      const service = await serviceService.updateService(tenantId, serviceId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'service',
        resource_id: serviceId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: service });
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

  async delete(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const serviceId = req.params.id;

    try {
      await serviceService.deleteService(tenantId, serviceId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.DELETE,
        resource_type: 'service',
        resource_id: serviceId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(204).send();
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

  async listCategories(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const categories = await serviceService.listCategories(tenantId);
      res.status(200).json({ success: true, data: categories });
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

  async createCategory(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const data = req.body;

    try {
      const category = await serviceService.createCategory(tenantId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'service_category',
        resource_id: category.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: category });
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
