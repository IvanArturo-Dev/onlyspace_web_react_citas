import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// In-memory store backing the Prisma mock
// ---------------------------------------------------------------------------
interface FakeAuthorizedAdmin {
  id: string;
  email: string;
  status: string;
  tenant_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface FakeTenant {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  booking_code: string | null;
  booking_enabled: boolean;
}

interface FakeBranch {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  booking_code: string | null;
}

let admins: FakeAuthorizedAdmin[] = [];
let tenants: FakeTenant[] = [];
let branches: FakeBranch[] = [];
let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const mockPrisma = {
  authorizedAdmin: {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.email !== undefined) {
        return admins.find((a) => a.email === where.email) ?? null;
      }
      return admins.find((a) => a.id === where.id) ?? null;
    }),
    findMany: jest.fn(async (_args?: any) => {
      // ordered by created_at desc
      return [...admins].sort(
        (a, b) => b.created_at.getTime() - a.created_at.getTime()
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      const now = new Date();
      const record: FakeAuthorizedAdmin = {
        id: nextId('admin'),
        email: data.email,
        status: data.status ?? 'active',
        tenant_id: data.tenant_id ?? null,
        created_by: data.created_by ?? null,
        created_at: now,
        updated_at: now,
      };
      admins.push(record);
      return record;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const record = admins.find((a) => a.id === where.id);
      if (!record) throw new Error('Record to update not found');
      Object.assign(record, data, { updated_at: new Date() });
      return record;
    }),
  },
  tenant: {
    findUnique: jest.fn(async ({ where, select }: any) => {
      let found: FakeTenant | undefined;
      if (where.booking_code !== undefined) {
        found = tenants.find((t) => t.booking_code === where.booking_code);
      } else if (where.subdomain !== undefined) {
        found = tenants.find((t) => t.subdomain === where.subdomain);
      } else if (where.id !== undefined) {
        found = tenants.find((t) => t.id === where.id);
      }
      if (!found) return null;
      // Prisma returns only selected fields; the service only reads
      // booking_code / id, so returning the full object is safe.
      void select;
      return found;
    }),
    findMany: jest.fn(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      return tenants.filter((t) => ids.includes(t.id));
    }),
    create: jest.fn(async ({ data }: any) => {
      const record: FakeTenant = {
        id: nextId('tenant'),
        name: data.name,
        subdomain: data.subdomain,
        status: data.status ?? 'active',
        booking_code: data.booking_code ?? null,
        booking_enabled: data.booking_enabled ?? true,
      };
      tenants.push(record);
      return record;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const record = tenants.find((t) => t.id === where.id);
      if (!record) throw new Error('Tenant to update not found');
      Object.assign(record, data);
      return record;
    }),
  },
  branch: {
    findFirst: jest.fn(async ({ where }: any) => {
      if (where?.tenant_id !== undefined) {
        return branches.find((b) => b.tenant_id === where.tenant_id) ?? null;
      }
      return branches[0] ?? null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.booking_code !== undefined) {
        return branches.find((b) => b.booking_code === where.booking_code) ?? null;
      }
      return branches.find((b) => b.id === where.id) ?? null;
    }),
    create: jest.fn(async ({ data }: any) => {
      const record: FakeBranch = {
        id: nextId('branch'),
        tenant_id: data.tenant_id,
        name: data.name,
        status: data.status ?? 'active',
        booking_code: data.booking_code ?? null,
      };
      branches.push(record);
      return record;
    }),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Imported after the mock is registered.
import { authorizationService } from '../authorization.service';

describe('authorizationService', () => {
  beforeEach(() => {
    admins = [];
    tenants = [];
    branches = [];
    idCounter = 0;
    jest.clearAllMocks();
  });

  it('authorize(email nuevo) crea tenant + booking_code y admin activo con tenant_id', async () => {
    const view = await authorizationService.authorize('Owner@Example.com', 'super-1');

    expect(view.email).toBe('owner@example.com'); // normalizado
    expect(view.status).toBe('active');
    expect(view.tenant_id).toBeTruthy();
    expect(view.booking_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    // Se creo exactamente un tenant y un admin.
    expect(tenants).toHaveLength(1);
    expect(admins).toHaveLength(1);
    expect(admins[0].tenant_id).toBe(view.tenant_id);
    expect(admins[0].created_by).toBe('super-1');
  });

  it('authorize(email nuevo) crea una sucursal inicial "Principal" con su propio codigo', async () => {
    const view = await authorizationService.authorize('newbiz@example.com', 'super-1');

    expect(branches).toHaveLength(1);
    const branch = branches[0];
    expect(branch.tenant_id).toBe(view.tenant_id);
    expect(branch.name).toBe('Principal');
    expect(branch.status).toBe('active');
    expect(branch.booking_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    // El codigo de la sucursal es propio (distinto del codigo del tenant).
    expect(branch.booking_code).not.toBe(view.booking_code);
  });

  it('authorize repetido es idempotente respecto a la sucursal inicial', async () => {
    await authorizationService.authorize('idem@example.com');
    await authorizationService.authorize('IDEM@example.com');

    expect(branches).toHaveLength(1);
  });

  it('authorize(email ya activo) es idempotente (no crea segundo registro)', async () => {
    const first = await authorizationService.authorize('dup@example.com', 'super-1');
    const second = await authorizationService.authorize('DUP@example.com', 'super-2');

    expect(admins).toHaveLength(1);
    expect(tenants).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('active');
    expect(second.booking_code).toBe(first.booking_code);
  });

  it('authorize(email revocado) lo reactiva a active', async () => {
    const created = await authorizationService.authorize('rev@example.com');
    await authorizationService.setStatus(created.id, 'revoked');
    expect(admins[0].status).toBe('revoked');

    const reactivated = await authorizationService.authorize('rev@example.com');

    expect(reactivated.id).toBe(created.id);
    expect(reactivated.status).toBe('active');
    expect(admins).toHaveLength(1);
    // Reutiliza el mismo tenant/booking_code.
    expect(reactivated.tenant_id).toBe(created.tenant_id);
    expect(reactivated.booking_code).toBe(created.booking_code);
  });

  it("setStatus(id, 'revoked') cambia el status a revoked", async () => {
    const created = await authorizationService.authorize('foo@example.com');

    const view = await authorizationService.setStatus(created.id, 'revoked');

    expect(view.status).toBe('revoked');
    expect(admins[0].status).toBe('revoked');
    // El booking_code sigue resolviendose desde el tenant.
    expect(view.booking_code).toBe(created.booking_code);
  });

  it('setStatus con status invalido lanza HttpError 400', async () => {
    const created = await authorizationService.authorize('bar@example.com');

    await expect(
      authorizationService.setStatus(created.id, 'paused')
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('list() devuelve la vista con booking_code resuelto del tenant', async () => {
    const a = await authorizationService.authorize('a@example.com');
    const b = await authorizationService.authorize('b@example.com');

    const list = await authorizationService.list();

    expect(list).toHaveLength(2);
    const byId = new Map(list.map((v) => [v.id, v]));
    expect(byId.get(a.id)?.booking_code).toBe(a.booking_code);
    expect(byId.get(b.id)?.booking_code).toBe(b.booking_code);
  });
});
