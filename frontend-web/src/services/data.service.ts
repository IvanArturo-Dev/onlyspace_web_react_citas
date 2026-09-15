import api from "./api";
import type { Appointment, AppointmentStatus, Customer, Service } from "../types";
import type { WaitlistEntry } from "./waitlist.service";

// Desenvuelve respuestas del backend con forma { success, data } de forma robusta.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

// ---- Payloads ----
// Comportamiento del cliente (asistencias/cancelaciones/inasistencias) scoped
// por tenant, mas el flag at_risk (tendencia a no asistir). Lo devuelve
// GET /customers/:id/behavior.
export interface CustomerBehavior {
  attended: number;
  cancelled: number;
  no_show: number;
  at_risk: boolean;
}

export interface CustomerPayload {
  name: string;
  phone: string;
  email?: string;
  birth_date?: string;
  notes?: string;
  tags?: string[];
}

export interface ServicePayload {
  name: string;
  description?: string;
  duration_mins: number;
  price: number;
  color?: string;
  prep_time_mins?: number;
  post_time_mins?: number;
  capacity?: number;
}

export interface AppointmentPayload {
  customer_id: string;
  service_id: string;
  professional_id?: string;
  start_time: string; // ISO
  notes?: string;
  branch_id?: string;
  // Modalidad de la cita. El backend detecta "en linea" por modality === 'online'
  // (o location === 'En linea'); para citas en linea confirmadas se genera el Meet.
  // 'home' habilita la modalidad a domicilio (requiere domicilio + maps_url).
  modality?: "in_person" | "online" | "home";
  // URL de videollamada manual (Meet, Zoom, Teams...). "" limpia; http(s) valida.
  video_call_url?: string;
  // Telefono de contacto del cliente para la cita (obligatorio en el backend).
  contact_phone?: string;
  // Domicilio del cliente; obligatorio cuando modality === 'home'.
  home_address?: string;
  // Enlace de Google Maps del domicilio; obligatorio cuando modality === 'home'.
  maps_url?: string;
}

// Reprogramacion / actualizacion de una cita existente.
export interface AppointmentUpdatePayload {
  start_time?: string; // ISO
  service_id?: string;
  notes?: string;
  branch_id?: string;
  professional_id?: string;
  // Modalidad de la cita. El backend la normaliza (online / in_person / home).
  modality?: "in_person" | "online" | "home";
  // URL de videollamada manual (Meet, Zoom, Teams...). "" limpia; http(s) valida.
  video_call_url?: string;
  // Telefono de contacto del cliente para la cita (obligatorio en el backend).
  contact_phone?: string;
  // Domicilio del cliente; obligatorio cuando modality === 'home'.
  home_address?: string;
  // Enlace de Google Maps del domicilio; obligatorio cuando modality === 'home'.
  maps_url?: string;
}

// Enlace de recordatorio de WhatsApp construido por el backend.
export interface WhatsappReminder {
  url: string;
  message: string;
  phone: string;
}

// Resultado de cancelar una cita. El backend incluye la sugerencia de la lista de
// espera (primera entrada WAITING compatible con el hueco liberado) o null.
export interface CancelAppointmentResult {
  appointment?: Appointment;
  waitlist_suggestion?: WaitlistEntry | null;
}

// Perfil de WhatsApp del negocio.
export interface BusinessProfile {
  whatsapp_number?: string | null;
  whatsapp_template?: string | null;
}

// Pago manual de una cita (total/parcial). El backend deriva payment_status.
export interface PaymentPayload {
  amount_total: number;
  amount_paid: number;
  currency?: string;
}

// Nota interna (bitacora) asociada a una cita; solo visible para el negocio.
export interface AppointmentNote {
  id: string;
  body: string;
  author_id: string | null;
  created_at: string;
}

export interface AppointmentFilters {
  start_date?: string;
  end_date?: string;
  status?: AppointmentStatus;
  branch_id?: string;
  page?: number;
  limit?: number;
}

