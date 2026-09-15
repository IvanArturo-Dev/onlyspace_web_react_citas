import { Response } from "express";
import { AuditAction } from "@prisma/client";
import { AuthRequest } from "../types/express";
import { customerService, hasNoShowTendency } from "../services/customer.service";
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

      // Enriquecer cada cliente de la pagina con at_risk (tendencia a no
      // asistir) resuelto en LOTE, para badges del listado y del panel de
      // citas. No altera la forma de la respuesta { customers, total, page,
      // limit }: solo agrega at_risk a cada customer.
      const ids = result.customers.map((c) => c.id);
      const behaviorMap = await customerService.getBehaviorForCustomers(
        tenantId,
        ids,
      );
      const customers = result.customers.map((c) => ({
        ...c,
        at_risk: hasNoShowTendency(
          behaviorMap[c.id] ?? { attended: 0, cancelled: 0, no_show: 0 },
        ),
      }));

      res
        .status(200)
        .json({ success: true, data: { ...result, customers } });
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
   * Devuelve el comportamiento del cliente (asistio/cancelo/no asistio) scoped
   * por tenant, mas el flag at_risk (tendencia a no asistir). Requirement 2.1.
   */
  async behavior(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;

    try {
      const behavior = await customerService.getCustomerBehavior(
        tenantId,
        customerId,
      );
      const at_risk = hasNoShowTendency(behavior);
      res.status(200).json({ success: true, data: { ...behavior, at_risk } });
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
   * Bloquea/desbloquea un cliente: PATCH body { status: 'active' | 'blocked' }.
   * Reversible, sin perder historial (Requirement 4.1, 4.3). Auditado como
   * UPDATE sobre 'customer'. INVALID_STATUS -> 400, cliente ajeno -> 404.
   */
  async setStatus(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const customerId = req.params.id;
    const { status } = req.body;

    try {
      const customer = await customerService.setStatus(
        tenantId,
        customerId,
        status,
      );
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
