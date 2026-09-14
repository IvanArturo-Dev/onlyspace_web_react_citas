import axios from 'axios';
import { randomUUID } from 'crypto';
import { googleAccountService } from './google-account.service';

/**
 * googleIntegrationService
 * ------------------------
 * Llama a las APIs REST de Google (Calendar + People) usando el access token
 * del tenant obtenido de `googleAccountService.ensureAccessToken`.
 *
 * Se usan los endpoints REST directamente con `axios` (mismo estilo que
 * `google-oauth.service.ts`) en lugar de un SDK pesado: es mas ligero y mucho
 * mas facil de mockear en pruebas unitarias (sin red real).
 *
 * Contrato de errores:
 * - Si `ensureAccessToken` devuelve null (tenant NO conectado / revoked) los
 *   metodos hacen NO-OP y devuelven null (o void). Esto NO es un error.
 * - Cualquier error de red/HTTP se PROPAGA al caller (el hook best-effort de la
 *   tarea 7 es quien lo captura y lo trata como best-effort). Aqui NO se tragan
 *   los errores silenciosamente, con la unica excepcion de 404/410 en delete
 *   (el evento ya no existe -> nada que borrar).
 *
 * Nota Google Meet: Meet no tiene API propia. El enlace se genera como
 * `conferenceData` de un evento de Calendar (`conferenceDataVersion=1`,
 * `requestId` unico) y se extrae del response del evento.
 */

/** Zona horaria por defecto si la cita no trae una explicita. */
const DEFAULT_TIME_ZONE = 'America/Mexico_City';

const CALENDAR_EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const PEOPLE_CREATE_CONTACT_URL =
  'https://people.googleapis.com/v1/people:createContact';

/**
 * Datos de la cita necesarios para construir el evento de Calendar. El hook de
 * la tarea 7 arma este objeto a partir del Appointment persistido (+ relaciones
 * cargadas). Todos los campos salvo start/end son opcionales/best-effort.
 */
export interface AppointmentEventInput {
  /** id del evento de Calendar ya creado (para PATCH). Ausente => crear (POST). */
  google_event_id?: string | null;
  /** Nombre del servicio (para el titulo del evento). */
  service_name?: string | null;
  /** Nombre del cliente (para el titulo del evento). */
  customer_name?: string | null;
  /** Notas de la cita (para la descripcion del evento). */
  notes?: string | null;
  /** Inicio de la cita (Date o ISO string). */
  start_time: Date | string;
  /** Fin de la cita (Date o ISO string). */
  end_time: Date | string;
  /** Zona horaria IANA. Por defecto `America/Mexico_City`. */
  time_zone?: string | null;
  /** Ubicacion presencial (direccion / sucursal). */
  location?: string | null;
  /** Modalidad: 'online' => cita en linea (genera Meet). */
  modality?: string | null;
}

/** Datos del cliente para crear/actualizar el contacto en People API. */
export interface ContactInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Resultado de sincronizar un evento de Calendar. */
export interface SyncEventResult {
  event_id: string;
  meet_url: string | null;
}

/** Resultado de crear/actualizar un contacto. */
export interface UpsertContactResult {
  resource_name: string;
}

/** Normaliza un Date | string a ISO string (dateTime de Calendar). */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Determina si la cita es EN LINEA. Considera tanto el campo `modality`
 * ('online') como la convencion de `location` = "En linea" descrita en el
 * diseno.
 */
function isOnline(appointment: AppointmentEventInput): boolean {
  if (appointment.modality && appointment.modality.toLowerCase() === 'online') {
    return true;
  }
  const location = (appointment.location ?? '').trim().toLowerCase();
  return location === 'en linea' || location === 'en línea';
}

/**
 * Extrae el enlace de Google Meet del response de un evento de Calendar.
 *
 * Preferimos el `entryPoint` de tipo 'video' dentro de `conferenceData`; si no
 * existe, caemos al `hangoutLink` (campo legacy que Calendar suele poblar). Si
 * ninguno esta presente devolvemos null.
 */
function extractMeetUrl(eventData: any): string | null {
  const entryPoints = eventData?.conferenceData?.entryPoints;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find(
      (ep: any) => ep?.entryPointType === 'video' && ep?.uri
    );
    if (video?.uri) {
      return video.uri as string;
    }
  }
  if (typeof eventData?.hangoutLink === 'string' && eventData.hangoutLink) {
    return eventData.hangoutLink;
  }
  return null;
}

