import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { tenantService } from '../tenant.service';
import { HttpError } from '../../utils/errors';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('tenantService.updateName', () => {
  it('actualiza y devuelve { id, name } cuando el nombre es valido', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    mockPrisma.tenant.update.mockResolvedValue({ id: 't1', name: 'Barberia Central' } as any);

    const result = await tenantService.updateName('t1', '  Barberia Central  ');

    expect(result).toEqual({ id: 't1', name: 'Barberia Central' });
    // El nombre se persiste ya recortado (trim).
    const call = mockPrisma.tenant.update.mock.calls[0][0] as any;
    expect(call.where).toEqual({ id: 't1' });
    expect(call.data).toEqual({ name: 'Barberia Central' });
    expect(call.select).toEqual({ id: true, name: true });
  });

  it('rechaza un nombre vacio con 400 VALIDATION_ERROR y no escribe', async () => {
    await expect(tenantService.updateName('t1', '')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('rechaza un nombre de solo espacios con 400 VALIDATION_ERROR', async () => {
    await expect(tenantService.updateName('t1', '     ')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('rechaza un nombre > 100 caracteres con 400 VALIDATION_ERROR', async () => {
    const tooLong = 'a'.repeat(101);
    await expect(tenantService.updateName('t1', tooLong)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('acepta exactamente 100 caracteres (limite inclusivo)', async () => {
    const exactly100 = 'a'.repeat(100);
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
    mockPrisma.tenant.update.mockResolvedValue({ id: 't1', name: exactly100 } as any);

    const result = await tenantService.updateName('t1', exactly100);
    expect(result).toEqual({ id: 't1', name: exactly100 });
  });

  it('rechaza un valor no-string con 400 VALIDATION_ERROR', async () => {
    await expect(tenantService.updateName('t1', undefined)).rejects.toBeInstanceOf(HttpError);
    await expect(tenantService.updateName('t1', 123 as any)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('lanza 404 TENANT_NOT_FOUND cuando el tenant no existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null as any);

    await expect(tenantService.updateName('missing', 'Nuevo Nombre')).rejects.toMatchObject({
      statusCode: 404,
      code: 'TENANT_NOT_FOUND',
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });
});