// Estadistica mensual del comportamiento de citas (solo premium). El backend
// devuelve un arreglo con un elemento por mes.
export interface MonthlyStat {
  month: string; // 'YYYY-MM'
  total: number;
  by_status: Record<string, number>;
  income: number;
}

// Resultado de listar citas conservando el metadato de plan del tenant.
export interface AppointmentsMeta {
  appointments: Appointment[];
  is_premium: boolean;
}

// Comportamiento agregado por mes (dashboard). El backend devuelve un elemento
// por mes con conteos de asistencias/cancelaciones/inasistencias.
export interface MonthlyBehavior {
  month: string; // 'YYYY-MM'
  attended: number;
  cancelled: number;
  no_show: number;
}

// Una fila de ranking de clientes (dashboard): cliente + su conteo.
export interface ClientRankingRow {
  customer_id: string;
  name: string;
  count: number;
}

// Rankings de clientes del tenant: top por asistencias, inasistencias y
// recompensas de lealtad.
export interface ClientRankings {
  topAttendance: ClientRankingRow[];
  topNoShow: ClientRankingRow[];
  topRewards: ClientRankingRow[];
}

// Configuracion de agendado del negocio. booking_horizon_days controla hasta
// cuantos dias en el futuro puede reservar un cliente (0 = sin limite).
export interface BookingSettings {
  booking_horizon_days: number;
}

// Modalidad ofrecida por el negocio (nivel tenant) - LEGACY. 'both' habilita
// presencial y en linea; una sola limita la reserva a esa modalidad. Se conserva
// por compatibilidad durante la transicion a offered_modalities (Requirements 2.1, 2.4).
export type OfferedModality = "in_person" | "online" | "both";

// Modalidad de UNA cita concreta (Requirements 2.3, 3.2). 'home' habilita la
// modalidad a domicilio. Es el nuevo concepto que compone la lista de modalidades
// ofrecidas por el negocio (offered_modalities).
export type Modality = "in_person" | "online" | "home";

// Configuracion del negocio (ADMIN, tenant-scoped) devuelta por GET /me/settings:
// modalidades ofrecidas, auto-asignacion de la lista de espera y visibilidad del
// contacto en el portal publico (Requirements 2.1, 4.1, 6.1).
export interface BusinessSettings {
  // Lista de modalidades ofrecidas (nuevo concepto; leer preferente).
  offered_modalities: Modality[];
  // Modalidad ofrecida LEGACY (compat); se conserva durante la transicion.
  offered_modality: OfferedModality;
  waitlist_auto_assign: boolean;
  show_contact: boolean;
  // Recargo por servicio a domicilio a nivel de negocio (>= 0; 0 = sin costo
  // adicional). Se muestra al cliente al elegir la modalidad a domicilio
  // (Requirements 1.1, 1.2, 1.5).
  home_service_fee: number;
}

// Payload para PATCH /me/settings: solo se aplican los campos presentes.
export type BusinessSettingsUpdate = Partial<BusinessSettings>;

// Un paso de la guia de configuracion del negocio (Requirements 4.1, 4.2).
// `done` indica si el paso ya esta cumplido segun los datos reales; `optional`
// marca pasos que no penalizan el porcentaje (p. ej. personalizar marca).
export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  optional: boolean;
}

// Progreso de configuracion del negocio devuelto por GET /me/setup-progress
// (ADMIN, tenant-scoped). `percent` es el avance de los pasos obligatorios y
// `ready` indica que el negocio esta listo para recibir reservas (Requirements
// 4.3, 4.5).
export interface SetupProgress {
  steps: SetupStep[];
  required_done: number;
  required_total: number;
  percent: number;
  ready: boolean;
}

// Desanida nombres de cliente/servicio para render facil, conservando anidados.
function normalizeAppointments(list: Appointment[]): Appointment[] {
  return list.map((a) => ({
    ...a,
    customer_name: a.customer?.name ?? a.customer_name,
    service_name: a.service?.name ?? a.service_name,
    booked_by_email: a.booked_by_email ?? null,
    booked_by_name: a.booked_by_name ?? null,
  }));
}

