import { HttpError } from './errors';

/** Modalidad de cita normalizada. */
export type Modality = 'in_person' | 'online' | 'home';

/** Conjunto de modalidades validas/permitidas. */
const VALID_MODALITIES: readonly Modality[] = ['in_person', 'online', 'home'];

/**
 * Normaliza la modalidad solicitada. El valor exacto 'online' cuenta como cita
 * en linea y 'home' como cita a domicilio; cualquier otro valor (ausente, null,
 * desconocido o 'in_person') se resuelve como 'in_person'. Mismo criterio que
 * usan booking.service y appointment.service para persistir la modalidad.
 */
export function normalizeModality(modality?: string | null): Modality {
  if (modality === 'online') return 'online';
  if (modality === 'home') return 'home';
  return 'in_person';
}

/**
 * Normaliza la modalidad ofrecida por el negocio a una lista de modalidades
 * validas y sin duplicados. Acepta:
 *  - Un CSV (p.ej. "in_person,home") o un array de strings.
 *  - Compatibilidad legacy: el valor exacto 'both' -> ['in_person','online'].
 *
 * Cada valor se filtra al set permitido {in_person, online, home}; los valores
 * desconocidos se descartan. Si el resultado queda vacio (o el valor es
 * null/undefined) se devuelve ['in_person'] (el default del modelo),
 * preservando el comportamiento historico (solo presencial).
 *
 * Requirements: 1.1, 1.3, 2.5.
 *
 * @param value CSV, array o legacy 'both' (Tenant.offered_modalities / offered_modality).
 * @returns Lista de modalidades unica y no vacia.
 */
export function parseOfferedModalities(
  value: string | string[] | null | undefined
): Modality[] {
  if (value === null || value === undefined) {
    return ['in_person'];
  }

  // Compatibilidad legacy: 'both' equivale a presencial + en linea.
  if (typeof value === 'string' && value.trim() === 'both') {
    return ['in_person', 'online'];
  }

  // Aceptar CSV o array; separar y limpiar cada token.
  const tokens = Array.isArray(value)
    ? value
    : value.split(',');

  const result: Modality[] = [];
  for (const raw of tokens) {
    const token = typeof raw === 'string' ? raw.trim() : '';
    // Solo conservar valores exactos del set permitido (sin normalizar
    // valores desconocidos a in_person para no inventar modalidades).
    if ((VALID_MODALITIES as readonly string[]).includes(token)) {
      const modality = token as Modality;
      if (!result.includes(modality)) {
        result.push(modality);
      }
    }
  }

  return result.length > 0 ? result : ['in_person'];
}

/**
 * Valida un array de modalidades ofrecidas recibido desde el panel/API
 * (PATCH /v1/me/settings). Reglas:
 *  - Debe ser un array con al menos una modalidad.
 *  - Todos los valores deben pertenecer a {in_person, online, home}.
 *  - Se eliminan duplicados preservando el orden.
 *
 * A diferencia de parseOfferedModalities (que sanea datos persistidos y nunca
 * falla), aqui la entrada es del usuario y un valor invalido debe rechazarse
 * con 400 VALIDATION_ERROR (no silenciarse).
 *
 * Requirements: 1.1, 1.2.
 *
 * @param value Array de modalidades enviado por el cliente.
 * @returns Lista de modalidades validada, unica y no vacia.
 * @throws HttpError 400 VALIDATION_ERROR cuando la entrada es invalida.
 */
export function validateOfferedModalitiesArray(value: unknown): Modality[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(
      'offered_modalities debe ser un array con al menos una modalidad',
      400,
      'VALIDATION_ERROR'
    );
  }

  const result: Modality[] = [];
  for (const raw of value) {
    if (
      typeof raw !== 'string' ||
      !(VALID_MODALITIES as readonly string[]).includes(raw)
    ) {
      throw new HttpError(
        "offered_modalities solo admite: 'in_person', 'online', 'home'",
        400,
        'VALIDATION_ERROR'
      );
    }
    const modality = raw as Modality;
    if (!result.includes(modality)) {
      result.push(modality);
    }
  }

  return result;
}

/**
 * Valida que la modalidad solicitada este habilitada por las modalidades
 * ofrecidas por el negocio (Tenant.offered_modalities). La lista ofrecida se
 * obtiene con parseOfferedModalities, que tambien maneja el string legacy
 * (incluyendo 'both'), por lo que sigue siendo compatible con las llamadas que
 * pasan un offered_modality string.
 *
 * La modalidad solicitada se normaliza antes de comparar. Un `offered`
 * ausente/desconocido se resuelve a ['in_person'] (el default del modelo),
 * preservando el comportamiento historico (solo presencial).
 *
 * Requirements: 2.1, 2.2, 2.4, 2.5.
 *
 * @param offered   Tenant.offered_modalities (CSV o array) o offered_modality legacy.
 * @param requested Modalidad pedida por el cliente/panel (se normaliza).
 * @throws HttpError 400 MODALITY_NOT_OFFERED cuando la modalidad no aplica.
 */
export function assertModalityOffered(
  offered: string | string[] | null | undefined,
  requested?: string | null
): void {
  const offeredList = parseOfferedModalities(offered);
  const requestedModality = normalizeModality(requested);

  if (!offeredList.includes(requestedModality)) {
    throw new HttpError(
      'La modalidad solicitada no esta disponible en este negocio',
      400,
      'MODALITY_NOT_OFFERED'
    );
  }
}

/**
 * Valida que una URL tenga formato http/https valido.
 * @param value URL a validar.
 * @returns true si es una URL con protocolo http: o https:.
 */
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Valida los datos de contacto/domicilio obligatorios al agendar una cita.
 * Aplica igual en portal publico y panel del emprendedor. Reglas:
 *  - contact_phone: obligatorio y no vacio (tras trim). Si falta -> 400
 *    CONTACT_PHONE_REQUIRED.
 *  - Si la modalidad normalizada es 'home': home_address obligatorio no vacio y
 *    maps_url obligatorio no vacio con formato URL http/https. Si falta
 *    cualquiera o la URL es invalida -> 400 HOME_DETAILS_REQUIRED.
 *  - Si la modalidad no es 'home': no se exigen home_address ni maps_url.
 *
 * Requirements: 3.1, 3.3, 3.4.
 *
 * @param input Datos de la reserva a validar.
 * @throws HttpError 400 CONTACT_PHONE_REQUIRED cuando falta el telefono.
 * @throws HttpError 400 HOME_DETAILS_REQUIRED cuando falta direccion/maps_url o la URL es invalida.
 */
export function assertBookingContact(input: {
  modality?: string | null;
  contact_phone?: string | null;
  home_address?: string | null;
  maps_url?: string | null;
}): void {
  // El telefono de contacto es obligatorio siempre.
  const contactPhone = (input.contact_phone ?? '').trim();
  if (contactPhone.length === 0) {
    throw new HttpError(
      'El numero de contacto es obligatorio',
      400,
      'CONTACT_PHONE_REQUIRED'
    );
  }

  // Solo la modalidad a domicilio exige direccion + URL de Google Maps.
  if (normalizeModality(input.modality) === 'home') {
    const homeAddress = (input.home_address ?? '').trim();
    const mapsUrl = (input.maps_url ?? '').trim();

    if (
      homeAddress.length === 0 ||
      mapsUrl.length === 0 ||
      !isValidHttpUrl(mapsUrl)
    ) {
      throw new HttpError(
        'Para servicio a domicilio, la direccion y la URL de Google Maps son obligatorias',
        400,
        'HOME_DETAILS_REQUIRED'
      );
    }
  }
}
