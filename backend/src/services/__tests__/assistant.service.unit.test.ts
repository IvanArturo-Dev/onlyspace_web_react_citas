import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// In-memory store backing the Prisma mock
// ---------------------------------------------------------------------------
interface FakeAssistant {
  id: string;
  tenant_id: string;
  email: string;
  status: string;
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface FakeAuthorizedAdmin {
  id: string;
  email: string;
  status: string;
  tenant_id: string | null;
}

let assistants: FakeAssistant[] = [];
let admins: FakeAuthorizedAdmin[] = [];
let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const mockPrisma = {
  assistant: {
    findMany: jest.fn(async ({ where }: any) => {
      return assistants
        .filter((a) => (where?.tenant_id ? a.tenant_id === where.tenant_id : true))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.tenant_id_email) {
        const { tenant_id, email } = where.tenant_id_email;
        return (
          assistants.find((a) => a.tenant_id === tenant_id && a.email === email) ?? null
        );
      }
      return assistants.find((a) => a.id === where.id) ?? null;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        assistants.find(
          (a) =>
            (where.id ? a.id === where.id : true) &&
            (where.tenant_id ? a.tenant_id === where.tenant_id : true) &&
            (where.status ? a.status === where.status : true) &&
            (where.email ? a.email === where.email : true)
        ) ?? null
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      const now = new Date();
      const record: FakeAssistant = {
        id: nextId('assistant'),
        tenant_id: data.tenant_id,
        email: data.email,
        status: data.status ?? 'active',
        invited_by: data.invited_by ?? null,
        created_at: now,
        updated_at: now,
      };
      assistants.push(record);
      return record;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const record = assistants.find((a) => a.id === where.id);
      if (!record) throw new Error('Assistant to update not found');
      Object.assign(record, data, { updated_at: new Date() });
      return record;
    }),
  },
  authorizedAdmin: {
    findUnique: jest.fn(async ({ where }: any) => {
      return admins.find((a) => a.email === where.email) ?? null;
    }),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

import { assistantService } from '../assistant.service';

describe('assistantService (unit)', () => {
  beforeEach(() => {
    assistants = [];
    admins = [];
    idCounter = 0;
    jest.clearAllMocks();
    process.env.SUPERADMIN_EMAIL = 'xcode.arturo@gmail.com';
  });

  it('invite crea un asistente activo scoping-eado al tenant y normaliza el email', async () => {
    const view = await assistantService.invite('tenant-a', 'Helper@Example.com', 'admin-1');

    expect(view.tenant_id).toBe('tenant-a');
    expect(view.email).toBe('helper@example.com');
    expect(view.status).toBe('active');
    expect(view.invited_by).toBe('admin-1');
    expect(assistants).toHaveLength(1);
  });

  it('invite es idempotente sobre (tenant, email)', async () => {
    const first = await assistantService.invite('tenant-a', 'dup@example.com');
    const second = await assistantService.invite('tenant-a', 'DUP@example.com');

    expect(second.id).toBe(first.id);
    expect(assistants).toHaveLength(1);
  });

  it('invite reactiva un asistente revocado', async () => {
    const created = await assistantService.invite('tenant-a', 'rev@example.com');
    await assistantService.setStatus('tenant-a', created.id, 'revoked');
    expect(assistants[0].status).toBe('revoked');

    const reactivated = await assistantService.invite('tenant-a', 'rev@example.com');
    expect(reactivated.id).toBe(created.id);
    expect(reactivated.status).toBe('active');
    expect(assistants).toHaveLength(1);
  });

  it('invite rechaza el super admin con 400 CANNOT_INVITE_SUPERADMIN', async () => {
    await expect(
      assistantService.invite('tenant-a', 'xcode.arturo@gmail.com')
    ).rejects.toMatchObject({ statusCode: 400, code: 'CANNOT_INVITE_SUPERADMIN' });
    expect(assistants).toHaveLength(0);
  });

  it('invite rechaza un ADMIN activo de otro tenant con 400 EMAIL_IS_ADMIN', async () => {
    admins.push({
      id: 'aa-1',
      email: 'owner@example.com',
      status: 'active',
      tenant_id: 'tenant-b',
    });

    await expect(
      assistantService.invite('tenant-a', 'owner@example.com')
    ).rejects.toMatchObject({ statusCode: 400, code: 'EMAIL_IS_ADMIN' });
    expect(assistants).toHaveLength(0);
  });

  it('invite permite a un ADMIN del MISMO tenant (no lo bloquea)', async () => {
    admins.push({
      id: 'aa-2',
      email: 'self@example.com',
      status: 'active',
      tenant_id: 'tenant-a',
    });

    const view = await assistantService.invite('tenant-a', 'self@example.com');
    expect(view.status).toBe('active');
  });

  it('setStatus revoca un asistente propio', async () => {
    const created = await assistantService.invite('tenant-a', 'x@example.com');
    const view = await assistantService.setStatus('tenant-a', created.id, 'revoked');
    expect(view.status).toBe('revoked');
  });

  it('setStatus con status invalido lanza 400 VALIDATION_ERROR', async () => {
    const created = await assistantService.invite('tenant-a', 'y@example.com');
    await expect(
      assistantService.setStatus('tenant-a', created.id, 'paused')
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  describe('aislamiento entre tenants', () => {
    it('list solo devuelve asistentes del tenant del emprendedor', async () => {
      await assistantService.invite('tenant-a', 'a1@example.com');
      await assistantService.invite('tenant-b', 'b1@example.com');

      const listA = await assistantService.list('tenant-a');
      expect(listA).toHaveLength(1);
      expect(listA[0].email).toBe('a1@example.com');
    });

    it('setStatus no puede modificar un asistente de otro tenant -> 404', async () => {
      const other = await assistantService.invite('tenant-b', 'foreign@example.com');

      await expect(
        assistantService.setStatus('tenant-a', other.id, 'revoked')
      ).rejects.toMatchObject({ statusCode: 404, code: 'ASSISTANT_NOT_FOUND' });
      // El asistente del otro tenant sigue activo.
      expect(assistants.find((a) => a.id === other.id)?.status).toBe('active');
    });
  });
});
