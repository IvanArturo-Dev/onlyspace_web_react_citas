import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { HttpError } from '../../utils/errors';

// ---------------------------------------------------------------------------
// Mock de Prisma. Solo se mockean los modelos/metodos que ejercita el servicio
// de favoritos: tenant (findUnique/findMany), favorite (findUnique/create/
// delete/findMany) y branch (findMany).
// ---------------------------------------------------------------------------
const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  favorite: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  branch: {
    findMany: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Se importa despues del mock para que el servicio use el prisma mockeado.
import { favoriteService } from '../favorite.service';

describe('favoriteService.toggle (unit) - Property 7: idempotencia por par (user, tenant)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('crea el favorito cuando no existe y devuelve { favorited: true }', async () => {
    // Tenant valido, sin favorito previo.
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    mockPrisma.favorite.findUnique.mockResolvedValue(null as any);
    mockPrisma.favorite.create.mockResolvedValue({ id: 'fav-1' } as any);

    const result = await favoriteService.toggle('u1', 't1');

    // Valida el tenant antes de crear (Req 4.4).
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { id: true },
    });
    // Crea la fila con exactamente el par usuario-tenant.
    expect(mockPrisma.favorite.create).toHaveBeenCalledWith({
      data: { user_id: 'u1', tenant_id: 't1' },
    });
    expect(mockPrisma.favorite.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ favorited: true });
  });

  it('borra el favorito por id cuando ya existe y devuelve { favorited: false }', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    mockPrisma.favorite.findUnique.mockResolvedValue({ id: 'fav-1' } as any);
    mockPrisma.favorite.delete.mockResolvedValue({ id: 'fav-1' } as any);

    const result = await favoriteService.toggle('u1', 't1');

    expect(mockPrisma.favorite.delete).toHaveBeenCalledWith({
      where: { id: 'fav-1' },
    });
    expect(mockPrisma.favorite.create).not.toHaveBeenCalled();
    expect(result).toEqual({ favorited: false });
  });

  it('rechaza con 404 TENANT_NOT_FOUND y no crea favorito si el tenant no existe (Req 4.4)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null as any);

    await expect(favoriteService.toggle('u1', 'ghost')).rejects.toMatchObject({
      statusCode: 404,
      code: 'TENANT_NOT_FOUND',
    });
    await expect(favoriteService.toggle('u1', 'ghost')).rejects.toBeInstanceOf(
      HttpError
    );

    // Nunca se consulta ni se crea el favorito.
    expect(mockPrisma.favorite.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.favorite.create).not.toHaveBeenCalled();
  });

  it('es idempotente: dos toggles consecutivos alternan create->true y luego delete->false', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);

    // Primera llamada: no existe -> create -> true.
    // Segunda llamada: existe -> delete -> false.
    mockPrisma.favorite.findUnique
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ id: 'fav-1' } as any);
    mockPrisma.favorite.create.mockResolvedValue({ id: 'fav-1' } as any);
    mockPrisma.favorite.delete.mockResolvedValue({ id: 'fav-1' } as any);

    const first = await favoriteService.toggle('u1', 't1');
    const second = await favoriteService.toggle('u1', 't1');

    expect(first).toEqual({ favorited: true });
    expect(second).toEqual({ favorited: false });
    expect(mockPrisma.favorite.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.favorite.delete).toHaveBeenCalledTimes(1);
  });

  it('trata una carrera (create lanza P2002) como ya favorito -> { favorited: true }', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    mockPrisma.favorite.findUnique.mockResolvedValue(null as any);
    // Se usa la clase real de Prisma para que pase el `instanceof` del servicio.
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' }
    );
    mockPrisma.favorite.create.mockRejectedValue(p2002 as any);

    const result = await favoriteService.toggle('u1', 't1');

    expect(result).toEqual({ favorited: true });
  });

  it('propaga errores del create que no son violacion unica', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    mockPrisma.favorite.findUnique.mockResolvedValue(null as any);
    const boom = new Error('fallo inesperado de DB');
    mockPrisma.favorite.create.mockRejectedValue(boom as any);

    await expect(favoriteService.toggle('u1', 't1')).rejects.toBe(boom);
  });
});

describe('favoriteService.list (unit) - Property 8: aislamiento por cliente', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mapea business_name y code (primera sucursal con booking_code) filtrando por user_id', async () => {
    mockPrisma.favorite.findMany.mockResolvedValue([
      { id: 'f1', tenant_id: 't1', user_id: 'u1', created_at: new Date('2025-01-02') },
      { id: 'f2', tenant_id: 't2', user_id: 'u1', created_at: new Date('2025-01-01') },
    ] as any);
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'Barberia X' },
      { id: 't2', name: 'Spa Y' },
    ] as any);
    // La primera sucursal con booking_code por tenant (orden asc) es la principal.
    mockPrisma.branch.findMany.mockResolvedValue([
      { tenant_id: 't1', booking_code: 'bx' },
      { tenant_id: 't1', booking_code: 'bx-second' },
      { tenant_id: 't2', booking_code: 'sy' },
    ] as any);

    const result = await favoriteService.list('u1');

    // Property 8: la consulta se acota estrictamente al usuario.
    const call = mockPrisma.favorite.findMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({ user_id: 'u1' });
    expect(call.orderBy).toEqual({ created_at: 'desc' });

    expect(result).toEqual([
      { tenant_id: 't1', business_name: 'Barberia X', code: 'bx' },
      { tenant_id: 't2', business_name: 'Spa Y', code: 'sy' },
    ]);
  });

  it('devuelve code null cuando el negocio no tiene ninguna sucursal con booking_code', async () => {
    mockPrisma.favorite.findMany.mockResolvedValue([
      { id: 'f1', tenant_id: 't1', user_id: 'u1', created_at: new Date('2025-01-02') },
    ] as any);
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'Barberia X' },
    ] as any);
    // Sucursales sin booking_code (null): la principal aun no es reservable.
    mockPrisma.branch.findMany.mockResolvedValue([
      { tenant_id: 't1', booking_code: null },
    ] as any);

    const result = await favoriteService.list('u1');

    expect(result).toEqual([
      { tenant_id: 't1', business_name: 'Barberia X', code: null },
    ]);
  });

  it('devuelve [] sin consultar tenants ni sucursales cuando no hay favoritos', async () => {
    mockPrisma.favorite.findMany.mockResolvedValue([] as any);

    const result = await favoriteService.list('u1');

    expect(result).toEqual([]);
    expect(mockPrisma.tenant.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.branch.findMany).not.toHaveBeenCalled();
  });
});
