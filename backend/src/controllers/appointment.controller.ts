import { Response } from 'express';
import { AuditAction } from '@prisma/client';
import { AuthRequest } from '../types/express';
import { appointmentService } from '../services/appointment.service';
import { isTenantPremium } from '../services/branch.service';
import { whatsappService } from '../services/whatsapp.service';
import { waitlistService } from '../services/waitlist.service';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';

export const appointmentController = {
  async list(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;
    const professional_id = req.query.professional_id as string;
    const status = req.query.status as string;
    const branch_id = req.query.branch_id as string;

    try {
      // Resuelve el premium efectivo del tenant aqui (una sola vez) y se lo pasa
      // al servicio para que aplique el gating de la ventana de fechas sin
      // re-consultar. Ademas se expone `is_premium` en la respuesta para que el
      // frontend sepa si mostrar el aviso de "ventana limitada" y el boton de
      // reporte (premium-only).
      const isPremium = await isTenantPremium(tenantId);
      const result = await appointmentService.listAppointments(tenantId, {
        start_date,
        end_date,
        professional_id,
        status,
        branch_id,
        isPremium,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      });
      res.status(200).json({ success: true, data: { ...result, is_premium: isPremium } });
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

  /**
   * PREMIUM-only: genera un CSV de las citas del tenant en un rango
   * (start_date/end_date; default ultimos 90 dias). Si el tenant NO es premium
   * -> 403 PREMIUM_REQUIRED. Responde con Content-Type text/csv y
   * Content-Disposition attachment. Las columnas se escapan (comas/comillas).
   */
  async exportReport(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const isPremium = await isTenantPremium(tenantId);
      if (!isPremium) {
        throw new HttpError(
          'El reporte de citas es solo para premium',
          403,
          'PREMIUM_REQUIRED'
        );
      }

      const startRaw = req.query.start_date as string;
      const endRaw = req.query.end_date as string;

      let start: Date;
      let end: Date;
      if (startRaw && endRaw) {
        start = new Date(startRaw);
        end = new Date(endRaw);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          throw new HttpError(
            'start_date y end_date deben ser fechas validas',
            400,
            'VALIDATION_ERROR'
          );
        }
      } else {
        // Default: ultimos 90 dias hasta ahora.
        end = new Date(Date.now());
        start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
      }

      const appointments = await appointmentService.listForReport(tenantId, {
        start,
        end,
      });

      const escape = (value: unknown): string => {
        const s = value === null || value === undefined ? '' : String(value);
        // Escapa comillas dobles duplicandolas y envuelve en comillas si el
        // campo contiene coma, comilla o salto de linea.
        if (/[",\n\r]/.test(s)) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const header = [
        'fecha',
        'hora',
        'cliente',
        'servicio',
        'estado',
        'sucursal',
        'monto_total',
        'monto_pagado',
        'estado_pago',
      ];

      const rows = appointments.map((appt: any) => {
        const start_time = new Date(appt.start_time);
        const fecha = start_time.toISOString().slice(0, 10);
        const hora = start_time.toISOString().slice(11, 16);
        return [
          fecha,
          hora,
          appt.customer?.name ?? '',
          appt.service?.name ?? '',
          appt.status ?? '',
          appt.branch?.name ?? '',
          Number(appt.amount_total ?? 0),
          Number(appt.amount_paid ?? 0),
          appt.payment_status ?? '',
        ]
          .map(escape)
          .join(',');
      });

      const csv = [header.map(escape).join(','), ...rows].join('\r\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="reporte-citas.csv"'
      );
      res.status(200).send(csv);
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

  /**
   * PREMIUM-only: series por mes de los ultimos N meses (default 6). Si el
   * tenant NO es premium -> 403 PREMIUM_REQUIRED. Scoped por tenant.
   */
  async monthlyStats(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const isPremium = await isTenantPremium(tenantId);
      if (!isPremium) {
        throw new HttpError(
          'Las estadisticas mensuales son solo para premium',
          403,
          'PREMIUM_REQUIRED'
        );
      }

      const monthsRaw = parseInt(req.query.months as string, 10);
      const months = Number.isFinite(monthsRaw) && monthsRaw > 0 ? monthsRaw : 6;

      const stats = await appointmentService.monthlyStats(tenantId, months);
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

  async get(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;

    try {
      const appointment = await appointmentService.getAppointment(tenantId, appointmentId);
      res.status(200).json({ success: true, data: appointment });
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
      const appointment = await appointmentService.createAppointment(tenantId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'appointment',
        resource_id: appointment.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: appointment });
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
    const appointmentId = req.params.id;
    const data = req.body;

    try {
      const appointment = await appointmentService.updateAppointment(tenantId, appointmentId, data);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'appointment',
        resource_id: appointmentId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: appointment });
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

  async updatePayment(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;
    const { amount_total, amount_paid, currency } = req.body;

    try {
      const appointment = await appointmentService.updatePayment(tenantId, appointmentId, {
        amount_total,
        amount_paid,
        currency,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'appointment',
        resource_id: appointmentId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: appointment });
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

  async listNotes(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;

    try {
      const notes = await appointmentService.listNotes(tenantId, appointmentId);
      res.status(200).json({ success: true, data: notes });
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

  async addNote(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;
    const { body } = req.body;

    try {
      const note = await appointmentService.addNote(
        tenantId,
        appointmentId,
        body,
        req.user!.id
      );
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CREATE,
        resource_type: 'appointment_note',
        resource_id: note.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(201).json({ success: true, data: note });
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

  async deleteNote(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;
    const noteId = req.params.noteId;

    try {
      const result = await appointmentService.deleteNote(tenantId, appointmentId, noteId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.DELETE,
        resource_type: 'appointment_note',
        resource_id: noteId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
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
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async updateCustomerPhone(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;
    const { phone } = req.body;

    try {
      const customer = await appointmentService.updateCustomerPhone(
        tenantId,
        appointmentId,
        phone
      );
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'customer',
        resource_id: customer?.id ?? appointmentId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
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
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async whatsappReminder(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;

    try {
      const link = await whatsappService.buildReminderLink(tenantId, appointmentId);
      res.status(200).json({ success: true, data: link });
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

  async updateStatus(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;
    const { status } = req.body;

    try {
      const appointment = await appointmentService.updateStatus(tenantId, appointmentId, status);
      const auditAction =
        status === 'CONFIRMED'
          ? AuditAction.CONFIRM
          : status === 'CANCELLED'
            ? AuditAction.CANCEL
            : AuditAction.UPDATE;
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: auditAction,
        resource_type: 'appointment',
        resource_id: appointmentId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: appointment });
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

  async cancel(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;

    try {
      const appointment = await appointmentService.cancelAppointment(tenantId, appointmentId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CANCEL,
        resource_type: 'appointment',
        resource_id: appointmentId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: appointment });
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

  async archive(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const appointmentId = req.params.id;

    try {
      const appointment = await appointmentService.archiveAppointment(tenantId, appointmentId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'appointment',
        resource_id: appointmentId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: appointment });
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

  async checkAvailability(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const professional_id = req.params.id;
    const { start_time, duration } = req.body;

    if (!start_time || !duration) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'start_time and duration are required',
        },
      });
      return;
    }

    try {
      const isAvailable = await appointmentService.checkAvailability(
        tenantId,
        professional_id,
        new Date(start_time),
        duration
      );
      res.status(200).json({ success: true, available: isAvailable });
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

  // --- Waitlist (lista de espera FIFO) + espacios en riesgo ------------------
  // Encolamiento y reasignacion semiautomatica. El encolar/listar es staff; el
  // ofrecer/confirmar (mutaciones sensibles que crean/confirman citas) es
  // ADMIN. Tenant-scoped via req.user.tenant_id (Requirement 4.x, 5.x).

  /**
   * Encola a un cliente en la lista de espera de un servicio/dia. Bloqueado por
   * deuda -> 409 CUSTOMER_HAS_DEBT; idempotente por cliente/servicio/dia. staff.
   */
  async joinWaitlist(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    // Acepta tanto camelCase (serviceId/customerId/desiredDate/desiredStart, que
    // envia el servicio del frontend) como snake_case, para tolerar ambos
    // contratos sin romper ningun cliente.
    const b = req.body ?? {};
    const branchId = b.branchId ?? b.branch_id ?? null;
    const serviceId = b.serviceId ?? b.service_id;
    const customerId = b.customerId ?? b.customer_id;
    const desiredDateRaw = b.desiredDate ?? b.desired_date;
    const desiredStartRaw = b.desiredStart ?? b.desired_start ?? null;

    try {
      // Validacion de entrada: serviceId, customerId y una fecha valida son
      // obligatorios. Una fecha invalida -> 400 (no 500) para no filtrar un
      // error de base de datos por un payload malformado.
      if (!serviceId || !customerId) {
        throw new HttpError('service_id y customer_id son obligatorios', 400, 'VALIDATION_ERROR');
      }
      const desiredDate = desiredDateRaw ? new Date(desiredDateRaw) : new Date(NaN);
      if (Number.isNaN(desiredDate.getTime())) {
        throw new HttpError('desired_date es obligatoria y debe ser una fecha valida', 400, 'VALIDATION_ERROR');
      }
      const desiredStart = desiredStartRaw ? new Date(desiredStartRaw) : null;

      const entry = await waitlistService.join({
        tenantId,
        branchId,
        serviceId,
        customerId,
        desiredDate,
        desiredStart: desiredStart && !Number.isNaN(desiredStart.getTime()) ? desiredStart : null,
      });
      res.status(201).json({ success: true, data: entry });
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

  /**
   * Lista la cola FIFO (WAITING) de un servicio para un dia concreto. staff.
   * Query: ?service_id=&date=.
   */
  async listWaitlist(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const serviceId = req.query.service_id as string;
    const dateRaw = req.query.date as string;

    try {
      const queue = await waitlistService.listQueue(tenantId, {
        serviceId,
        date: new Date(dateRaw),
      });

      // Enriquecemos cada entrada con el precio y el nombre del servicio para
      // que el panel de encolados pueda ordenar/destacar por precio (Req 5.3).
      // Todas las entradas de esta cola comparten el mismo service_id, asi que
      // resolvemos el servicio una sola vez. Scoped por tenant (el servicio
      // debe pertenecer al tenant autenticado); si no existe, los campos
      // quedan null y no se rompe la respuesta.
      const service = serviceId
        ? await prisma.service.findFirst({
            where: { id: serviceId, tenant_id: tenantId },
            select: { name: true, price: true },
          })
        : null;
      const servicePrice = service ? Number(service.price) : null;
      const serviceName = service?.name ?? null;

      const data = (queue as Array<Record<string, unknown>>).map((entry) => ({
        ...entry,
        service_name: serviceName,
        service_price: servicePrice,
      }));

      res.status(200).json({ success: true, data });
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

  /**
   * Ofrece un espacio liberado a una entrada de la cola (ADMIN): re-verifica el
   * solape (409 SLOT_TAKEN si se tomo) y crea una cita PENDING para el cliente.
   * Auditado como UPDATE sobre 'waitlist_entry'.
   */
  async offerWaitlist(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const entryId = req.params.entryId;
    const { start, end, branch_id } = req.body ?? {};

    try {
      const result = await waitlistService.offer(tenantId, entryId, {
        start: new Date(start),
        end: new Date(end),
        branchId: branch_id ?? undefined,
      });
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.UPDATE,
        resource_type: 'waitlist_entry',
        resource_id: entryId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
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
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  /**
   * Construye el link MANUAL de WhatsApp "espacio abierto" para la cita ofrecida
   * a una entrada de la cola. Carga la entrada scoped por tenant (404
   * WAITLIST_ENTRY_NOT_FOUND); si no tiene cita ofrecida -> 400
   * WAITLIST_NO_OFFER. Devuelve { url, message, phone }. staff.
   */
  async waitlistWhatsapp(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const entryId = req.params.entryId;

    try {
      const entry = await prisma.waitlistEntry.findFirst({
        where: { id: entryId, tenant_id: tenantId },
        select: { offered_appointment_id: true },
      });

      if (!entry) {
        throw new HttpError(
          'Entrada de lista de espera no encontrada',
          404,
          'WAITLIST_ENTRY_NOT_FOUND'
        );
      }

      if (!entry.offered_appointment_id) {
        throw new HttpError(
          'La entrada no tiene una cita ofrecida',
          400,
          'WAITLIST_NO_OFFER'
        );
      }

      const link = await whatsappService.buildSpotOpenedLink(
        tenantId,
        entry.offered_appointment_id
      );
      res.status(200).json({ success: true, data: link });
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

  /**
   * Confirma la oferta de una entrada (ADMIN): marca la entrada y su cita
   * asociada como CONFIRMED. Auditado como CONFIRM sobre 'waitlist_entry'.
   */
  async confirmWaitlist(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;
    const entryId = req.params.entryId;

    try {
      const entry = await waitlistService.confirmOffer(tenantId, entryId);
      await writeAudit({
        tenant_id: tenantId,
        user_id: req.user!.id,
        action: AuditAction.CONFIRM,
        resource_type: 'waitlist_entry',
        resource_id: entryId,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });
      res.status(200).json({ success: true, data: entry });
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

  /**
   * Lista las citas "en riesgo": PENDING no confirmadas cuyo start_time cae en
   * las proximas 12h (candidatas a reasignacion). Solo lee, no muta. staff.
   */
  async listAtRisk(req: AuthRequest, res: Response): Promise<void> {
    const tenantId = req.user!.tenant_id;

    try {
      const appointments = await appointmentService.listOpenAtRisk(tenantId);
      res.status(200).json({ success: true, data: appointments });
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
