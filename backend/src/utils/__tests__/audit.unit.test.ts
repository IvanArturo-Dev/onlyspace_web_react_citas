import { AuditAction } from '@prisma/client';

// Mock the pino logger so tests don't print noise.
jest.mock('pino', () => {
  const mockLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return jest.fn(() => mockLogger);
});

// Mock the Prisma service; create is controlled per-test.
jest.mock('../../database/prisma.service', () => ({
  prisma: {
    auditLog: {
      create: jest.fn(),
    },
  },
}));

import { prisma } from '../../database/prisma.service';
import { writeAudit, WriteAuditInput } from '../audit';

const mockedCreate = prisma.auditLog.create as jest.Mock;

describe('writeAudit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseInput: WriteAuditInput = {
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    action: AuditAction.CREATE,
    resource_type: 'appointment',
    resource_id: 'appt-1',
  };

  // Property 4: Auditoria no bloqueante
  // Validates: Requirements 5.4
  it('does not throw when the audit write fails (best-effort)', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('db down'));

    await expect(writeAudit(baseInput)).resolves.toBeUndefined();
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('writes the audit record with default result "success" when result is omitted', async () => {
    mockedCreate.mockResolvedValueOnce({ id: 'audit-1' });

    await expect(writeAudit(baseInput)).resolves.toBeUndefined();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith({
      data: {
        ...baseInput,
        result: 'success',
      },
    });
  });

  it('respects an explicit result value', async () => {
    mockedCreate.mockResolvedValueOnce({ id: 'audit-2' });

    const input: WriteAuditInput = { ...baseInput, result: 'failure' };
    await writeAudit(input);

    expect(mockedCreate).toHaveBeenCalledWith({
      data: {
        ...input,
        result: 'failure',
      },
    });
  });
});
