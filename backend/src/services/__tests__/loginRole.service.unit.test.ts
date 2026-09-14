import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock: only authorizedAdmin.findUnique is needed to resolve the role.
// ---------------------------------------------------------------------------
const mockPrisma = {
  authorizedAdmin: {
    findUnique: jest.fn(),
  },
  assistant: {
    findFirst: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// authorizationService is only reached for the edge case of an active admin
// with no tenant_id. We mock it to observe when it is invoked.
const mockAuthorize = jest.fn();
jest.mock('../authorization.service', () => ({
  authorizationService: {
    authorize: (email: string) => mockAuthorize(email),
  },
}));

const SUPERADMIN_EMAIL = 'xcode.arturo@gmail.com';

describe('resolveLoginRole (unit) - Property 1: whitelist is the only path to ADMIN', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPERADMIN_EMAIL = SUPERADMIN_EMAIL;
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue(null);
    mockPrisma.assistant.findFirst.mockResolvedValue(null);
  });

  it('resolves the super admin email to SUPERADMIN with default tenant', async () => {
    const { resolveLoginRole } = await import('../loginRole.service');

    const result = await resolveLoginRole('  XCode.Arturo@Gmail.com ');

    expect(result).toEqual({ role: 'SUPERADMIN', tenant_id: 'default' });
    // Super admin decision never touches the whitelist.
    expect(mockPrisma.authorizedAdmin.findUnique).not.toHaveBeenCalled();
  });

  it('resolves an active AuthorizedAdmin to ADMIN with its own tenant_id', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue({
      id: 'aa-1',
      email: 'owner@example.com',
      status: 'active',
      tenant_id: 'tenant-owner',
    } as any);

    const { resolveLoginRole } = await import('../loginRole.service');

    const result = await resolveLoginRole('owner@example.com');

    expect(result).toEqual({ role: 'ADMIN', tenant_id: 'tenant-owner' });
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it('normalizes the email before looking it up in the whitelist', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue({
      id: 'aa-2',
      email: 'owner@example.com',
      status: 'active',
      tenant_id: 'tenant-owner',
    } as any);

    const { resolveLoginRole } = await import('../loginRole.service');
    await resolveLoginRole('  Owner@Example.COM ');

    expect(mockPrisma.authorizedAdmin.findUnique).toHaveBeenCalledWith({
      where: { email: 'owner@example.com' },
    });
  });

  it('resolves a revoked AuthorizedAdmin to CLIENT (no ADMIN)', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue({
      id: 'aa-3',
      email: 'revoked@example.com',
      status: 'revoked',
      tenant_id: 'tenant-revoked',
    } as any);

    const { resolveLoginRole } = await import('../loginRole.service');

    const result = await resolveLoginRole('revoked@example.com');

    expect(result).toEqual({ role: 'CLIENT', tenant_id: 'default' });
  });

  it('resolves an unknown email to CLIENT with default tenant', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue(null);

    const { resolveLoginRole } = await import('../loginRole.service');

    const result = await resolveLoginRole('stranger@example.com');

    expect(result).toEqual({ role: 'CLIENT', tenant_id: 'default' });
  });

  it('Property 1: the only way to obtain ADMIN is being an active AuthorizedAdmin (or the super admin)', async () => {
    const { resolveLoginRole } = await import('../loginRole.service');

    // Non-active/absent whitelist entries never yield ADMIN.
    const statuses = [null, { status: 'revoked', tenant_id: 't' }, { status: 'pending', tenant_id: 't' }];
    for (const entry of statuses) {
      mockPrisma.authorizedAdmin.findUnique.mockResolvedValueOnce(
        entry ? ({ id: 'x', email: 'e@e.com', ...entry } as any) : null
      );
      const result = await resolveLoginRole('e@e.com');
      expect(result.role).not.toBe('ADMIN');
    }
  });

  it('edge case: active admin without tenant_id ensures a tenant via authorize()', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue({
      id: 'aa-4',
      email: 'newowner@example.com',
      status: 'active',
      tenant_id: null,
    } as any);
    mockAuthorize.mockResolvedValue({
      id: 'aa-4',
      email: 'newowner@example.com',
      status: 'active',
      tenant_id: 'tenant-created',
      booking_code: 'ABC123',
      created_at: new Date().toISOString(),
    } as any);

    const { resolveLoginRole } = await import('../loginRole.service');

    const result = await resolveLoginRole('newowner@example.com');

    expect(mockAuthorize).toHaveBeenCalledWith('newowner@example.com');
    expect(result).toEqual({ role: 'ADMIN', tenant_id: 'tenant-created' });
  });

  it('resolves an active Assistant to ASSISTANT with the emprendedor tenant', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue(null);
    mockPrisma.assistant.findFirst.mockResolvedValue({
      id: 'as-1',
      email: 'assistant@example.com',
      status: 'active',
      tenant_id: 'tenant-owner',
    } as any);

    const { resolveLoginRole } = await import('../loginRole.service');
    const result = await resolveLoginRole('assistant@example.com');

    expect(result).toEqual({ role: 'ASSISTANT', tenant_id: 'tenant-owner' });
    expect(mockPrisma.assistant.findFirst).toHaveBeenCalledWith({
      where: { email: 'assistant@example.com', status: 'active' },
    });
  });

  it('ADMIN prevalece sobre ASSISTANT cuando el email es ambos', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue({
      id: 'aa-1',
      email: 'both@example.com',
      status: 'active',
      tenant_id: 'tenant-admin',
    } as any);
    // No debe consultarse assistant si ya es ADMIN.
    const { resolveLoginRole } = await import('../loginRole.service');
    const result = await resolveLoginRole('both@example.com');

    expect(result).toEqual({ role: 'ADMIN', tenant_id: 'tenant-admin' });
    expect(mockPrisma.assistant.findFirst).not.toHaveBeenCalled();
  });

  it('un email sin admin ni assistant activos sigue siendo CLIENT', async () => {
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue(null);
    mockPrisma.assistant.findFirst.mockResolvedValue(null);

    const { resolveLoginRole } = await import('../loginRole.service');
    const result = await resolveLoginRole('plain@example.com');

    expect(result).toEqual({ role: 'CLIENT', tenant_id: 'default' });
  });
});