/** Construye el cuerpo del evento de Calendar a partir de la cita. */
function buildEventBody(appointment: AppointmentEventInput): Record<string, any> {
  const timeZone = appointment.time_zone || DEFAULT_TIME_ZONE;
  const service = appointment.service_name?.trim() || 'Cita';
  const customer = appointment.customer_name?.trim();
  const summary = customer ? `${service} - ${customer}` : service;

  const body: Record<string, any> = {
    summary,
    start: { dateTime: toIso(appointment.start_time), timeZone },
    end: { dateTime: toIso(appointment.end_time), timeZone },
  };

  if (appointment.notes) {
    body.description = appointment.notes;
  }

  const online = isOnline(appointment);

  // La ubicacion solo aplica a citas presenciales.
  if (!online && appointment.location) {
    body.location = appointment.location;
  }

  // Cita en linea: solicitar la creacion de un Google Meet via conferenceData.
  if (online) {
    body.conferenceData = {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  return body;
}

export const googleIntegrationService = {
  /**
   * Crea o actualiza el evento de Calendar de una cita.
   *
   * - Si `ensureAccessToken` devuelve null (no conectado) -> NO-OP, retorna null.
   * - Si `appointment.google_event_id` existe -> PATCH del evento existente.
   * - Si no existe -> POST (crea evento nuevo).
   * - Si la cita es en linea agrega `conferenceData` + `conferenceDataVersion=1`.
   *
   * Devuelve `{ event_id, meet_url }`. `meet_url` es el enlace de Meet (solo en
   * citas en linea) o null.
   */
  async syncAppointmentEvent(
    tenantId: string,
    appointment: AppointmentEventInput
  ): Promise<SyncEventResult | null> {
    const accessToken = await googleAccountService.ensureAccessToken(tenantId);
    if (!accessToken) {
      // Tenant no conectado (o revocado): no-op limpio, no es error.
      return null;
    }

    const body = buildEventBody(appointment);
    const online = isOnline(appointment);

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    // conferenceDataVersion=1 es obligatorio para que Calendar procese la
    // solicitud de creacion del Meet.
    const params = online ? { conferenceDataVersion: 1 } : undefined;

    let response;
    if (appointment.google_event_id) {
      response = await axios.patch(
        `${CALENDAR_EVENTS_URL}/${appointment.google_event_id}`,
        body,
        { headers, params }
      );
    } else {
      response = await axios.post(CALENDAR_EVENTS_URL, body, { headers, params });
    }

    const data = response.data ?? {};
    return {
      event_id: data.id,
      meet_url: online ? extractMeetUrl(data) : null,
    };
  },

  /**
   * Elimina el evento de Calendar asociado a una cita.
   *
   * - No-op si el tenant no esta conectado o si la cita no tiene
   *   `google_event_id`.
   * - Ignora 404/410 (el evento ya fue borrado): idempotente.
   * - Cualquier otro error de red/HTTP se propaga al caller.
   */
  async deleteAppointmentEvent(
    tenantId: string,
    appointment: AppointmentEventInput
  ): Promise<void> {
    if (!appointment.google_event_id) {
      // Nada que borrar.
      return;
    }

    const accessToken = await googleAccountService.ensureAccessToken(tenantId);
    if (!accessToken) {
      return;
    }

    try {
      await axios.delete(`${CALENDAR_EVENTS_URL}/${appointment.google_event_id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 404 || status === 410) {
        // El evento ya no existe: nada que hacer.
        return;
      }
      throw error;
    }
  },

  /**
   * Crea un contacto en los Google Contacts del emprendedor (People API).
   *
   * - No-op (retorna null) si el tenant no esta conectado.
   * - Crea el contacto con nombre, telefono y email (si existe).
   *
   * Nota de alcance: la deduplicacion / actualizacion idempotente real
   * requeriria buscar el contacto por email o telefono (people.searchContacts /
   * people.connections.list) antes de decidir crear vs actualizar. Para esta
   * tarea basta con CREAR el contacto; la deduplicacion avanzada queda FUERA DE
   * ALCANCE.
   */
  async upsertContact(
    tenantId: string,
    customer: ContactInput
  ): Promise<UpsertContactResult | null> {
    const accessToken = await googleAccountService.ensureAccessToken(tenantId);
    if (!accessToken) {
      return null;
    }

    const body: Record<string, any> = {};

    if (customer.name) {
      body.names = [{ givenName: customer.name }];
    }
    if (customer.phone) {
      body.phoneNumbers = [{ value: customer.phone }];
    }
    if (customer.email) {
      body.emailAddresses = [{ value: customer.email }];
    }

    const response = await axios.post(PEOPLE_CREATE_CONTACT_URL, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const resourceName = response.data?.resourceName;
    return resourceName ? { resource_name: resourceName } : null;
  },
};
