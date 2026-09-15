import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import { parseOfferedModalities } from '../utils/modality';

/**
 * Setup progress service — guia de uso para el emprendedor (ADMIN).
 *
 * Calcula, a partir de los DATOS REALES del negocio, que pasos de configuracion
 * ya estan cumplidos. Todo scoped por tenant_id. Se usan conteos/findFirst
 * eficientes (limit 1 / count con where) para no traer filas completas.
 *
 * Pasos:
 *  - branch   (obligatorio): al menos una sucursal activa.
 *  - service  (obligatorio): al menos un servicio activo.
 *  - schedule (obligatorio): al menos un horario activo (Schedule.is_active) o
 *                            al menos un dia de horario activo (ScheduleDay).
 *  - modality (obligatorio): offered_modalities definido y no vacio.
 *  - whatsapp (obligatorio): whatsapp_number no vacio.
 *  - branding (OPCIONAL):    logo_url no vacio.
 *  - share    (obligatorio): al menos una sucursal con booking_code (ya puede
 *                            compartir su QR/codigo).
 *
 * Los pasos opcionales NO cuentan para required_total ni penalizan el percent,
 * pero se incluyen en `steps` con `optional: true`.
 */

/** Etiqueta y opcionalidad de cada paso (en el orden en que se muestran). */
export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  optional: boolean;
}

export interface SetupProgress {
  steps: SetupStep[];
  required_done: number;
  required_total: number;
  percent: number;
  ready: boolean;
}

export const setupProgressService = {
  /**
   * Devuelve el progreso de configuracion del tenant. tenant inexistente ->
   * 404 TENANT_NOT_FOUND. Tenant-scoped.
   */
  async getSetupProgress(tenantId: string): Promise<SetupProgress> {
    // Datos del propio tenant (modalidades, whatsapp, marca).
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        offered_modalities: true,
        whatsapp_number: true,
        logo_url: true,
      },
    });

    if (!tenant) {
      throw new HttpError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    // Conteos/existencias eficientes, todos scoped por tenant. Se ejecutan en
    // paralelo porque son consultas independientes.
    const [
      activeBranchCount,
      activeServiceCount,
      activeScheduleCount,
      shareBranchCount,
    ] = await Promise.all([
      // branch: al menos una sucursal activa.
      prisma.branch.count({
        where: { tenant_id: tenantId, status: 'active' },
      }),
      // service: al menos un servicio activo.
      prisma.service.count({
        where: { tenant_id: tenantId, is_active: true },
      }),
      // schedule: al menos un horario activo del tenant.
      prisma.schedule.count({
        where: { tenant_id: tenantId, is_active: true },
      }),
      // share: al menos una sucursal (del tenant) con booking_code no nulo.
      prisma.branch.count({
        where: { tenant_id: tenantId, booking_code: { not: null } },
      }),
    ]);

    // schedule: si no hay Schedule activo, aceptar tambien la existencia de al
    // menos un ScheduleDay activo de algun horario del tenant.
    let hasSchedule = activeScheduleCount > 0;
    if (!hasSchedule) {
      const activeDay = await prisma.scheduleDay.findFirst({
        where: {
          is_active: true,
          schedule: { tenant_id: tenantId },
        },
        select: { id: true },
      });
      hasSchedule = activeDay != null;
    }

    // modality: offered_modalities definido y no vacio (por default siempre
    // trae al menos 'in_person', pero se valida por robustez).
    const modalities = parseOfferedModalities(tenant.offered_modalities);
    const hasModality = modalities.length > 0;

    // whatsapp: numero no vacio (tras trim).
    const hasWhatsapp = !!tenant.whatsapp_number && tenant.whatsapp_number.trim().length > 0;

    // branding (opcional): logo_url no vacio (tras trim).
    const hasBranding = !!tenant.logo_url && tenant.logo_url.trim().length > 0;

    const steps: SetupStep[] = [
      {
        key: 'branch',
        label: 'Crea tu sucursal',
        done: activeBranchCount > 0,
        optional: false,
      },
      {
        key: 'service',
        label: 'Crea un servicio',
        done: activeServiceCount > 0,
        optional: false,
      },
      {
        key: 'schedule',
        label: 'Configura tus horarios',
        done: hasSchedule,
        optional: false,
      },
      {
        key: 'modality',
        label: 'Elige las modalidades',
        done: hasModality,
        optional: false,
      },
      {
        key: 'whatsapp',
        label: 'Configura tu WhatsApp',
        done: hasWhatsapp,
        optional: false,
      },
      {
        key: 'branding',
        label: 'Personaliza tu marca',
        done: hasBranding,
        optional: true,
      },
      {
        key: 'share',
        label: 'Comparte tu codigo/QR',
        done: shareBranchCount > 0,
        optional: false,
      },
    ];

    // Solo los pasos obligatorios cuentan para el progreso.
    const requiredSteps = steps.filter((s) => !s.optional);
    const requiredTotal = requiredSteps.length;
    const requiredDone = requiredSteps.filter((s) => s.done).length;
    const percent =
      requiredTotal > 0 ? Math.round((requiredDone / requiredTotal) * 100) : 100;
    const ready = requiredDone === requiredTotal;

    return {
      steps,
      required_done: requiredDone,
      required_total: requiredTotal,
      percent,
      ready,
    };
  },
};
