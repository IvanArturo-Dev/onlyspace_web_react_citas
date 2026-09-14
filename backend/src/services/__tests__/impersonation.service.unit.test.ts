import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuditAction } from '@prisma/client';

/**
 * Pruebas unitarias del servicio de impersonacion (modo soporte del super admin).
 *
 * - Property 1 / 6 (token correcto): `start` sobre un tenant existente emite un
 *   token cuyo payload lleva role 'ADMIN', tenant_id = objetivo, permissions
 *   vacio, user_id = super admin e impersonated_by = super admin; y devuelve el
 *   tenant { id, name }.
 * - Property 3 / 4 (validacion + auditoria): tenant inexistente -> 404
 *   TENANT_NOT_FOUND sin emitir token; y tanto `start` como `stop` registran
 *   auditoria (start / stop).
 *
 * Se mockea prisma, writeAudit y `generateAccessToken` (para capturar el payload
 * y las opciones sin depender de la firma real de JWT).
 *
 * **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 6.1**
 * **Properties: Property 1, Property 3, Property 4, Property 6**
 */

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
  },
};

const mockWriteAudit = jest.fn(async () => undefined);
const mockGenerateAccessToken = jest.fn(() => 'tok-impersonation');

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

jest.mock('../../config/jwt', () => ({
  generateAccessToken: (...args: unknown[]) => mockGenerateAccessToken(...args),
}));

// Import despues de registrar los mocks.
import { impersonationService } from '../impersonation.service';
import { HttpError } from '../../utils/errors';

const SUPER_ADMIN_ID = 'super-admin-1';
const TENANT_ID = 'tenant-42';

beforeEach(() => {
  jest.clearAllMocks();
  (mockPrisma.tenant.findUnique as jest.Mock).mockReset();
  mockGenerateAccessToken.mockReset();
  mockGenerateAccessToken.mockReturnValue('tok-impersonation');
});

describe('impersonationService.start', () => {
  it('tenant existente -> emite token con payload correcto y devuelve tenant (Property 1, 6)', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Negocio Objetivo',
    });

    const result = await impersonationService.start(SUPER_ADMIN_ID, TENANT_ID);

    // Devuelve el token emitido y el tenant { id, name }.
    expect(result.token).toBe('tok-impersonation');
    expect(result.tenant).toEqual({ id: TENANT_ID, name: 'Negocio Objetivo' });

    // El payload del token es el esperado y con expiracion corta.
    expect(mockGenerateAccessToken).toHaveBeenCalledTimes(1);
    const [payload, options] = mockGenerateAccessToken.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(payload).toEqual({
      user_id: SUPER_ADMIN_ID,
      tenant_id: TENANT_ID,
      role: 'ADMIN',
      permissions: [],
      impersonated_by: SUPER_ADMIN_ID,
    });
    expect(options).toEqual({ expiresIn: '2h' });
  });

  it('tenant existente -> registra auditoria START (Property 4)', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Negocio Objetivo',
    });

    await impersonationService.start(SUPER_ADMIN_ID, TENANT_ID);

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(auditArg).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: SUPER_ADMIN_ID,
      action: AuditAction.UPDATE,
      resource_type: 'impersonation',
      resource_id: TENANT_ID,
    });
    expect(JSON.parse(auditArg.details as string)).toEqual({
      action: 'start',
      by: SUPER_ADMIN_ID,
    });
  });

  it('tenant inexistente -> 404 TENANT_NOT_FOUND sin emitir token (Property 3)', async () => {
    (mockPrisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      impersonationService.start(SUPER_ADMIN_ID, 'no-existe')
    ).rejects.toMatchObject({ statusCode: 404, code: 'TENANT_NOT_FOUND' });

    await expect(
      impersonationService.start(SUPER_ADMIN_ID, 'no-existe')
    ).rejects.toBeInstanceOf(HttpError);

    // No se emite token ni se audita cuando el tenant no existe.
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

describe('impersonationService.stop', () => {
  it('registra auditoria STOP y devuelve { ok: true }', async () => {
    const result = await impersonationService.stop(SUPER_ADMIN_ID, TENANT_ID);

    expect(result).toEqual({ ok: true });

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const auditArg = mockWriteAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(auditArg).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: SUPER_ADMIN_ID,
      action: AuditAction.UPDATE,
      resource_type: 'impersonation',
      resource_id: TENANT_ID,
    });
    expect(JSON.parse(auditArg.details as string)).toEqual({
      action: 'stop',
      by: SUPER_ADMIN_ID,
    });

    // stop no emite ningun token.
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });
});
