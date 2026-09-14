import { AuditAction, LoyaltyProgram, LoyaltyProgramType } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';

/**
 * Vista publica de un programa de lealtad devuelto por el servicio.
 */
export interface LoyaltyProgramView {
  id: string;
  tenant_id: string;
  name: string;
  type: LoyaltyProgramType;
  goal: number;
  window_days: number | null;
  reward_text: string;
  validity_days: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLoyaltyProgramInput {
  name: string;
  type: LoyaltyProgramType;
  goal: number;
  window_days?: number | null;
  reward_text: string;
  validity_days?: number | null;
}

export interface UpdateLoyaltyProgramInput {
  name?: string;
  type?: LoyaltyProgramType;
  goal?: number;
  window_days?: number | null;
  reward_text?: string;
  validity_days?: number | null;
}

const PROGRAM_TYPES: LoyaltyProgramType[] = ['ACCUMULATION', 'PERIODIC'];

/** Mapea un registro Prisma a la vista publica. */
function toView(record: LoyaltyProgram): LoyaltyProgramView {
  return {
    id: record.id,
    tenant_id: record.tenant_id,
    name: record.name,
    type: record.type,
    goal: record.goal,
    window_days: record.window_days ?? null,
    reward_text: record.reward_text,
    validity_days: record.validity_days ?? null,
    is_active: record.is_active,
    created_at:
      record.created_at instanceof Date
        ? record.created_at.toISOString()
        : new Date(record.created_at).toISOString(),
    updated_at:
      record.updated_at instanceof Date
        ? record.updated_at.toISOString()
        : new Date(record.updated_at).toISOString(),
  };
}

/** True si `value` es un entero >= `min`. */
function isIntAtLeast(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

/**
 * Valida la meta (goal): entero >= 1.
 * @throws HttpError 400 VALIDATION_ERROR
 */
function validateGoal(goal: unknown): void {
  if (!isIntAtLeast(goal, 1)) {
    throw new HttpError(
      'La meta (goal) debe ser un entero mayor o igual a 1',
      400,
      'VALIDATION_ERROR'
    );
  }
}

/**
 * Valida la ventana de tiempo segun el tipo:
 * - PERIODIC requiere window_days entero >= 1.
 * - ACCUMULATION no requiere ventana; si se envia debe ser valida (>= 1) o null.
 * @throws HttpError 400 VALIDATION_ERROR
 */
function validateWindow(type: LoyaltyProgramType, windowDays: unknown): void {
  if (type === 'PERIODIC') {
    if (!isIntAtLeast(windowDays, 1)) {
      throw new HttpError(
        'Un programa PERIODIC requiere window_days entero mayor o igual a 1',
        400,
        'VALIDATION_ERROR'
      );
    }
    return;
  }
  // ACCUMULATION: la ventana es opcional (null/undefined). Si se envia un valor
  // numerico debe ser valido.
  if (windowDays !== undefined && windowDays !== null && !isIntAtLeast(windowDays, 1)) {
    throw new HttpError(
      'window_days debe ser un entero mayor o igual a 1 o nulo',
      400,
      'VALIDATION_ERROR'
    );
  }
}

/**
 * Valida la vigencia de la recompensa: null/undefined (sin vencimiento) o entero >= 1.
 * @throws HttpError 400 VALIDATION_ERROR
 */
function validateValidity(validityDays: unknown): void {
  if (
    validityDays !== undefined &&
    validityDays !== null &&
    !isIntAtLeast(validityDays, 1)
  ) {
    throw new HttpError(
      'validity_days debe ser nulo o un entero mayor o igual a 1',
      400,
      'VALIDATION_ERROR'
    );
  }
}

/** Valida el tipo de programa. */
function validateType(type: unknown): asserts type is LoyaltyProgramType {
  if (!PROGRAM_TYPES.includes(type as LoyaltyProgramType)) {
    throw new HttpError(
      "El tipo debe ser 'ACCUMULATION' o 'PERIODIC'",
      400,
      'VALIDATION_ERROR'
    );
  }
}

/** Valida y normaliza un texto requerido, devolviendo el valor recortado. */
function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(`El campo ${field} es requerido`, 400, 'VALIDATION_ERROR');
  }
  return value.trim();
}

/**
 * Servicio CRUD de programas de lealtad para el emprendedor. Toda operacion
 * esta estrictamente delimitada por `tenantId`, de modo que un tenant nunca
 * puede leer ni modificar los programas de otro tenant
 * (Property 4: aislamiento por tenant).
 */
