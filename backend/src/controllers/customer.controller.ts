import { Response } from "express";
import { AuditAction } from "@prisma/client";
import { AuthRequest } from "../types/express";
import { customerService } from "../services/customer.service";
import { customerCancellationService } from "../services/customerCancellation.service";
import { writeAudit } from "../utils/audit";

export const customerController = {
  async list(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";

    try {
      const result = await customerService.listCustomers(
        tenantId,
        search,
        page,
        limit,
      );
      res.status(200).json({ success: true, data: result });
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },

  async get(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;

    try {
      const customer = await customerService.getCustomer(tenantId, customerId);
      res.status(200).json({ success: true, data: customer });
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },

  async create(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const data = req.body;

    try {
      const customer = await customerService.createCustomer(tenantId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: "customer",
        resource_id: customer.id,
        result: "success",
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
      });
      res.status(201).json({ success: true, data: customer });
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },

  async update(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;
    const data = req.body;

    try {
      const customer = await customerService.updateCustomer(tenantId, customerId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: "customer",
        resource_id: customerId,
        result: "success",
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
      });
      res.status(200).json({ success: true, data: customer });
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },

  async patch(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;
    const data = req.body;

    try {
      const customer = await customerService.updateCustomer(tenantId, customerId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: "customer",
        resource_id: customerId,
        result: "success",
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
      });
      res.status(200).json({ success: true, data: customer });
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },

  async delete(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;

    try {
      await customerService.deleteCustomer(tenantId, customerId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.DELETE,
        resource_type: "customer",
        resource_id: customerId,
        result: "success",
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },

  /**
   * Devuelve el estado de cancelacion del cliente (contador, deuda, razon,
   * inicio de periodo) scoped por tenant. staff (Requirement 3.3).
   */
  async cancellationState(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;

    try {
      const state = await customerCancellationService.getState(tenantId, customerId);
      res.status(200).json({ success: true, data: state });
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },

  /**
   * Confirma manualmente el pago de la penalizacion del cliente: pone la deuda
   * en 0 y limpia la razon. ADMIN-only, tenant-scoped. Auditado como UPDATE
   * sobre 'customer_debt' (Requirement 3.2, 3.3).
   */
  async confirmPenaltyPayment(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;

    try {
      const state = await customerCancellationService.confirmPayment(tenantId, customerId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: "customer_debt",
        resource_id: customerId,
        result: "success",
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
      });
      res.status(200).json({ success: true, data: state });
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
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      });
    }
  },
};
