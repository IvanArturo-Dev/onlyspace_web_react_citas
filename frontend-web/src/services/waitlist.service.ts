import api from "./api";

// Entrada en la lista de espera de un servicio.
export interface WaitlistEntry {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  service_id: string;
  customer_id: string;
  desired_date: string;
  desired_start: string | null;
  status: string;
  created_at: string;
  // Enriquecido por el backend (listWaitlist) para ordenar/destacar la cola por
  // precio del servicio en la vista del emprendedor. Aditivo y opcional.
  service_name?: string | null;
  service_price?: number | null;
}

// Cuerpo para unirse a la lista de espera.
export interface WaitlistJoinInput {
  branchId?: string;
  serviceId: string;
  customerId: string;
  desiredDate: string;
  desiredStart?: string;
}

// Cita en riesgo (candidata a caerse) mostrada al staff. Solo tipamos los
// campos que consume la UI.
export interface AtRiskAppointment {
  id: string;
  start_time: string;
  status: string;
  customer?: { name: string } | null;
  service?: { name: string } | null;
}

// Cuerpo de una oferta de hueco a una entrada de la lista de espera.
export interface WaitlistOfferInput {
  start: string;
  end: string;
  branch_id?: string;
}

// Resultado de ofrecer un hueco: la entrada actualizada + la cita tentativa.
export interface WaitlistOfferResult {
  entry: WaitlistEntry;
  appointment: unknown;
}

// Enlace de WhatsApp generado para contactar al cliente de la lista de espera.
export interface WaitlistWhatsapp {
  url: string;
  message: string;
  phone: string;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

// Cuerpo para que un CLIENTE se una a la lista de espera desde el portal
// publico. El customer se resuelve en el backend por la sesion; aqui solo se
// envia el servicio, la fecha deseada y el telefono de contacto.
export interface PublicWaitlistJoinInput {
  serviceId: string;
  date: string;
  phone: string;
  desiredStart?: string;
}

export const waitlistService = {
  // Une un cliente a la lista de espera de un servicio (uso del STAFF:
  // POST /appointments/waitlist, requiere rol ADMIN/ASSISTANT).
  async join(input: WaitlistJoinInput): Promise<WaitlistEntry> {
    const res = await api.post("/appointments/waitlist", input);
    return unwrap<WaitlistEntry>(res.data);
  },

  // Une al CLIENTE autenticado a la lista de espera desde el portal publico
  // (POST /public/:code/waitlist). Analogo a la reserva publica: el backend
  // resuelve/crea el customer del tenant a partir de la sesion y guarda el
  // telefono de contacto. Evita el 403 del endpoint de staff.
  async joinPublic(code: string, input: PublicWaitlistJoinInput): Promise<WaitlistEntry> {
    const res = await api.post(`/public/${encodeURIComponent(code)}/waitlist`, {
      service_id: input.serviceId,
      date: input.date,
      phone: input.phone,
      ...(input.desiredStart ? { desired_start: input.desiredStart } : {}),
    });
    return unwrap<WaitlistEntry>(res.data);
  },

  // Lista la cola de espera filtrada por servicio y fecha.
  async listQueue(serviceId: string, date: string): Promise<WaitlistEntry[]> {
    const res = await api.get("/appointments/waitlist", {
      params: { service_id: serviceId, date },
    });
    return unwrap<WaitlistEntry[]>(res.data) ?? [];
  },

  // Ofrece un hueco concreto a una entrada de la lista.
  async offer(
    entryId: string,
    body: WaitlistOfferInput
  ): Promise<WaitlistOfferResult> {
    const res = await api.post(
      `/appointments/waitlist/${encodeURIComponent(entryId)}/offer`,
      body
    );
    return unwrap<WaitlistOfferResult>(res.data);
  },

  // Genera el enlace de WhatsApp para contactar al cliente de la entrada.
  async whatsapp(entryId: string): Promise<WaitlistWhatsapp> {
    const res = await api.get(
      `/appointments/waitlist/${encodeURIComponent(entryId)}/whatsapp`
    );
    return unwrap<WaitlistWhatsapp>(res.data);
  },

  // Confirma la oferta enviada, cerrando la entrada de la lista.
  async confirm(entryId: string): Promise<WaitlistEntry> {
    const res = await api.post(
      `/appointments/waitlist/${encodeURIComponent(entryId)}/confirm`
    );
    return unwrap<WaitlistEntry>(res.data);
  },

  // Lista las citas en riesgo (para ofrecer sus huecos a la lista de espera).
  async atRisk(): Promise<AtRiskAppointment[]> {
    const res = await api.get("/appointments/at-risk");
    return unwrap<AtRiskAppointment[]>(res.data) ?? [];
  },
};
