import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpError } from '../../utils/errors';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  authorizedAdmin: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  assistant: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Audit is best-effort; stub it so it never touches prisma.
jest.mock('../../utils/audit', () => ({
  writeAudit: jest.fn(async () => undefined),
}));

// authorizationService.authorize is invoked when promoting to ADMIN.
const mockAuthorize = jest.fn();
jest.mock('../authorization.service', () => ({
  authorizationService: {
    authorize: (email: string, superAdminId?: string) =>
      mockAuthorize(email, superAdminId),
  },
}));

const SUPERADMIN_EMAIL = 'xcode.arturo@gmail.com';

const baseUser = {
  id: 'user-1',
  name: 'Ana',
  email: 'ana@example.com',
  is_active: true,
  last_seen: null,
  tenant_id: 'tenant-a',
};

describe('userAdminService (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPERADMIN_EMAIL = SUPERADMIN_EMAIL;
    // Sensible defaults.
    mockPrisma.authorizedAdmin.findMany.mockResolvedValue([] as any);
    mockPrisma.assistant.findMany.mockResolvedValue([] as any);
    mockPrisma.authorizedAdmin.findUnique.mockResolvedValue(null as any);
    mockPrisma.assistant.findFirst.mockResolvedValue(null as any);
  });

  describe('setBlocked - Property 6: bloqueo efectivo', () => {
    it('setBlocked(id, true) actualiza is_active=false', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser as any);
      mockPrisma.user.update.mockResolvedValue({ ...baseUser, is_active: false } as any);

      const { userAdminService } = await import('../userAdmin.service');
      const view = await userAdminService.setBlocked('user-1', true);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { is_active: false },
        })
      );
      expect(view.is_active).toBe(false);
    });

    it('setBlocked(id, false) actualiza is_active=true', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, is_active: false } as any);
      mockPrisma.user.update.mockResolvedValue({ ...baseUser, is_active: true } as any);

      const { userAdminService } = await import('../userAdmin.service');
      const view = await userAdminService.setBlocked('user-1', false);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { is_active: true } })
      );
      expect(view.is_active).toBe(true);
    });

    it('lanza 404 USER_NOT_FOUND cuando el usuario no existe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null as any);

      const { userAdminService } = await import('../userAdmin.service');
      await expect(userAdminService.setBlocked('missing', true)).rejects.toMatchObject({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('changeRole - solo 3 roles; efectivo via whitelist', () => {
    it.each(['SUPERADMIN', 'superadmin', ' SuperAdmin '])(
      'Property 7: rechaza %p con 403 FORBIDDEN_ROLE sin tocar la whitelist',
      async (roleName) => {
        const { userAdminService } = await import('../userAdmin.service');

        await expect(userAdminService.changeRole('user-1', roleName)).rejects.toMatchObject({
          statusCode: 403,
          code: 'FORBIDDEN_ROLE',
        });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockAuthorize).not.toHaveBeenCalled();
      }
    );

    it('promocion a ADMIN: autoriza el email y reconcilia tenant al del emprendedor', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser as any);
      mockAuthorize.mockResolvedValue({
        id: 'aa-1',
        email: 'ana@example.com',
        status: 'active',
        tenant_id: 'tenant-owner',
        booking_code: 'ABC123',
        created_at: new Date().toISOString(),
      } as any);
      mockPrisma.user.update.mockResolvedValue({
        ...baseUser,
        tenant_id: 'tenant-owner',
      } as any);

      const { userAdminService } = await import('../userAdmin.service');
      const view = await userAdminService.changeRole('user-1', 'admin', 'super-1');

      expect(mockAuthorize).toHaveBeenCalledWith('ana@example.com', 'super-1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { tenant_id: 'tenant-owner' },
        })
      );
      expect(view.role).toBe('ADMIN');
      expect(view.tenant_id).toBe('tenant-owner');
    });

    it('degradacion a CLIENT: revoca el AuthorizedAdmin activo y vuelve a tenant default', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        tenant_id: 'tenant-owner',
      } as any);
      mockPrisma.authorizedAdmin.findUnique.mockResolvedValue({
        id: 'aa-1',
        email: 'ana@example.com',
        status: 'active',
        tenant_id: 'tenant-owner',
      } as any);
      mockPrisma.authorizedAdmin.update.mockResolvedValue({} as any);
      mockPrisma.user.update.mockResolvedValue({
        ...baseUser,
        tenant_id: 'default',
      } as any);

      const { userAdminService } = await import('../userAdmin.service');
      const view = await userAdminService.changeRole('user-1', 'CLIENT');

      expect(mockPrisma.authorizedAdmin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'aa-1' },
          data: { status: 'revoked' },
        })
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tenant_id: 'default' } })
      );
      expect(view.role).toBe('CLIENT');
      expect(view.tenant_id).toBe('default');
      expect(mockAuthorize).not.toHaveBeenCalled();
    });

    it('degradacion a CLIENT sin AuthorizedAdmin: no falla y no revoca nada', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser as any);
      mockPrisma.authorizedAdmin.findUnique.mockResolvedValue(null as any);
      mockPrisma.user.update.mockResolvedValue({ ...baseUser, tenant_id: 'default' } as any);

      const { userAdminService } = await import('../userAdmin.service');
      const view = await userAdminService.changeRole('user-1', 'CLIENT');

      expect(mockPrisma.authorizedAdmin.update).not.toHaveBeenCalled();
      expect(view.role).toBe('CLIENT');
    });

    it('rechaza cambiar el rol del super admin configurado con 403 FORBIDDEN_ROLE', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        email: SUPERADMIN_EMAIL,
      } as any);

      const { userAdminService } = await import('../userAdmin.service');
      await expect(userAdminService.changeRole('user-1', 'CLIENT')).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN_ROLE',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rechaza roles no soportados (PROFESSIONAL/RECEPTION/otros) con 400 INVALID_ROLE', async () => {
      const { userAdminService } = await import('../userAdmin.service');

      for (const role of ['PROFESSIONAL', 'RECEPTION', 'WIZARD']) {
        await expect(userAdminService.changeRole('user-1', role)).rejects.toMatchObject({
          statusCode: 400,
          code: 'INVALID_ROLE',
        });
      }
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('list - rol efectivo derivado de email + whitelist', () => {
    it('mapea usuarios a su rol efectivo (SUPERADMIN/ADMIN/ASSISTANT/CLIENT)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { ...baseUser, id: 'u-super', email: SUPERADMIN_EMAIL },
        { ...baseUser, id: 'u-admin', email: 'owner@example.com' },
        { ...baseUser, id: 'u-assist', email: 'assist@example.com' },
        { ...baseUser, id: 'u-client', email: 'nobody@example.com' },
      ] as any);
      mockPrisma.authorizedAdmin.findMany.mockResolvedValue([
        { email: 'owner@example.com' },
      ] as any);
      mockPrisma.assistant.findMany.mockResolvedValue([
        { email: 'assist@example.com' },
      ] as any);

      const { userAdminService } = await import('../userAdmin.service');
      const views = await userAdminService.list();

      const byId = new Map(views.map((v) => [v.id, v]));
      expect(byId.get('u-super')?.role).toBe('SUPERADMIN');
      expect(byId.get('u-admin')?.role).toBe('ADMIN');
      expect(byId.get('u-assist')?.role).toBe('ASSISTANT');
      expect(byId.get('u-client')?.role).toBe('CLIENT');
      // La vista incluye tenant_id y last_seen.
      expect(byId.get('u-client')).toHaveProperty('tenant_id');
      expect(byId.get('u-client')).toHaveProperty('last_seen');
    });

    it('un usuario sin whitelist es CLIENT', async () => {
      mockPrisma.user.findMany.mockResolvedValue([baseUser] as any);

      const { userAdminService } = await import('../userAdmin.service');
      const views = await userAdminService.list();

      expect(views).toHaveLength(1);
      expect(views[0].role).toBe('CLIENT');
    });
  });
});

// Ensure HttpError is used (import guard for type errors).
void HttpError;
