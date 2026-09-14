import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  moduleFlag: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

/**
 * Helper que resuelve findUnique en funcion de la clave unica solicitada,
 * emulando el comportamiento de prisma sobre un dataset en memoria.
 */
function wireFindFirst(flags: Array<{
  scope: string;
  tenant_id: string | null;
  module_key: string;
  enabled: boolean;
}>) {
  mockPrisma.moduleFlag.findFirst.mockImplementation((args: any) => {
    const { scope, tenant_id, module_key } = args.where;
    const found = flags.find(
      (f) => f.scope === scope && f.tenant_id === tenant_id && f.module_key === module_key
    );
    return Promise.resolve((found ?? null) as any);
  });
}

describe('moduleService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isModuleEnabled - Property 9: modulo deshabilitado bloquea', () => {
    it('flag tenant enabled=false -> false', async () => {
      wireFindFirst([
        { scope: 'tenant', tenant_id: 'tenant-a', module_key: 'branches', enabled: false },
      ]);

      const { moduleService } = await import('../module.service');
      await expect(moduleService.isModuleEnabled('tenant-a', 'branches')).resolves.toBe(false);
    });

    it('sin flag tenant pero system enabled=false -> false', async () => {
      wireFindFirst([
        { scope: 'system', tenant_id: null, module_key: 'branches', enabled: false },
      ]);

      const { moduleService } = await import('../module.service');
      await expect(moduleService.isModuleEnabled('tenant-a', 'branches')).resolves.toBe(false);
    });

    it('sin flags -> true (habilitado por defecto)', async () => {
      wireFindFirst([]);

      const { moduleService } = await import('../module.service');
      await expect(moduleService.isModuleEnabled('tenant-a', 'branches')).resolves.toBe(true);
    });

    it('el flag de tenant gana sobre el flag de system', async () => {
      wireFindFirst([
        { scope: 'system', tenant_id: null, module_key: 'branches', enabled: false },
        { scope: 'tenant', tenant_id: 'tenant-a', module_key: 'branches', enabled: true },
      ]);

      const { moduleService } = await import('../module.service');
      await expect(moduleService.isModuleEnabled('tenant-a', 'branches')).resolves.toBe(true);
    });
  });

  describe('setFlag - validacion de scope y tenant_id', () => {
    it('crea flag system con tenant_id null cuando no existe', async () => {
      mockPrisma.moduleFlag.findFirst.mockResolvedValue(null as any);
      mockPrisma.moduleFlag.create.mockResolvedValue({
        id: 'flag-1',
        scope: 'system',
        tenant_id: null,
        module_key: 'search',
        enabled: false,
      } as any);

      const { moduleService } = await import('../module.service');
      await moduleService.setFlag({ scope: 'system', module_key: 'search', enabled: false });

      expect(mockPrisma.moduleFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { scope: 'system', tenant_id: null, module_key: 'search', enabled: false },
        })
      );
    });

    it('actualiza flag tenant existente por id', async () => {
      mockPrisma.moduleFlag.findFirst.mockResolvedValue({
        id: 'flag-9',
        scope: 'tenant',
        tenant_id: 'tenant-a',
        module_key: 'search',
        enabled: true,
      } as any);
      mockPrisma.moduleFlag.update.mockResolvedValue({
        id: 'flag-9',
        scope: 'tenant',
        tenant_id: 'tenant-a',
        module_key: 'search',
        enabled: false,
      } as any);

      const { moduleService } = await import('../module.service');
      await moduleService.setFlag({
        scope: 'tenant',
        tenant_id: 'tenant-a',
        module_key: 'search',
        enabled: false,
      });

      expect(mockPrisma.moduleFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'flag-9' }, data: { enabled: false } })
      );
      expect(mockPrisma.moduleFlag.create).not.toHaveBeenCalled();
    });

    it('rechaza scope invalido con 400 INVALID_SCOPE', async () => {
      const { moduleService } = await import('../module.service');
      await expect(
        moduleService.setFlag({ scope: 'global', module_key: 'search', enabled: true })
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_SCOPE' });
      expect(mockPrisma.moduleFlag.create).not.toHaveBeenCalled();
    });

    it('rechaza scope tenant sin tenant_id con 400 TENANT_REQUIRED', async () => {
      const { moduleService } = await import('../module.service');
      await expect(
        moduleService.setFlag({ scope: 'tenant', module_key: 'search', enabled: true })
      ).rejects.toMatchObject({ statusCode: 400, code: 'TENANT_REQUIRED' });
      expect(mockPrisma.moduleFlag.create).not.toHaveBeenCalled();
    });
  });
});
