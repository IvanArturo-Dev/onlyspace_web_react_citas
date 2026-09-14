import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { prisma } from '../database/prisma.service';
import { adminService } from '../services/admin.service';
import { realtimeService, normalizeRange } from '../services/realtime.service';
import { userAdminService } from '../services/userAdmin.service';
import { moduleService } from '../services/module.service';
import { loyaltyService } from '../services/loyalty.service';
import { subscriptionService } from '../services/subscription.service';
import { impersonationService } from '../services/impersonation.service';
import { landingBannerService } from '../services/landingBanner.service';

/**
 * Controller for the read-only super administration / observability endpoints.
 *
 * Each handler follows the existing controller pattern: it wraps the service
 * call in a try/catch and responds with `{ success: true, data }` on success or
 * `{ success: false, error: { code, message } }` with an appropriate status on
 * failure. Authorization (SUPERADMIN) is enforced by route middleware, not here.
 */
export const adminController = {
  async getOverview(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await adminService.getOverview();
      res.status(200).json({ success: true, data });
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

  async getMetrics(req: AuthRequest, res: Response): Promise<void> {
    const start_date = req.query.start_date as string | undefined;
    const end_date = req.query.end_date as string | undefined;
    const tenant_id = req.query.tenant_id as string | undefined;

    try {
      const data = await adminService.getMetrics({ start_date, end_date, tenant_id });
      res.status(200).json({ success: true, data });
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

  async listTenants(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await adminService.listTenants();
      res.status(200).json({ success: true, data });
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

  async getAudit(req: AuthRequest, res: Response): Promise<void> {
    const tenant_id = req.query.tenant_id as string | undefined;
    const user_id = req.query.user_id as string | undefined;
    const action = req.query.action as string | undefined;
    const resource_type = req.query.resource_type as string | undefined;
    const start_date = req.query.start_date as string | undefined;
    const end_date = req.query.end_date as string | undefined;

    const pageRaw = req.query.page as string | undefined;
    const pageSizeRaw = req.query.page_size as string | undefined;
    const page = pageRaw !== undefined ? Number(pageRaw) : undefined;
    const page_size = pageSizeRaw !== undefined ? Number(pageSizeRaw) : undefined;

    try {
      const data = await adminService.getAuditTrail({
        tenant_id,
        user_id,
        action,
        resource_type,
        start_date,
        end_date,
        page: Number.isFinite(page) ? page : undefined,
        page_size: Number.isFinite(page_size) ? page_size : undefined,
      });
      res.status(200).json({ success: true, data });
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

  /**
   * Historial de PAGOS de suscripcion (auditoria) para el super admin. Lee
   * PaymentRecord (append-only) con filtro opcional por tenant y paginacion.
   */
  async listPayments(req: AuthRequest, res: Response): Promise<void> {
    const tenant_id = req.query.tenant_id as string | undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 50));

    try {
      const where = tenant_id ? { tenant_id } : {};
      const [items, total] = await Promise.all([
        prisma.paymentRecord.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.paymentRecord.count({ where }),
      ]);
      res.status(200).json({
        success: true,
        data: { items, total, page, page_size: pageSize },
      });
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

  async getRealtime(req: AuthRequest, res: Response): Promise<void> {
    // `range` controls the timeseries window ('24h' | '7d' | '30d'); any
    // invalid value falls back to the default '24h' inside normalizeRange.
    const range = normalizeRange(req.query.range);

    try {
      const data = await realtimeService.getSnapshot(range);
      res.status(200).json({ success: true, data });
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

  async getHealth(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await adminService.getHealth();
      res.status(200).json({ success: true, data });
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

  // --- Administracion global de usuarios (Super Admin) ---

  async listUsers(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await userAdminService.list();
      res.status(200).json({ success: true, data });
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

  async blockUser(req: AuthRequest, res: Response): Promise<void> {
    const { blocked } = req.body ?? {};

    if (typeof blocked !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'blocked debe ser un boolean' },
      });
      return;
    }

    try {
      const data = await userAdminService.setBlocked(req.params.id, blocked);
      res.status(200).json({ success: true, data });
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

  async changeUserRole(req: AuthRequest, res: Response): Promise<void> {
    const { role } = req.body ?? {};

    if (!role || typeof role !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'role es requerido' },
      });
      return;
    }

    try {
      const data = await userAdminService.changeRole(req.params.id, role, req.user?.id);
      res.status(200).json({ success: true, data });
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

  // --- Conmutacion de modulos (Super Admin) ---

  async listModules(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await moduleService.list();
      res.status(200).json({ success: true, data });
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

  // --- Metricas globales de lealtad (Super Admin) ---

  async getLoyaltyStats(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await loyaltyService.globalStats();
      res.status(200).json({ success: true, data });
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

  // --- Suscripcion premium por tenant (Super Admin) ---

  async getTenantSubscription(req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await subscriptionService.getForTenant(req.params.id);
      res.status(200).json({ success: true, data });
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

  async setTenantSubscription(req: AuthRequest, res: Response): Promise<void> {
    const { status, expires_at } = req.body ?? {};

    try {
      const data = await subscriptionService.setSubscription(
        req.params.id,
        { status, expires_at },
        req.user?.id
      );
      res.status(200).json({ success: true, data });
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

  async setModule(req: AuthRequest, res: Response): Promise<void> {
    const { scope, tenant_id, module_key, enabled } = req.body ?? {};

    if (!module_key || typeof module_key !== 'string' || typeof enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'module_key (string) y enabled (boolean) son requeridos',
        },
      });
      return;
    }

    try {
      const data = await moduleService.setFlag({ scope, tenant_id, module_key, enabled });
      res.status(200).json({ success: true, data });
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

  // --- Modo soporte por impersonacion (Super Admin) ---

  async startImpersonation(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { token, tenant } = await impersonationService.start(
        req.user!.id,
        req.params.tenantId
      );
      res.status(200).json({ success: true, data: { token, tenant } });
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

  async stopImpersonation(req: AuthRequest, res: Response): Promise<void> {
    try {
      await impersonationService.stop(req.user!.id, req.params.tenantId);
      res.status(200).json({ success: true, data: { ok: true } });
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

  // --- Banners del landing (Super Admin) ---

  async listLandingBanners(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const data = await landingBannerService.list();
      res.status(200).json({ success: true, data });
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

  async createLandingBanner(req: AuthRequest, res: Response): Promise<void> {
    const { title, subtitle, image_url, link_url, sort_order, is_active } =
      req.body ?? {};

    try {
      const data = await landingBannerService.create({
        title,
        subtitle,
        image_url,
        link_url,
        sort_order,
        is_active,
      });
      res.status(201).json({ success: true, data });
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

  async updateLandingBanner(req: AuthRequest, res: Response): Promise<void> {
    const { title, subtitle, image_url, link_url, sort_order, is_active } =
      req.body ?? {};

    try {
      const data = await landingBannerService.update(req.params.id, {
        title,
        subtitle,
        image_url,
        link_url,
        sort_order,
        is_active,
      });
      res.status(200).json({ success: true, data });
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

  async deleteLandingBanner(req: AuthRequest, res: Response): Promise<void> {
    try {
      await landingBannerService.remove(req.params.id);
      res.status(200).json({ success: true, data: { ok: true } });
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
};