export const dataService = {
  // ------- CLIENTES -------
  async listCustomers(search?: string): Promise<Customer[]> {
    const res = await api.get("/customers", {
      params: { search: search || undefined, page: 1, limit: 100 },
    });
    const payload = unwrap<{ customers: Customer[] } | Customer[]>(res.data);
    if (Array.isArray(payload)) return payload;
    return payload?.customers ?? [];
  },

  async createCustomer(payload: CustomerPayload): Promise<Customer> {
    const res = await api.post("/customers", payload);
    return unwrap<Customer>(res.data);
  },

  async updateCustomer(id: string, payload: Partial<CustomerPayload>): Promise<Customer> {
    const res = await api.put(`/customers/${id}`, payload);
    return unwrap<Customer>(res.data);
  },

  async deleteCustomer(id: string): Promise<void> {
    await api.delete(`/customers/${id}`);
  },

  // Comportamiento del cliente (asistio/cancelo/no asistio) + at_risk, scoped por
  // tenant. Requiere ADMIN en el backend (requireAdmin).
  async getCustomerBehavior(customerId: string): Promise<CustomerBehavior> {
    const res = await api.get(`/customers/${customerId}/behavior`);
    return unwrap<CustomerBehavior>(res.data);
  },

  // Bloquear/desbloquear cliente. status: "active" | "blocked". Devuelve el
  // Customer actualizado. Requiere ADMIN en el backend.
  async setCustomerStatus(
    customerId: string,
    status: "active" | "blocked"
  ): Promise<Customer> {
    const res = await api.patch(`/customers/${customerId}/status`, { status });
    return unwrap<Customer>(res.data);
  },

  // ------- SERVICIOS -------
  async listServices(): Promise<Service[]> {
    const res = await api.get("/services", { params: { is_active: true } });
    const payload = unwrap<Service[]>(res.data);
    return payload ?? [];
  },

  async createService(payload: ServicePayload): Promise<Service> {
    const res = await api.post("/services", payload);
    return unwrap<Service>(res.data);
  },

  async updateService(id: string, payload: Partial<ServicePayload>): Promise<Service> {
    const res = await api.put(`/services/${id}`, payload);
    return unwrap<Service>(res.data);
  },

  async deleteService(id: string): Promise<void> {
    await api.delete(`/services/${id}`);
  },

  // ------- CITAS -------
  async listAppointments(filters?: AppointmentFilters): Promise<Appointment[]> {
    const res = await api.get("/appointments", {
      params: {
        start_date: filters?.start_date,
        end_date: filters?.end_date,
        status: filters?.status,
        branch_id: filters?.branch_id,
        page: filters?.page ?? 1,
        limit: filters?.limit ?? 100,
      },
    });
    const payload = unwrap<{ appointments: Appointment[] } | Appointment[]>(res.data);
    const list = Array.isArray(payload) ? payload : payload?.appointments ?? [];
    // Exponer nombres desanidados para render facil, conservando los anidados.
    return normalizeAppointments(list);
  },

  // Como listAppointments pero conserva el metadato is_premium del endpoint, que
  // es la fuente autoritativa del plan (el store usePremium es best-effort/visual).
  async listAppointmentsMeta(filters?: AppointmentFilters): Promise<AppointmentsMeta> {
    const res = await api.get("/appointments", {
      params: {
        start_date: filters?.start_date,
        end_date: filters?.end_date,
        status: filters?.status,
        branch_id: filters?.branch_id,
        page: filters?.page ?? 1,
        limit: filters?.limit ?? 100,
      },
    });
    const payload = unwrap<{ appointments: Appointment[]; is_premium?: boolean } | Appointment[]>(
      res.data
    );
    const list = Array.isArray(payload) ? payload : payload?.appointments ?? [];
    const isPremium = Array.isArray(payload) ? false : !!payload?.is_premium;
    return { appointments: normalizeAppointments(list), is_premium: isPremium };
  },

  // Comportamiento por mes (solo premium). 403 PREMIUM_REQUIRED si no es premium
  // (el error se propaga para que la UI muestre el mensaje adecuado).
  async getMonthlyStats(months = 6): Promise<MonthlyStat[]> {
    const res = await api.get("/appointments/monthly-stats", { params: { months } });
    return unwrap<MonthlyStat[]>(res.data) ?? [];
  },

  // ------- DASHBOARD (comportamiento) -------
  // Comportamiento por mes: [{ month, attended, cancelled, no_show }] ordenado
  // ascendente. ADMIN + tenant-scoped en el backend.
  async getMonthlyBehavior(months = 6): Promise<MonthlyBehavior[]> {
    const res = await api.get("/dashboard/monthly-behavior", { params: { months } });
    return unwrap<MonthlyBehavior[]>(res.data) ?? [];
  },

  // Rankings de clientes del tenant: top por asistencias, inasistencias y
  // recompensas. ADMIN + tenant-scoped en el backend.
  async getClientRankings(limit = 5): Promise<ClientRankings> {
    const res = await api.get("/dashboard/client-rankings", { params: { limit } });
    return (
      unwrap<ClientRankings>(res.data) ?? { topAttendance: [], topNoShow: [], topRewards: [] }
    );
  },

  // Descarga el reporte de citas en CSV (solo premium). Pide el blob al backend y
  // dispara la descarga en el navegador. 403 PREMIUM_REQUIRED se propaga para que
  // la UI muestre el mensaje adecuado.
  async downloadReport(startDate?: string, endDate?: string): Promise<void> {
    const res = await api.get("/appointments/report", {
      params: { start_date: startDate || undefined, end_date: endDate || undefined },
      responseType: "blob",
    });
    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "reporte-citas.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  async createAppointment(payload: AppointmentPayload): Promise<Appointment> {
    const res = await api.post("/appointments", payload);
    return unwrap<Appointment>(res.data);
  },

  async updateAppointmentStatus(id: string, status: AppointmentStatus): Promise<Appointment> {
    const res = await api.patch(`/appointments/${id}/status`, { status });
    return unwrap<Appointment>(res.data);
  },

  // Cancela una cita. El backend puede devolver `waitlist_suggestion` (primera
  // entrada WAITING de la cola para el hueco liberado) o null. Devolvemos el body
  // desenvuelto para que la UI pueda ofrecer la reasignacion.
  async cancelAppointment(id: string): Promise<CancelAppointmentResult> {
    const res = await api.delete(`/appointments/${id}`);
    return unwrap<CancelAppointmentResult>(res.data) ?? {};
  },

  // Archivar una cita pasada: la oculta del listado (el backend excluye archivadas). No destruye datos.
  async archiveAppointment(id: string): Promise<void> {
    await api.patch(`/appointments/${id}/archive`);
  },

  // Reprogramar/actualizar una cita (fecha/hora, servicio, notas). 409 SLOT_TAKEN si sobrecupo.
  async updateAppointment(id: string, payload: AppointmentUpdatePayload): Promise<Appointment> {
    const res = await api.patch(`/appointments/${id}`, payload);
    return unwrap<Appointment>(res.data);
  },

  // Actualizar el telefono del cliente de una cita (para poder enviar el recordatorio).
  async updateCustomerPhone(id: string, phone: string): Promise<Appointment> {
    const res = await api.patch(`/appointments/${id}/customer-phone`, { phone });
    return unwrap<Appointment>(res.data);
  },

  // Obtener el enlace wa.me con el mensaje prellenado. 400 PHONE_REQUIRED si falta telefono.
  async getWhatsappReminder(id: string): Promise<WhatsappReminder> {
    const res = await api.get(`/appointments/${id}/whatsapp-reminder`);
    return unwrap<WhatsappReminder>(res.data);
  },

  // ------- PAGO MANUAL -------
  // Registrar total/pagado; el backend deriva payment_status. 400 VALIDATION_ERROR si pagado > total.
  async updatePayment(id: string, payload: PaymentPayload): Promise<Appointment> {
    const res = await api.patch(`/appointments/${id}/payment`, payload);
    return unwrap<Appointment>(res.data);
  },

  // ------- NOTAS INTERNAS (bitacora) -------
  async listNotes(id: string): Promise<AppointmentNote[]> {
    const res = await api.get(`/appointments/${id}/notes`);
    return unwrap<AppointmentNote[]>(res.data) ?? [];
  },

  async addNote(id: string, body: string): Promise<AppointmentNote> {
    const res = await api.post(`/appointments/${id}/notes`, { body });
    return unwrap<AppointmentNote>(res.data);
  },

  async deleteNote(id: string, noteId: string): Promise<{ id: string }> {
    const res = await api.delete(`/appointments/${id}/notes/${noteId}`);
    return unwrap<{ id: string }>(res.data);
  },

  // ------- PERFIL DEL NEGOCIO (WhatsApp) -------
  async getBusiness(): Promise<BusinessProfile> {
    const res = await api.get("/me/business");
    return unwrap<BusinessProfile>(res.data) ?? {};
  },

  async updateBusiness(payload: BusinessProfile): Promise<BusinessProfile> {
    const res = await api.patch("/me/business", payload);
    return unwrap<BusinessProfile>(res.data) ?? {};
  },

  // ------- CONFIGURACION DE AGENDADO -------
  // Horizonte de agendado: hasta cuantos dias en el futuro puede reservar un cliente.
  async getBookingSettings(): Promise<BookingSettings> {
    const res = await api.get("/me/booking-settings");
    return unwrap<BookingSettings>(res.data) ?? { booking_horizon_days: 0 };
  },

  async updateBookingSettings(days: number): Promise<BookingSettings> {
    const res = await api.patch("/me/booking-settings", { booking_horizon_days: days });
    return unwrap<BookingSettings>(res.data) ?? { booking_horizon_days: days };
  },

  // ------- CONFIGURACION DEL NEGOCIO (modalidad / waitlist / contacto) -------
  // Lee la config del negocio: modalidad ofrecida, auto-asignacion de la lista
  // de espera y visibilidad del contacto en el portal. ADMIN + tenant-scoped en
  // el backend (Requirements 2.1, 4.1, 6.1).
  async getBusinessSettings(): Promise<BusinessSettings> {
    const res = await api.get("/me/settings");
    return (
      unwrap<BusinessSettings>(res.data) ?? {
        offered_modalities: ["in_person"],
        offered_modality: "in_person",
        waitlist_auto_assign: false,
        show_contact: false,
        home_service_fee: 0,
      }
    );
  },

  // Actualiza la config del negocio. Solo se envian los campos presentes en el
  // payload; el backend valida offered_modality contra {in_person,online,both}.
  // Devuelve el estado actualizado. ADMIN + tenant-scoped.
  async updateBusinessSettings(payload: BusinessSettingsUpdate): Promise<BusinessSettings> {
    const res = await api.patch("/me/settings", payload);
    return (
      unwrap<BusinessSettings>(res.data) ?? {
        offered_modalities: ["in_person"],
        offered_modality: "in_person",
        waitlist_auto_assign: false,
        show_contact: false,
        home_service_fee: 0,
      }
    );
  },

  // ------- GUIA DE USO (progreso de configuracion) -------
  // Progreso de la configuracion del negocio para la guia de uso: pasos,
  // completados/total obligatorios, porcentaje y si esta listo para recibir
  // reservas. ADMIN + tenant-scoped en el backend (Requirements 4.1-4.5).
  async getSetupProgress(): Promise<SetupProgress> {
    const res = await api.get("/me/setup-progress");
    return (
      unwrap<SetupProgress>(res.data) ?? {
        steps: [],
        required_done: 0,
        required_total: 0,
        percent: 0,
        ready: false,
      }
    );
  },
};
