import { AppointmentStatus, AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { publicService } from './public.service';
import { writeAudit } from '../utils/audit';
import { runGoogleAppointmentHook } from './google-appointment-hook';
import { assertBookingContact, assertModalityOffered, normalizeModality } from '../utils/modality';

/**
 * Identidad del usuario autenticado que agenda la cita desde el portal.
 * El email/name se resuelven en el controller consultando el User por id.
 */
export interface BookingUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

/**
 * Datos de entrada para crear una reserva publica.
 */
export interface CreatePublicBookingInput {
  service_id: string;
  start_time: string;
  /**
   * Modalidad solicitada. 'online' habilita la cita en linea, 'home' la cita a
   * domicilio; cualquier otro valor (o ausencia) se normaliza a 'in_person'.
   */
  modality?: 'in_person' | 'online' | 'home';
  /**
   * Telefono de contacto del cliente (Requirement 3.1). Obligatorio siempre
   * (lo valida assertBookingContact).
   */
  contact_phone?: string | null;
  /**
   * Direccion del domicilio (Requirement 3.4). Obligatorio solo para la
   * modalidad 'home'.
   */
  home_address?: string | null;
  /**
   * URL de Google Maps del domicilio (Requirement 3.4). Obligatorio solo para
   * la modalidad 'home'.
   */
  maps_url?: string | null;
}

/**
 * Resultado basico de una cita creada, sin datos sensibles adicionales.
 */
export interface CreatedBooking {
  id: string;
  start_time: Date;
  end_time: Date;
  status: AppointmentStatus;
  service_id: string;
  /** URL de videollamada, presente solo cuando el hook de Google la genero. */
  video_call_url?: string | null;
  /** Modalidad persistida ('online' | 'in_person'). */
  modality?: string | null;
}

/** Devuelve true si [aStart, aEnd) se solapa con [bStart, bEnd). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Medianoche UTC (00:00:00.000Z) del dia al que pertenece el Date dado.
 * Se usa para comparar contra `Holiday.date`, que se persiste a medianoche UTC,
 * y como inicio del rango de dia para la regla anti-duplicado.
 */
function midnightUtcOf(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
}

/**
 * Regla anti-duplicado (Requirement 1): un cliente NO puede tener dos citas
 * ACTIVAS (status != CANCELLED) del MISMO servicio en el MISMO dia calendario
 * (segun el dia UTC de start_time). Cuenta, dentro de la MISMA transaccion que
 * la reserva (Property 2: consistente y sin duplicados por concurrencia), las
 * citas del tenant para ese customer_id + service_id cuyo start_time cae en
 * [medianoche del dia, medianoche + 1 dia). Si ya existe al menos una ->
 * 409 DUPLICATE_BOOKING antes de crear.
 *
 * Se usa el MISMO convenio de dia (medianoche UTC) que availability/holiday.
 *
 * @param tx        Cliente Prisma transaccional.
 * @param tenantId  Tenant al que se scopea la verificacion (Property 2: aislamiento).
 * @param serviceId Servicio de la cita.
 * @param customerId Cliente resuelto/creado.
 * @param startTime start_time de la cita a crear.
 */
async function assertNoDuplicateBooking(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
  customerId: string,
  startTime: Date
): Promise<void> {
  const dayStart = midnightUtcOf(startTime);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const existing = await tx.appointment.count({
    where: {
      tenant_id: tenantId,
      service_id: serviceId,
      customer_id: customerId,
      status: { not: AppointmentStatus.CANCELLED },
      start_time: { gte: dayStart, lt: dayEnd },
    },
  });

  if (existing > 0) {
    throw new HttpError(
      'Ya existe una cita de esta categoria para este cliente hoy',
      409,
      'DUPLICATE_BOOKING'
    );
  }
}

export const bookingService = {
  /**
   * Crea una reserva publica para el negocio identificado por `code`.
   *
   * Pasos:
   *  1. Resuelve el tenant por codigo (404 INVALID_CODE si invalido/deshabilitado).
   *  2. Carga el servicio scoped por tenant + is_active (404 SERVICE_NOT_FOUND).
   *     Calcula end_time = start_time + duration_mins.
   *  3. Valida que start_time sea futuro (> ahora); si no -> 400 INVALID_TIME.
   *  4. Dentro de una transaccion:
   *     - Re-verifica que NO exista una cita del tenant (status != CANCELLED)
   *       que se solape con [start, end). Si existe -> 409 SLOT_TAKEN.
   *     - Asocia/crea Customer por email dentro del tenant.
   *     - Crea la Appointment PENDING con booked_by_email/name.
   *  5. Audita (best-effort) la creacion.
   *
   * La verificacion de solape y la creacion ocurren en la MISMA transaccion
   * para que dos requests concurrentes no creen citas solapadas (no doble reserva).
   *
   * @param code       Codigo de negocio (case-insensitive).
   * @param input      { service_id, start_time (ISO) }.
   * @param user       Identidad del usuario autenticado que agenda.
   * @returns Datos basicos de la cita creada.
   */
  async createPublicBooking(
    code: string,
    input: CreatePublicBookingInput,
    user: BookingUser
  ): Promise<CreatedBooking> {
    // 1. Resolver tenant por codigo.
    const tenant = await publicService.resolveTenantByCode(code);

    // 2. Servicio scoped por tenant + activo.
    const service = await prisma.service.findFirst({
      where: { id: input.service_id, tenant_id: tenant.id, is_active: true },
    });

    if (!service) {
      throw new HttpError('Servicio no encontrado', 404, 'SERVICE_NOT_FOUND');
    }

    const duration = service.duration_mins;
    if (!duration || duration <= 0) {
      throw new HttpError('Servicio sin duracion valida', 400, 'INVALID_SERVICE');
    }

    // 3. Validar start_time futuro.
    const startTime = new Date(input.start_time);
    if (isNaN(startTime.getTime())) {
      throw new HttpError('start_time invalido', 400, 'INVALID_TIME');
    }

    const endTime = new Date(startTime.getTime() + duration * 60_000);

    if (startTime.getTime() <= Date.now()) {
      throw new HttpError('El horario debe ser futuro', 400, 'INVALID_TIME');
    }

    // Validacion de modalidad (Requirements 2.1, 2.5): la modalidad solicitada
    // debe estar habilitada por Tenant.offered_modalities (CSV, fuente de verdad
    // nueva). Se cae al legacy offered_modality solo si offered_modalities no
    // esta presente. assertModalityOffered acepta CSV o array. Se verifica ANTES
    // de crear nada -> 400 MODALITY_NOT_OFFERED. El tenant se cargo completo via
    // resolveTenantByCode, por lo que ambos campos estan disponibles.
    assertModalityOffered(
      (tenant as any).offered_modalities ?? (tenant as any).offered_modality,
      input.modality
    );

    // Validacion de contacto/domicilio (Requirements 3.1, 3.4): telefono
    // obligatorio siempre; si la modalidad es 'home' tambien direccion + URL de
    // Google Maps. Se verifica ANTES de crear nada -> 400 CONTACT_PHONE_REQUIRED
    // o 400 HOME_DETAILS_REQUIRED.
    assertBookingContact({
      modality: input.modality,
      contact_phone: input.contact_phone,
      home_address: input.home_address,
      maps_url: input.maps_url,
    });

    const startMs = startTime.getTime();
    const endMs = endTime.getTime();

    // 4. Transaccion: re-chequeo de solape + creacion de customer + cita.
    const appointment = await prisma.$transaction(async (tx) => {
      // Buscar citas del tenant no canceladas que puedan solapar.
      // Filtramos por start_time < end para descartar las que empiezan despues,
      // y verificamos el solape exacto en memoria (end_time no siempre indexable).
      // El aforo (service.capacity) es por servicio, por lo que solo se cuentan
      // solapes de citas del MISMO service_id dentro del tenant.
      const candidates = await tx.appointment.findMany({
        where: {
          tenant_id: tenant.id,
          service_id: service.id,
          status: { not: AppointmentStatus.CANCELLED },
          start_time: { lt: endTime },
        },
        select: { start_time: true, end_time: true },
      });

      // Contar solapes reales; solo se rechaza cuando alcanzan la capacidad.
      // Con capacity=1 basta un solape para bloquear (comportamiento historico).
      const overlapCount = candidates.reduce(
        (acc, c) =>
          acc +
          (overlaps(
            startMs,
            endMs,
            new Date(c.start_time).getTime(),
            new Date(c.end_time).getTime()
          )
            ? 1
            : 0),
        0
      );

      const capacity =
        Number.isInteger(service.capacity) && service.capacity >= 1
          ? service.capacity
          : 1;

      if (overlapCount >= capacity) {
        throw new HttpError('El horario ya no esta disponible', 409, 'SLOT_TAKEN');
      }

      // Asociar/crear Customer por email dentro del tenant.
      let customer = null;
      if (user.email) {
        customer = await tx.customer.findFirst({
          where: { tenant_id: tenant.id, email: user.email },
        });
      }

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            tenant_id: tenant.id,
            name: user.name || user.email || 'Cliente',
            email: user.email ?? null,
            phone: 'sin-telefono',
          },
        });
      } else if (customer.status !== 'active') {
        // Enforcement de bloqueo (Requirement 4.2): un cliente YA existente cuyo
        // status != "active" (p. ej. "blocked") no puede crear una nueva cita.
        // Solo aplica a clientes existentes; uno recien creado nunca esta
        // bloqueado. Se coloca junto a la resolucion del customer, antes del
        // anti-duplicado, para que ninguna cita se persista si esta bloqueado.
        throw new HttpError(
          'El cliente esta bloqueado por el negocio y no puede reservar',
          409,
          'CUSTOMER_BLOCKED'
        );
      }

      // Anti-duplicado (Requirement 1): mismo cliente/servicio/dia activo ->
      // 409 DUPLICATE_BOOKING. Distinto del aforo (SLOT_TAKEN) de arriba.
      await assertNoDuplicateBooking(tx, tenant.id, service.id, customer.id, startTime);

      return tx.appointment.create({
        data: {
          tenant_id: tenant.id,
          customer_id: customer.id,
          service_id: service.id,
          start_time: startTime,
          end_time: endTime,
          status: AppointmentStatus.PENDING,
          modality: normalizeModality(input.modality),
          contact_phone: input.contact_phone ?? null,
          home_address: input.home_address ?? null,
          maps_url: input.maps_url ?? null,
          booked_by_email: user.email ?? null,
          booked_by_name: user.name ?? null,
        },
      });
    });

    // 5. Auditoria best-effort (fuera de la transaccion).
    await writeAudit({
      tenant_id: tenant.id,
      user_id: user.id,
      action: AuditAction.CREATE,
      resource_type: 'appointment',
      resource_id: appointment.id,
    });

    return {
      id: appointment.id,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
      status: appointment.status,
      service_id: appointment.service_id,
    };
  },

  /**
   * Crea una reserva publica para una SUCURSAL (branch) concreta.
   *
   * Pasos:
   *  1. Carga la Branch. Si no existe o su status != 'active' -> 404 BRANCH_NOT_FOUND.
   *  2. Carga el servicio scoped por `branch_id` + is_active (404 SERVICE_NOT_FOUND).
   *     Calcula end_time = start_time + duration_mins.
   *  3. Valida que start_time sea futuro (> ahora); si no -> 400 INVALID_TIME.
   *  4. Rechaza reservas en dia de asueto de la sucursal (Holiday en la
   *     medianoche UTC de start_time) -> 409 SLOT_TAKEN ("no disponible").
   *  5. Dentro de una transaccion:
   *     - Re-verifica que NO exista una cita de ESA sucursal (tenant_id +
   *       branch_id, status != CANCELLED) que se solape con [start, end).
   *       Si existe -> 409 SLOT_TAKEN.
   *     - Asocia/crea Customer por email dentro del tenant de la sucursal.
   *     - Crea la Appointment PENDING con tenant_id = branch.tenant_id,
   *       branch_id = branchId y booked_by_email/name.
   *  6. Audita (best-effort) la creacion.
   *
   * La verificacion de solape y la creacion ocurren en la MISMA transaccion
   * para que dos requests concurrentes no creen citas solapadas en la misma
   * sucursal (no doble reserva por sucursal - Property 4).
   *
   * @param branchId Sucursal donde se agenda.
   * @param input    { service_id, start_time (ISO) }.
   * @param user     Identidad del usuario autenticado que agenda.
   * @returns Datos basicos de la cita creada.
   */
  async createBranchBooking(
    branchId: string,
    input: CreatePublicBookingInput,
    user: BookingUser
  ): Promise<CreatedBooking> {
    // 1. Branch activa.
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch || branch.status !== 'active') {
      throw new HttpError('Sucursal no encontrada', 404, 'BRANCH_NOT_FOUND');
    }

    // 2. Servicio scoped por branch + activo.
    const service = await prisma.service.findFirst({
      where: { id: input.service_id, branch_id: branchId, is_active: true },
    });

    if (!service) {
      throw new HttpError('Servicio no encontrado', 404, 'SERVICE_NOT_FOUND');
    }

    const duration = service.duration_mins;
    if (!duration || duration <= 0) {
      throw new HttpError('Servicio sin duracion valida', 400, 'INVALID_SERVICE');
    }

    // 3. Validar start_time futuro.
    const startTime = new Date(input.start_time);
    if (isNaN(startTime.getTime())) {
      throw new HttpError('start_time invalido', 400, 'INVALID_TIME');
    }

    const endTime = new Date(startTime.getTime() + duration * 60_000);

    if (startTime.getTime() <= Date.now()) {
      throw new HttpError('El horario debe ser futuro', 400, 'INVALID_TIME');
    }

    // 4. Rechazar dia de asueto de la sucursal.
    const holiday = await prisma.holiday.findFirst({
      where: { branch_id: branchId, date: midnightUtcOf(startTime) },
    });
    if (holiday) {
      throw new HttpError('El horario ya no esta disponible', 409, 'SLOT_TAKEN');
    }

    // Validacion de modalidad (Requirements 2.1, 2.5): la modalidad solicitada
    // debe estar habilitada por Tenant.offered_modalities (CSV, fuente de verdad
    // nueva) del negocio duenio de la sucursal. La Branch solo trae tenant_id,
    // asi que se cargan ambos campos del tenant y se prefiere offered_modalities.
    // Se verifica ANTES de crear nada -> 400 MODALITY_NOT_OFFERED.
    const modalityTenant = await prisma.tenant.findUnique({
      where: { id: branch.tenant_id },
      select: { offered_modalities: true, offered_modality: true },
    });
    assertModalityOffered(
      modalityTenant?.offered_modalities ?? modalityTenant?.offered_modality,
      input.modality
    );

    // Validacion de contacto/domicilio (Requirements 3.1, 3.4): telefono
    // obligatorio siempre; si la modalidad es 'home' tambien direccion + URL de
    // Google Maps. Se verifica ANTES de crear nada -> 400 CONTACT_PHONE_REQUIRED
    // o 400 HOME_DETAILS_REQUIRED.
    assertBookingContact({
      modality: input.modality,
      contact_phone: input.contact_phone,
      home_address: input.home_address,
      maps_url: input.maps_url,
    });

    const startMs = startTime.getTime();
    const endMs = endTime.getTime();

    // 5. Transaccion: re-chequeo de solape en la sucursal + customer + cita.
    const appointment = await prisma.$transaction(async (tx) => {
      // El aforo (service.capacity) es por servicio; solo se cuentan solapes de
      // citas del MISMO service_id dentro de la misma sucursal (tenant+branch).
      const candidates = await tx.appointment.findMany({
        where: {
          tenant_id: branch.tenant_id,
          branch_id: branchId,
          service_id: service.id,
          status: { not: AppointmentStatus.CANCELLED },
          start_time: { lt: endTime },
        },
        select: { start_time: true, end_time: true },
      });

      // Contar solapes reales; solo se rechaza cuando alcanzan la capacidad.
      // Con capacity=1 basta un solape para bloquear (comportamiento historico).
      const overlapCount = candidates.reduce(
        (acc, c) =>
          acc +
          (overlaps(
            startMs,
            endMs,
            new Date(c.start_time).getTime(),
            new Date(c.end_time).getTime()
          )
            ? 1
            : 0),
        0
      );

      const capacity =
        Number.isInteger(service.capacity) && service.capacity >= 1
          ? service.capacity
          : 1;

      if (overlapCount >= capacity) {
        throw new HttpError('El horario ya no esta disponible', 409, 'SLOT_TAKEN');
      }

      // Asociar/crear Customer por email dentro del tenant de la sucursal.
      let customer = null;
      if (user.email) {
        customer = await tx.customer.findFirst({
          where: { tenant_id: branch.tenant_id, email: user.email },
        });
      }

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            tenant_id: branch.tenant_id,
            name: user.name || user.email || 'Cliente',
            email: user.email ?? null,
            phone: 'sin-telefono',
          },
        });
      } else if (customer.status !== 'active') {
        // Enforcement de bloqueo (Requirement 4.2): un cliente YA existente cuyo
        // status != "active" (p. ej. "blocked") no puede crear una nueva cita en
        // la sucursal. Solo aplica a clientes existentes; uno recien creado nunca
        // esta bloqueado. Antes del anti-duplicado, dentro de la misma tx.
        throw new HttpError(
          'El cliente esta bloqueado por el negocio y no puede reservar',
          409,
          'CUSTOMER_BLOCKED'
        );
      }

      // Anti-duplicado (Requirement 1): mismo cliente/servicio/dia activo ->
      // 409 DUPLICATE_BOOKING. Scoped al tenant de la sucursal.
      await assertNoDuplicateBooking(tx, branch.tenant_id, service.id, customer.id, startTime);

      return tx.appointment.create({
        data: {
          tenant_id: branch.tenant_id,
          branch_id: branchId,
          customer_id: customer.id,
          service_id: service.id,
          start_time: startTime,
          end_time: endTime,
          status: AppointmentStatus.PENDING,
          modality: normalizeModality(input.modality),
          contact_phone: input.contact_phone ?? null,
          home_address: input.home_address ?? null,
          maps_url: input.maps_url ?? null,
          booked_by_email: user.email ?? null,
          booked_by_name: user.name ?? null,
        },
      });
    });

    // 6. Auditoria best-effort (fuera de la transaccion).
    await writeAudit({
      tenant_id: branch.tenant_id,
      user_id: user.id,
      action: AuditAction.CREATE,
      resource_type: 'appointment',
      resource_id: appointment.id,
    });

    // 7. Hook de Google best-effort (fuera de la transaccion). Para citas en
    //    linea puede generar el enlace de Meet y persistir video_call_url.
    //    El hook nunca lanza, pero lo envolvemos defensivamente para que un
    //    error suyo jamas tumbe la reserva ya confirmada.
    try {
      await runGoogleAppointmentHook('created', branch.tenant_id, appointment.id);
    } catch {
      // Google es aditivo y best-effort: se ignora cualquier fallo.
    }

    // 8. Recargar la cita para leer video_call_url/modality que el hook pudo
    //    haber escrito. Si la recarga falla o no devuelve nada, caemos a los
    //    valores creados en la transaccion.
    const fresh = await prisma.appointment.findUnique({
      where: { id: appointment.id },
    });

    return {
      id: appointment.id,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
      status: appointment.status,
      service_id: appointment.service_id,
      video_call_url: fresh?.video_call_url ?? null,
      modality: fresh?.modality ?? appointment.modality,
    };
  },
};
