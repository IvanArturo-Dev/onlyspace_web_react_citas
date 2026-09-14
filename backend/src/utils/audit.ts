import { AuditAction } from '@prisma/client';
import pino from 'pino';
import { prisma } from '../database/prisma.service';

const logger = pino();

export interface WriteAuditInput {
  tenant_id: string;
  user_id?: string;
  action: AuditAction;
  resource_type: string;
  resource_id: string;
  result?: 'success' | 'failure';
  ip_address?: string;
  user_agent?: string;
  details?: string;
}

/**
 * Centralized, best-effort audit log writer.
 *
 * The write is wrapped in a try/catch so that a failure to persist an audit
 * record NEVER blocks the main business operation. On failure the error is
 * logged with pino and the promise resolves normally (Requirement 5.4).
 */
export async function writeAudit(input: WriteAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        ...input,
        result: input.result ?? 'success',
      },
    });
  } catch (error) {
    logger.error({ err: error, audit: input }, 'Failed to write audit log');
  }
}