export const loyaltyProgramService = {
  /**
   * Lista los programas de lealtad del tenant, ordenados por fecha de creacion
   * descendente.
   */
  async list(tenantId: string): Promise<LoyaltyProgramView[]> {
    const records = await prisma.loyaltyProgram.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
    return records.map(toView);
  },

  /**
   * Devuelve un programa del tenant. Lanza 404 PROGRAM_NOT_FOUND si no existe o
   * pertenece a otro tenant (aislamiento).
   */
  async get(tenantId: string, id: string): Promise<LoyaltyProgramView> {
    const record = await prisma.loyaltyProgram.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!record) {
      throw new HttpError('Programa no encontrado', 404, 'PROGRAM_NOT_FOUND');
    }
    return toView(record);
  },

  /**
   * Crea un programa de lealtad para el tenant.
   *
   * Validaciones:
   * - name / reward_text requeridos.
   * - type valido (ACCUMULATION | PERIODIC).
   * - goal entero >= 1.
   * - PERIODIC requiere window_days >= 1; ACCUMULATION no lo requiere.
   * - validity_days nulo o >= 1.
   */
  async create(
    tenantId: string,
    input: CreateLoyaltyProgramInput,
    userId?: string
  ): Promise<LoyaltyProgramView> {
    const name = requireText(input.name, 'name');
    const rewardText = requireText(input.reward_text, 'reward_text');
    validateType(input.type);
    validateGoal(input.goal);
    validateWindow(input.type, input.window_days);
    validateValidity(input.validity_days);

    // ACCUMULATION nunca persiste una ventana de tiempo.
    const windowDays =
      input.type === 'PERIODIC' ? (input.window_days as number) : null;
    const validityDays =
      input.validity_days === undefined ? null : input.validity_days;

    const record = await prisma.loyaltyProgram.create({
      data: {
        tenant_id: tenantId,
        name,
        type: input.type,
        goal: input.goal,
        window_days: windowDays,
        reward_text: rewardText,
        validity_days: validityDays,
        is_active: true,
      },
    });

    await writeAudit({
      tenant_id: tenantId,
      user_id: userId,
      action: AuditAction.CREATE,
      resource_type: 'loyalty_program',
      resource_id: record.id,
      details: JSON.stringify({
        name: record.name,
        type: record.type,
        goal: record.goal,
        window_days: record.window_days,
        validity_days: record.validity_days,
      }),
    });

    return toView(record);
  },

  /**
   * Actualiza un programa del tenant. Valida pertenencia (404 PROGRAM_NOT_FOUND)
   * y aplica las mismas reglas de validacion que `create` sobre los campos
   * provistos. El tipo efectivo (para validar la ventana) es el nuevo tipo si se
   * envia, o el existente en caso contrario.
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateLoyaltyProgramInput,
    userId?: string
  ): Promise<LoyaltyProgramView> {
    const existing = await prisma.loyaltyProgram.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new HttpError('Programa no encontrado', 404, 'PROGRAM_NOT_FOUND');
    }

    const data: {
      name?: string;
      type?: LoyaltyProgramType;
      goal?: number;
      window_days?: number | null;
      reward_text?: string;
      validity_days?: number | null;
    } = {};

    if (input.name !== undefined) {
      data.name = requireText(input.name, 'name');
    }
    if (input.reward_text !== undefined) {
      data.reward_text = requireText(input.reward_text, 'reward_text');
    }
    if (input.type !== undefined) {
      validateType(input.type);
      data.type = input.type;
    }
    if (input.goal !== undefined) {
      validateGoal(input.goal);
      data.goal = input.goal;
    }

    // Tipo efectivo para validar la ventana de tiempo.
    const effectiveType = data.type ?? existing.type;

    if (effectiveType === 'PERIODIC') {
      // La ventana efectiva: nueva si se envia, existente en otro caso.
      const effectiveWindow =
        input.window_days !== undefined ? input.window_days : existing.window_days;
      validateWindow('PERIODIC', effectiveWindow);
      if (input.window_days !== undefined) {
        data.window_days = input.window_days;
      }
    } else {
      // ACCUMULATION: si se cambia a este tipo, se limpia la ventana; si se
      // envia window_days explicitamente, se valida (o se fuerza a null).
      if (input.window_days !== undefined) {
        validateWindow('ACCUMULATION', input.window_days);
      }
      if (data.type === 'ACCUMULATION' || input.window_days !== undefined) {
        data.window_days = null;
      }
    }

    if (input.validity_days !== undefined) {
      validateValidity(input.validity_days);
      data.validity_days = input.validity_days;
    }

    const record = await prisma.loyaltyProgram.update({
      where: { id: existing.id },
      data,
    });

    await writeAudit({
      tenant_id: tenantId,
      user_id: userId,
      action: AuditAction.UPDATE,
      resource_type: 'loyalty_program',
      resource_id: record.id,
      details: JSON.stringify(data),
    });

    return toView(record);
  },

  /**
   * Activa o desactiva un programa del tenant. Al desactivar NO se eliminan las
   * recompensas ya ganadas (Requirement 1.7): solo se marca `is_active = false`.
   * Lanza 404 PROGRAM_NOT_FOUND si no existe o es de otro tenant.
   */
  async setActive(
    tenantId: string,
    id: string,
    active: boolean,
    userId?: string
  ): Promise<LoyaltyProgramView> {
    const existing = await prisma.loyaltyProgram.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new HttpError('Programa no encontrado', 404, 'PROGRAM_NOT_FOUND');
    }

    const record = await prisma.loyaltyProgram.update({
      where: { id: existing.id },
      data: { is_active: active },
    });

    await writeAudit({
      tenant_id: tenantId,
      user_id: userId,
      action: AuditAction.UPDATE,
      resource_type: 'loyalty_program',
      resource_id: record.id,
      details: JSON.stringify({ is_active: active }),
    });

    return toView(record);
  },
};
