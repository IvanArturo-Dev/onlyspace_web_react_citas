import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * In-memory store simulating the subset of Prisma behaviour used by the
 * superadmin seed: tenant, userRole and user with upsert/findUnique/create/update.
 */
type Row = Record<string, any>;

function createInMemoryPrisma() {
  const tenants: Row[] = [];
  const userRoles: Row[] = [];
  const users: Row[] = [];

  const findBy = (rows: Row[], where: Row): Row | undefined =>
    rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));

  return {
    _stores: { tenants, userRoles, users },
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => findBy(tenants, where) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { ...data };
        tenants.push(row);
        return row;
      }),
    },
    userRole: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = findBy(userRoles, where);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create };
        userRoles.push(row);
        return row;
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => findBy(users, where) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `user-${users.length + 1}`, ...data };
        users.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = findBy(users, where);
        if (!existing) throw new Error('user not found');
        Object.assign(existing, data);
        return existing;
      }),
    },
  };
}

const mockPrisma = createInMemoryPrisma();

jest.mock('../prisma.service', () => ({
  prisma: mockPrisma,
}));

// Import after the mock is registered.
import { seedSuperAdmin } from '../seed-superadmin';

describe('seedSuperAdmin idempotency (Property 6)', () => {
  const EMAIL = 'xcode.arturo@gmail.com';

  beforeEach(() => {
    // Reset the in-memory stores between tests.
    mockPrisma._stores.tenants.length = 0;
    mockPrisma._stores.userRoles.length = 0;
    mockPrisma._stores.users.length = 0;
    process.env.SUPERADMIN_PASSWORD = 'test-super-secret-password';
    delete process.env.SUPERADMIN_EMAIL;
  });

  it('produces exactly one superadmin user pointing to the SUPERADMIN role when run twice', async () => {
    await seedSuperAdmin();
    await seedSuperAdmin();

    const superAdmins = mockPrisma._stores.users.filter((u) => u.email === EMAIL);
    expect(superAdmins).toHaveLength(1);

    const superRole = mockPrisma._stores.userRoles.find((r) => r.name === 'SUPERADMIN');
    expect(superRole).toBeDefined();
    expect(superRole!.id).toBe('superadmin-role');

    expect(superAdmins[0].role_id).toBe(superRole!.id);

    // The default tenant is created exactly once and remains consistent.
    const defaultTenants = mockPrisma._stores.tenants.filter((t) => t.id === 'default');
    expect(defaultTenants).toHaveLength(1);
  });

  it('does not create a second role or user across repeated runs', async () => {
    await seedSuperAdmin();
    await seedSuperAdmin();
    await seedSuperAdmin();

    expect(mockPrisma._stores.users).toHaveLength(1);
    expect(
      mockPrisma._stores.userRoles.filter((r) => r.name === 'SUPERADMIN')
    ).toHaveLength(1);
  });
});
