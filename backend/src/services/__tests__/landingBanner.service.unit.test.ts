import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks de prisma + audit (mismo patron que branding.service.unit.test.ts)
// ---------------------------------------------------------------------------
const mockPrisma = {
  landingBanner: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

const mockWriteAudit = jest.fn(async () => undefined);
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { landingBannerService } from '../landingBanner.service';
import { HttpError } from '../../utils/errors';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('landingBannerService.create', () => {
  it('lanza 400 VALIDATION_ERROR cuando title esta vacio tras trim', async () => {
    await expect(
      landingBannerService.create({ title: '   ' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(mockPrisma.landingBanner.create).not.toHaveBeenCalled();
  });

  it('crea un banner con defaults (sort_order 0, is_active true) y normaliza opcionales', async () => {
    mockPrisma.landingBanner.create.mockResolvedValue({
      id: 'b1',
      title: 'Hola',
      subtitle: null,
      image_url: null,
      link_url: null,
      sort_order: 0,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    } as any);

    const banner = await landingBannerService.create({
      title: '  Hola  ',
      subtitle: '   ', // empty tras trim -> null
    });

    expect(banner.title).toBe('Hola');
    const call = mockPrisma.landingBanner.create.mock.calls[0][0] as any;
    expect(call.data.title).toBe('Hola');
    expect(call.data.subtitle).toBeNull();
    expect(call.data.sort_order).toBe(0);
    expect(call.data.is_active).toBe(true);
  });
});

describe('landingBannerService.listActivePublic', () => {
  it('filtra por is_active y ordena por sort_order asc luego created_at asc', async () => {
    mockPrisma.landingBanner.findMany.mockResolvedValue([
      {
        id: 'b1',
        title: 'Uno',
        subtitle: 'sub',
        image_url: null,
        link_url: null,
      },
    ] as any);

    const banners = await landingBannerService.listActivePublic();

    const call = mockPrisma.landingBanner.findMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({ is_active: true });
    expect(call.orderBy).toEqual([
      { sort_order: 'asc' },
      { created_at: 'asc' },
    ]);
    // Shape publico reducido (sin timestamps ni is_active).
    expect(banners).toEqual([
      { id: 'b1', title: 'Uno', subtitle: 'sub', image_url: null, link_url: null },
    ]);
  });
});

describe('landingBannerService.update', () => {
  it('lanza 404 BANNER_NOT_FOUND cuando el banner no existe', async () => {
    mockPrisma.landingBanner.findUnique.mockResolvedValue(null as any);

    await expect(
      landingBannerService.update('missing', { title: 'x' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'BANNER_NOT_FOUND' });
    expect(mockPrisma.landingBanner.update).not.toHaveBeenCalled();
  });

  it('lanza 400 cuando se provee un title vacio', async () => {
    mockPrisma.landingBanner.findUnique.mockResolvedValue({ id: 'b1' } as any);

    await expect(
      landingBannerService.update('b1', { title: '   ' })
    ).rejects.toBeInstanceOf(HttpError);
    expect(mockPrisma.landingBanner.update).not.toHaveBeenCalled();
  });
});

describe('landingBannerService.remove', () => {
  it('lanza 404 BANNER_NOT_FOUND cuando el banner no existe', async () => {
    mockPrisma.landingBanner.findUnique.mockResolvedValue(null as any);

    await expect(
      landingBannerService.remove('missing')
    ).rejects.toMatchObject({ statusCode: 404, code: 'BANNER_NOT_FOUND' });
    expect(mockPrisma.landingBanner.delete).not.toHaveBeenCalled();
  });
});
