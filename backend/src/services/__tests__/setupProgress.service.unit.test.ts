import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock — solo los modelos/metodos que usa el servicio.
// ---------------------------------------------------------------------------
const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
  branch: {
    count: jest.fn(),
  },
  service: {
    count: jest.fn(),
  },
  schedule: {
    count: jest.fn(),
  },
  scheduleDay: {
    findFirst: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { setupProgressService } from '../setupProgress.service';
import { HttpError } from '../../utils/errors';

/**
 * Unit tests para setupProgress.service.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.5**
 */
describe('setupProgressService.getSetupProgress', () => {
  const TENANT = 'tenant-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Configura un escenario "todo cumplido" y permite sobreescribir partes. */
  const setupAllDone = (overrides?: {
    tenant?: any;
    activeBranch?: number;
    activeService?: number;
    activeSchedule?: number;
    shareBranch?: number;
    activeDay?: any;
  }) => {
    mockPrisma.tenant.findUnique.mockResolvedValue(
      overrides?.tenant ?? {
        offered_modalities: 'in_person,home',
        whatsapp_number: '5215555555555',
        logo_url: 'https://cdn/logo.png',
      }
    );
    // branch.count se llama dos veces: [activeBranch, shareBranch].
    mockPrisma.branch.count
      .mockResolvedValueOnce(overrides?.activeBranch ?? 1)
      .mockResolvedValueOnce(overrides?.shareBranch ?? 1);
    mockPrisma.service.count.mockResolvedValue(overrides?.activeService ?? 1);
    mockPrisma.schedule.count.mockResolvedValue(overrides?.activeSchedule ?? 1);
    mockPrisma.scheduleDay.findFirst.mockResolvedValue(
      overrides?.activeDay ?? null
    );
  };

  it('404 TENANT_NOT_FOUND cuando el tenant no existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    await expect(
      setupProgressService.getSetupProgress(TENANT)
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('marca todos los pasos y ready=true / percent=100 cuando todo esta cumplido', async () => {
    setupAllDone();
    const r = await setupProgressService.getSetupProgress(TENANT);

    expect(r.steps).toHaveLength(7);
    expect(r.required_total).toBe(6); // 7 pasos - 1 opcional (branding)
    expect(r.required_done).toBe(6);
    expect(r.percent).toBe(100);
    expect(r.ready).toBe(true);
    // el paso opcional existe y esta marcado optional:true
    const branding = r.steps.find((s) => s.key === 'branding');
    expect(branding?.optional).toBe(true);
    expect(branding?.done).toBe(true);
  });

  it('los pasos opcionales NO cuentan para required_total ni penalizan el percent', async () => {
    // branding (opcional) sin cumplir: sin logo_url.
    setupAllDone({
      tenant: {
        offered_modalities: 'in_person',
        whatsapp_number: '5215555555555',
        logo_url: null,
      },
    });
    const r = await setupProgressService.getSetupProgress(TENANT);

    expect(r.required_total).toBe(6);
    expect(r.required_done).toBe(6);
    expect(r.percent).toBe(100);
    expect(r.ready).toBe(true);
    expect(r.steps.find((s) => s.key === 'branding')?.done).toBe(false);
  });

  it('calcula percent con redondeo sobre pasos obligatorios (3/6 -> 50, ready=false)', async () => {
    // Cumplidos: branch, service, modality (offered_modalities siempre trae al
    // menos 'in_person'). Faltan: schedule, whatsapp, share.
    setupAllDone({
      tenant: {
        offered_modalities: 'in_person',
        whatsapp_number: '',
        logo_url: null,
      },
      activeSchedule: 0,
      activeDay: null,
      shareBranch: 0,
    });
    const r = await setupProgressService.getSetupProgress(TENANT);

    // done: branch, service, modality = 3. schedule/whatsapp/share = no.
    expect(r.required_done).toBe(3);
    expect(r.required_total).toBe(6);
    expect(r.percent).toBe(50);
    expect(r.ready).toBe(false);
  });

  it('acepta schedule via ScheduleDay activo cuando no hay Schedule activo', async () => {
    setupAllDone({ activeSchedule: 0, activeDay: { id: 'day-1' } });
    const r = await setupProgressService.getSetupProgress(TENANT);

    expect(r.steps.find((s) => s.key === 'schedule')?.done).toBe(true);
    expect(r.ready).toBe(true);
  });

  it('schedule no cumplido cuando no hay Schedule activo ni ScheduleDay activo', async () => {
    setupAllDone({ activeSchedule: 0, activeDay: null });
    const r = await setupProgressService.getSetupProgress(TENANT);

    expect(r.steps.find((s) => s.key === 'schedule')?.done).toBe(false);
    expect(r.ready).toBe(false);
  });
});
