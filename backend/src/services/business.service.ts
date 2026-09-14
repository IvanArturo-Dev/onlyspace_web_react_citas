import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * Business profile service (Requirement 2.1, 2.2, 2.7).
 *
 * Holds the tenant-level WhatsApp settings used to build the MANUAL reminder
 * link: the business WhatsApp number (used as contact/signature inside the
 * message) and an optional custom message template. Everything here is scoped
 * to a single tenant_id — a caller can only read/update their own tenant's
 * profile (Property 6: aislamiento por tenant).
 *
 * NOTE: nothing in this module sends any message or contacts a messaging API.
 * The WhatsApp reminder is 100% manual (Requirement 2.6).
 */

/**
 * Validates a business WhatsApp number. Returns the cleaned value that should
 * be persisted:
 *  - `null` when the caller wants to clear the number (empty string / null /
 *    undefined all clear it).
 *  - otherwise the sanitized number (spaces, dashes and parentheses stripped)
 *    which must match an optional leading `+` followed by 8–15 digits.
 *
 * An invalid non-empty number throws 400 VALIDATION_ERROR (Requirement 2.2).
 */
export function validateBusinessWhatsappNumber(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const trimmed = String(raw).trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Strip common separators (spaces, dashes, parentheses) before validating.
  const cleaned = trimmed.replace(/[\s\-().]/g, '');

  // Optional leading +, then 8–15 digits.
  if (!/^\+?\d{8,15}$/.test(cleaned)) {
    throw new HttpError(
      'whatsapp_number must be a valid phone number (optional +, 8-15 digits)',
      400,
      'VALIDATION_ERROR'
    );
  }

  return cleaned;
}

export const businessService = {
  /**
   * Returns the WhatsApp profile fields for the given tenant. Scoped strictly
   * to the tenant carried by the caller's JWT (Property 6).
   */
  async getBusinessProfile(
    tenantId: string
  ): Promise<{ whatsapp_number: string | null; whatsapp_template: string | null }> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsapp_number: true, whatsapp_template: true },
    });

    if (!tenant) {
      throw new HttpError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    return {
      whatsapp_number: tenant.whatsapp_number ?? null,
      whatsapp_template: tenant.whatsapp_template ?? null,
    };
  },

  /**
   * Updates the WhatsApp profile fields for the given tenant. Only the provided
   * fields are touched. The number is validated/sanitized (Requirement 2.2);
   * passing an empty/null number clears it. The template is stored as-is (an
   * empty string clears it back to null). Tenant-scoped (Property 6).
   */
  async updateBusinessProfile(
    tenantId: string,
    data: { whatsapp_number?: string | null; whatsapp_template?: string | null }
  ): Promise<{ whatsapp_number: string | null; whatsapp_template: string | null }> {
    // Ensure the tenant exists (and belongs to the caller via the JWT-scoped id).
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new HttpError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    const updateData: {
      whatsapp_number?: string | null;
      whatsapp_template?: string | null;
    } = {};

    if (data.whatsapp_number !== undefined) {
      updateData.whatsapp_number = validateBusinessWhatsappNumber(data.whatsapp_number);
    }

    if (data.whatsapp_template !== undefined) {
      const template =
        data.whatsapp_template === null ? null : String(data.whatsapp_template);
      updateData.whatsapp_template =
        template && template.trim().length > 0 ? template : null;
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
      select: { whatsapp_number: true, whatsapp_template: true },
    });

    return {
      whatsapp_number: updated.whatsapp_number ?? null,
      whatsapp_template: updated.whatsapp_template ?? null,
    };
  },
};
