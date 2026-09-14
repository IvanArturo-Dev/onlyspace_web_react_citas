import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * In-app notification service for the entrepreneur (Requirements 6.1–6.5).
 *
 * In-app notifications are Notification rows distinguished by a non-null
 * `event_type` (e.g. "appointment_created", "appointment_waitlisted",
 * "appointment_cancelled"). Everything here is scoped by `tenant_id`
 * (Property 1: aislamiento por tenant).
 *
 * The write path (`notify`) is BEST-EFFORT (Property 8): a failure while
 * persisting a notification must never revert nor block the main operation
 * (create/cancel/waitlist). Any failure is logged and swallowed.
 *
 * The real delivery channel does not matter for in-app notifications; we store
 * them with channel PUSH / status PENDING and surface them by `event_type`.
 */

export interface NotifyInput {
  event_type: string;
  title: string;
  body: string;
  appointment_id?: string | null;
  customer_id?: string | null;
}

export interface ListForTenantOptions {
  unreadOnly?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export const notificationService = {
  /**
   * Best-effort creation of an in-app notification. Never throws: on failure it
   * logs and returns null so the caller's main operation is unaffected.
   */
  async notify(tenantId: string, input: NotifyInput) {
    try {
      return await prisma.notification.create({
        data: {
          tenant_id: tenantId,
          event_type: input.event_type,
          title: input.title,
          body: input.body,
          appointment_id: input.appointment_id ?? null,
          customer_id: input.customer_id ?? null,
          channel: 'PUSH',
          status: 'PENDING',
        },
      });
    } catch (err) {
      // Best-effort: log and swallow — must not break the main operation.
      console.error('[notificationService.notify] failed (best-effort):', err);
      return null;
    }
  },

  /**
   * Lists the tenant's in-app notifications (event_type != null), newest first.
   * When `unreadOnly` is set, only unread (read_at = null) ones are returned.
   */
  async listForTenant(tenantId: string, options: ListForTenantOptions = {}) {
    const limit = options.limit ?? DEFAULT_LIMIT;
    return prisma.notification.findMany({
      where: {
        tenant_id: tenantId,
        event_type: { not: null },
        ...(options.unreadOnly ? { read_at: null } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  },

  /**
   * Counts the tenant's unread in-app notifications (event_type != null,
   * read_at = null).
   */
  async unreadCount(tenantId: string) {
    return prisma.notification.count({
      where: {
        tenant_id: tenantId,
        event_type: { not: null },
        read_at: null,
      },
    });
  },

  /**
   * Marks a notification as read — only if it belongs to the tenant. A missing
   * or foreign notification yields 404 NOTIFICATION_NOT_FOUND.
   */
  async markRead(tenantId: string, id: string) {
    const existing = await prisma.notification.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new HttpError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
    }
    return prisma.notification.update({
      where: { id },
      data: { read_at: new Date() },
    });
  },

  /**
   * Marks all of the tenant's unread notifications as read. Returns the number
   * of rows updated.
   */
  async markAllRead(tenantId: string) {
    const result = await prisma.notification.updateMany({
      where: { tenant_id: tenantId, read_at: null },
      data: { read_at: new Date() },
    });
    return { updated: result.count };
  },
};
