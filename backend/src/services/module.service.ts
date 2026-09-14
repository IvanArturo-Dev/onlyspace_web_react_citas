import { AuditAction, ModuleFlag } from '@prisma/client';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { writeAudit } from '../utils/audit';

export type ModuleScope = 'system' | 'tenant';

export interface SetFlagInput {
  scope: ModuleScope | string;
  tenant_id?: string | null;
  module_key: string;
  enabled: boolean;
}

/**
 * Servicio de conmutacion de modulos (feature flags) a nivel de sistema o de
 * emprendedor (tenant). Un flag scope 'tenant' para un tenant especifico tiene
 * prioridad sobre el flag scope 'system' del mismo module_key.
 */
export const moduleService = {
  /**
   * Lista todos los flags de modulo (sin filtro; uso del super admin).
   */
  async list(): Promise<ModuleFlag[]> {
    return prisma.moduleFlag.findMany();
  },

  /**
   * Upsert de un ModuleFlag por la clave unica [scope, tenant_id, module_key].
   *
   * Validaciones:
   * - scope debe ser 'system' o 'tenant' (400 INVALID_SCOPE).
   * - scope 'system' -> tenant_id debe ser null.
   * - scope 'tenant' -> tenant_id es requerido (400 TENANT_REQUIRED).
   */
  async setFlag(input: SetFlagInput): Promise<ModuleFlag> {
    const { scope, module_key, enabled } = input;

    if (scope !== 'system' && scope !== 'tenant') {
      throw new HttpError('scope invalido', 400, 'INVALID_SCOPE');
    }

    if (!module_key || !String(module_key).trim()) {
      throw new HttpError('module_key requerido', 400, 'INVALID_MODULE_KEY');
    }

    // Normalizar tenant_id segun el scope.
    const tenantId = scope === 'system' ? null : input.tenant_id ?? null;

    if (scope === 'tenant' && !tenantId) {
      throw new HttpError('tenant_id requerido para scope tenant', 400, 'TENANT_REQUIRED');
    }

    // Nota: Prisma no admite `null` en el `where` de una clave unica compuesta
    // con campo anulable (tenant_id). Por eso se hace el upsert manualmente con
    // findFirst + create/update en lugar de prisma.upsert.
    const existing = await prisma.moduleFlag.findFirst({
      where: { scope, tenant_id: tenantId, module_key },
    });

    const flag = existing
      ? await prisma.moduleFlag.update({
          where: { id: existing.id },
          data: { enabled },
        })
      : await prisma.moduleFlag.create({
          data: { scope, tenant_id: tenantId, module_key, enabled },
        });

    // Auditar la conmutacion del modulo (best-effort).
    await writeAudit({
      // Para flags de sistema no hay tenant asociado; se usa 'system' como marcador.
      tenant_id: tenantId ?? 'system',
      action: AuditAction.UPDATE,
      resource_type: 'module_flag',
      resource_id: flag.id,
      details: JSON.stringify({ scope, tenant_id: tenantId, module_key, enabled }),
    });

    return flag;
  },

  /**
   * Resuelve el estado efectivo de un modulo para un tenant:
   * 1. Si existe un flag scope 'tenant' para ese tenant+key -> usa su enabled.
   * 2. Si no, si existe un flag scope 'system' para ese key -> usa su enabled.
   * 3. Si no hay flags -> habilitado por defecto (true).
   */
  async isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
    const tenantFlag = await prisma.moduleFlag.findFirst({
      where: { scope: 'tenant', tenant_id: tenantId, module_key: moduleKey },
    });
    if (tenantFlag) {
      return tenantFlag.enabled;
    }

    const systemFlag = await prisma.moduleFlag.findFirst({
      where: { scope: 'system', tenant_id: null, module_key: moduleKey },
    });
    if (systemFlag) {
      return systemFlag.enabled;
    }

    return true;
  },
};
