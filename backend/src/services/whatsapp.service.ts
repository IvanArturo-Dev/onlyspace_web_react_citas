import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

/**
 * WhatsApp reminder service (Requirement 2.3-2.8, Property 3 & 4).
 *
 * IMPORTANT: this service is 100% MANUAL. It NEVER sends a message and calls
 * NO messaging API (no fetch, no WhatsApp Business API). It only BUILDS a
 * `wa.me` link plus the prefilled text; the entrepreneur presses send in their
 * own WhatsApp (Requirement 2.6 / Property 4). `buildReminderLink` is pure with
 * respect to the network: it reads from the DB and returns a string synchronously.
 */

const DEFAULT_TEMPLATE =
  'Estimado/a {cliente}, le recordamos que tiene una cita programada para el dia {fecha} a las {hora} en {negocio}. Agradecemos llegar unos minutos antes. Quedamos a su disposicion si requiere algun cambio en su reserva.';

/**
 * Plantilla por defecto para el aviso de "espacio abierto" a un cliente que
 * estaba en lista de espera (Tarea 4). Usa los MISMOS placeholders que la
 * plantilla de recordatorio: {cliente},{negocio},{sucursal},{fecha},{hora},
 * {contacto}. La plantilla por defecto muestra en {negocio} la ubicacion
 * (sucursal cuando existe, o el nombre del negocio como respaldo), igual que
 * DEFAULT_TEMPLATE.
 */
const DEFAULT_SPOT_OPENED_TEMPLATE =
  'Hola {cliente}, se abrio un espacio en {negocio} para el {fecha} a las {hora}. Como estabas en lista de espera, confirma tu cita respondiendo este mensaje. Contacto: {contacto}';

const DEFAULT_TIMEZONE = 'America/Mexico_City';

/**
 * Normalizes a phone to DIGITS ONLY for the wa.me link (Requirement 2.8):
 * strips every non-digit character (spaces, dashes, parentheses and a leading
 * `+`), keeping the country-code digits. e.g. "+52 55 1234 5678" -> "525512345678".
 * The `+` is simply dropped because it is not a digit.
 */
export function normalizePhoneDigits(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return '';
  }
  return String(raw).replace(/\D/g, '');
}

interface ReminderLink {
  url: string;
  message: string;
  phone: string;
}

/**
 * Logica compartida entre buildReminderLink y buildSpotOpenedLink: carga la
 * cita scoped por tenant (Property 6 -> 404 si es ajena), valida y normaliza el
 * telefono del cliente (Requirement 2.5 -> 400 PHONE_REQUIRED), resuelve la zona
 * horaria y la sucursal, formatea fecha/hora con Intl y reemplaza los
 * placeholders. Recibe la plantilla por defecto a usar cuando el tenant no tiene
 * una plantilla custom; asi ambos metodos reutilizan exactamente la misma
 * mecanica cambiando solo el texto por defecto.
 */
