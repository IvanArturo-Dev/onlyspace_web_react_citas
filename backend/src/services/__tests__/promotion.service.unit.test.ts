import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock de Prisma: solo los delegados usados por promotion.service.
// ---------------------------------------------------------------------------
const mockPrisma = {
  branch: {
    findFirst: jest.fn(),
  },
  promotion: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { promotionService } from '../promotion.service';

// Sucursal propia por defecto (assertBranchOwned pasa).
function ownedBranch() {
  mockPrisma.branch.findFirst.mockResolvedValue({ id: 'branch-1' } as any);
}

function makePromo(overrides: Record<string, any> = {}) {
  return {
    id: 'promo-1',
    tenant_id: 'tenant-1',
    branch_id: 'branch-1',
    title: 'Promo',
    description: null,
    image_url: null,
    starts_at: null,
    ends_at: null,
    is_active: true,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('promotionService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // create - Property 3: validacion de datos
  // -------------------------------------------------------------------------
  describe('create - Property 3: validacion de datos', () => {
    it('crea la promo con title valido y pasa tenant/branch/title(trim) a create', async () => {
      ownedBranch();
      mockPrisma.promotion.create.mockResolvedValue(makePromo({ title: 'Oferta' }) as any);

      const result = await promotionService.create('tenant-1', 'branch-1', {
        title: '  Oferta  ',
      });

      expect(mockPrisma.promotion.create).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.promotion.create.mock.calls[0][0] as any;
      expect(arg.data.tenant_id).toBe('tenant-1');
      expect(arg.data.branch_id).toBe('branch-1');
      expect(arg.data.title).toBe('Oferta');
      expect(arg.data.is_active).toBe(true);
      expect(result.title).toBe('Oferta');
    });

    it('title vacio -> 400 VALIDATION_ERROR sin llamar a create', async () => {
      ownedBranch();

      await expect(
        promotionService.create('tenant-1', 'branch-1', { title: '   ' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

      expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
    });

    it('ends_at < starts_at -> 400 sin llamar a create', async () => {
      ownedBranch();

      await expect(
        promotionService.create('tenant-1', 'branch-1', {
          title: 'Oferta',
          starts_at: '2025-06-10T00:00:00Z',
          ends_at: '2025-06-01T00:00:00Z',
        })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

      expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Aislamiento - Property 4: sucursal ajena -> 404 BRANCH_NOT_FOUND
  // -------------------------------------------------------------------------
  describe('Property 4: aislamiento por tenant/sucursal (sucursal ajena)', () => {
    beforeEach(() => {
      mockPrisma.branch.findFirst.mockResolvedValue(null as any);
    });

    it('create sobre sucursal ajena -> 404 sin tocar promotion', async () => {
      await expect(
        promotionService.create('tenant-1', 'branch-x', { title: 'Oferta' })
      ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
      expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
    });

    it('list sobre sucursal ajena -> 404 sin tocar promotion', async () => {
      await expect(
        promotionService.list('tenant-1', 'branch-x')
      ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
      expect(mockPrisma.promotion.findMany).not.toHaveBeenCalled();
    });

    it('update sobre sucursal ajena -> 404 sin tocar promotion', async () => {
      await expect(
        promotionService.update('tenant-1', 'branch-x', 'promo-1', { title: 'x' })
      ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
      expect(mockPrisma.promotion.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.promotion.update).not.toHaveBeenCalled();
    });

    it('remove sobre sucursal ajena -> 404 sin tocar promotion', async () => {
      await expect(
        promotionService.remove('tenant-1', 'branch-x', 'promo-1')
      ).rejects.toMatchObject({ statusCode: 404, code: 'BRANCH_NOT_FOUND' });
      expect(mockPrisma.promotion.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.promotion.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // update - promo inexistente / rango de fechas efectivo
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('promo inexistente -> 404 PROMOTION_NOT_FOUND sin update', async () => {
      ownedBranch();
      mockPrisma.promotion.findFirst.mockResolvedValue(null as any);

      await expect(
        promotionService.update('tenant-1', 'branch-1', 'promo-x', { title: 'x' })
      ).rejects.toMatchObject({ statusCode: 404, code: 'PROMOTION_NOT_FOUND' });
      expect(mockPrisma.promotion.update).not.toHaveBeenCalled();
    });

    it('ends_at < starts_at efectivos -> 400 sin update (usa existente + entrante)', async () => {
      ownedBranch();
      // Existente tiene starts_at en junio 10; el input solo cambia ends_at a junio 1.
      mockPrisma.promotion.findFirst.mockResolvedValue(
        makePromo({ starts_at: new Date('2025-06-10T00:00:00Z') }) as any
      );

      await expect(
        promotionService.update('tenant-1', 'branch-1', 'promo-1', {
          ends_at: '2025-06-01T00:00:00Z',
        })
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(mockPrisma.promotion.update).not.toHaveBeenCalled();
    });

    it('actualiza solo los campos provistos (null limpia description)', async () => {
      ownedBranch();
      mockPrisma.promotion.findFirst.mockResolvedValue(makePromo() as any);
      mockPrisma.promotion.update.mockResolvedValue(makePromo({ description: null }) as any);

      await promotionService.update('tenant-1', 'branch-1', 'promo-1', {
        description: null,
      });

      const arg = mockPrisma.promotion.update.mock.calls[0][0] as any;
      expect(arg.data).toHaveProperty('description', null);
      expect(arg.data).not.toHaveProperty('title');
      expect(arg.data).not.toHaveProperty('is_active');
    });
  });

  // -------------------------------------------------------------------------
  // remove - camino feliz
  // -------------------------------------------------------------------------
  describe('remove', () => {
    it('borra y devuelve { id }', async () => {
      ownedBranch();
      mockPrisma.promotion.findFirst.mockResolvedValue({ id: 'promo-1' } as any);
      mockPrisma.promotion.delete.mockResolvedValue(makePromo() as any);

      const result = await promotionService.remove('tenant-1', 'branch-1', 'promo-1');

      expect(mockPrisma.promotion.delete).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
      });
      expect(result).toEqual({ id: 'promo-1' });
    });
  });

  // -------------------------------------------------------------------------
  // listActivePublic - Property 1: vigencia (filtro en query)
  // -------------------------------------------------------------------------
  describe('listActivePublic - Property 1: vigencia', () => {
    it('construye el where con is_active true + OR de starts/ends y no re-filtra en memoria', async () => {
      const now = new Date('2025-06-05T00:00:00Z');
      // El mock devuelve 3 promos (vigente, expirada, futura). Como el filtro
      // es en query, el servicio devuelve TODO lo que el mock retorna (no
      // re-filtra en memoria): confirma que el filtrado recae en el where.
      const returned = [
        makePromo({ id: 'vigente' }),
        makePromo({ id: 'expirada' }),
        makePromo({ id: 'futura' }),
      ];
      mockPrisma.promotion.findMany.mockResolvedValue(returned as any);

      const result = await promotionService.listActivePublic('branch-1', now);

      expect(result).toHaveLength(3);

      const arg = mockPrisma.promotion.findMany.mock.calls[0][0] as any;
      expect(arg.where.branch_id).toBe('branch-1');
      expect(arg.where.is_active).toBe(true);
      expect(arg.where.AND).toEqual([
        { OR: [{ starts_at: null }, { starts_at: { lte: now } }] },
        { OR: [{ ends_at: null }, { ends_at: { gte: now } }] },
      ]);
      expect(arg.orderBy).toEqual({ created_at: 'desc' });
    });
  });

  // -------------------------------------------------------------------------
  // activeForBranches - lote agrupado por branch_id
  // -------------------------------------------------------------------------
  describe('activeForBranches', () => {
    it('[] -> Map vacio sin consultar', async () => {
      const result = await promotionService.activeForBranches([]);
      expect(result.size).toBe(0);
      expect(mockPrisma.promotion.findMany).not.toHaveBeenCalled();
    });

    it('agrupa las promos por branch_id', async () => {
      const now = new Date('2025-06-05T00:00:00Z');
      mockPrisma.promotion.findMany.mockResolvedValue([
        makePromo({ id: 'p1', branch_id: 'branch-1' }),
        makePromo({ id: 'p2', branch_id: 'branch-1' }),
        makePromo({ id: 'p3', branch_id: 'branch-2' }),
      ] as any);

      const result = await promotionService.activeForBranches(
        ['branch-1', 'branch-2'],
        now
      );

      const arg = mockPrisma.promotion.findMany.mock.calls[0][0] as any;
      expect(arg.where.branch_id).toEqual({ in: ['branch-1', 'branch-2'] });
      expect(arg.where.is_active).toBe(true);

      expect(result.size).toBe(2);
      expect(result.get('branch-1')).toHaveLength(2);
      expect(result.get('branch-2')).toHaveLength(1);
    });
  });
});