async function buildWhatsappLink(
  tenantId: string,
  appointmentId: string,
  defaultTemplate: string
): Promise<ReminderLink> {
  // Load scoped by tenant; a foreign appointment throws 404 (Property 6).
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenant_id: tenantId },
    include: { customer: true, service: true },
  });

  if (!appointment) {
    throw new HttpError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND');
  }

  // Resolve and normalize the client's phone (Requirement 2.8).
  const rawPhone = appointment.customer?.phone ?? null;
  const phoneDigits = normalizePhoneDigits(rawPhone);

  // Reject missing/invalid/placeholder phones (Requirement 2.5 / PHONE_REQUIRED).
  // 'sin-telefono' has no digits so it normalizes to '' and is rejected by the
  // length check below; the explicit check keeps intent clear.
  if (!rawPhone || rawPhone === 'sin-telefono' || phoneDigits.length < 8) {
    throw new HttpError(
      'The customer has no valid phone number for WhatsApp',
      400,
      'PHONE_REQUIRED'
    );
  }

  // Load the tenant for the business name, WhatsApp contact and template.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, whatsapp_number: true, whatsapp_template: true },
  });

  // Resolve la zona horaria y el nombre de la sucursal (si existe), de lo
  // contrario se usa la zona horaria por defecto y una sucursal vacia.
  let timezone = DEFAULT_TIMEZONE;
  let sucursal = '';
  if (appointment.branch_id) {
    const branch = await prisma.branch.findFirst({
      where: { id: appointment.branch_id, tenant_id: tenantId },
      select: { timezone: true, name: true },
    });
    if (branch?.timezone) {
      timezone = branch.timezone;
    }
    // Reutiliza el mismo objeto branch ya consultado (sin segunda query).
    sucursal = branch?.name ?? '';
  }

  const start = new Date(appointment.start_time);
  const fecha = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(start);
  const hora = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);

  const usingDefault = !(
    tenant?.whatsapp_template && tenant.whatsapp_template.trim().length > 0
  );
  const template = usingDefault ? defaultTemplate : tenant!.whatsapp_template!;

  // La ubicacion que se muestra en la plantilla por defecto es el nombre de la
  // sucursal cuando existe y, como respaldo, el nombre del negocio cuando la
  // cita no tiene sucursal (branch_id null).
  const negocioNombre = tenant?.name ?? '';
  const ubicacion = sucursal || negocioNombre;

  // Plantilla por defecto: {negocio} se reemplaza por la ubicacion (la
  // sucursal, o el negocio si no hay sucursal), de modo que el mensaje muestra
  // SOLO la sucursal cuando existe.
  // Plantilla custom del tenant: {negocio} conserva su significado (nombre del
  // negocio) y {sucursal} es el nombre puro de la sucursal, porque el usuario
  // controla el formato del mensaje.
  const message = template
    .replace(/\{cliente\}/g, appointment.customer?.name ?? '')
    .replace(/\{negocio\}/g, usingDefault ? ubicacion : negocioNombre)
    .replace(/\{sucursal\}/g, sucursal)
    .replace(/\{fecha\}/g, fecha)
    .replace(/\{hora\}/g, hora)
    .replace(/\{contacto\}/g, tenant?.whatsapp_number ?? '');

  const url =
    'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent(message);

  return { url, message, phone: phoneDigits };
}

export const whatsappService = {
  /**
   * Builds the manual WhatsApp reminder link for an appointment.
   *
   * Tenant isolation (Property 6): the appointment is loaded scoped by
   * tenant_id; a foreign appointment resolves to null and yields 404
   * APPOINTMENT_NOT_FOUND, so a caller can never build a link for another
   * tenant's appointment.
   *
   * Phone handling (Requirement 2.5 / Property 3): the client's phone is read
   * from the appointment's customer and normalized to digits only. If it is
   * missing, invalid, the public-booking placeholder 'sin-telefono', or fewer
   * than 8 digits, it throws 400 PHONE_REQUIRED and NO link is produced so the
   * business can capture/edit the phone first.
   *
   * The message is built from the tenant's custom template or the default
   * Spanish template, formatting the date/time in the branch timezone (or the
   * default) via Intl.DateTimeFormat.
   */
  async buildReminderLink(
    tenantId: string,
    appointmentId: string
  ): Promise<ReminderLink> {
    return buildWhatsappLink(tenantId, appointmentId, DEFAULT_TEMPLATE);
  },

  /**
   * Builds the manual WhatsApp "spot opened" link for a waitlisted client
   * (Tarea 4). Replica EXACTAMENTE la mecanica de buildReminderLink (misma
   * resolucion de telefono/zona/sucursal/fecha/hora, mismo 404
   * APPOINTMENT_NOT_FOUND, mismo 400 PHONE_REQUIRED y misma construccion de la
   * url wa.me) pero usa DEFAULT_SPOT_OPENED_TEMPLATE cuando el tenant no tiene
   * una plantilla custom. Devuelve { url, message, phone } y NO envia nada.
   */
  async buildSpotOpenedLink(
    tenantId: string,
    appointmentId: string
  ): Promise<ReminderLink> {
    return buildWhatsappLink(
      tenantId,
      appointmentId,
      DEFAULT_SPOT_OPENED_TEMPLATE
    );
  },
};
