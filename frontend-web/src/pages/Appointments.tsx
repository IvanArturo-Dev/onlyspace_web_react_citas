import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { Modal } from "../components/Modal";
import Spinner from "../components/Spinner";
import { WaitlistReassignModal } from "../components/WaitlistReassignModal";
import { WaitlistPanel } from "../components/WaitlistPanel";
import { useAuthStore } from "../store/useAuthStore";
import type { WaitlistEntry } from "../services/waitlist.service";
import { trackEvent } from "../lib/firebase";
import { dataService, type AppointmentPayload, type AppointmentNote, type MonthlyStat } from "../services/data.service";
import BarChart, { type BarDatum } from "../components/charts/BarChart";
import { branchService } from "../services/branch.service";
import { useBranchStore } from "../store/useBranchStore";
import { usePremium } from "../store/usePremium";
import type { Appointment, AppointmentStatus, Customer, PaymentStatus, Service } from "../types";
import { card, pageTitle, btn, badge, field, emptyState, table, th, td } from "../ui/ui";

const ALL_BRANCHES = "__all__";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No asistio",
};

const STATUS_BADGE: Record<AppointmentStatus, "success" | "warning" | "danger" | "info" | "muted"> = {
  PENDING: "warning",
  CONFIRMED: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
  NO_SHOW: "muted",
};

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Sin pagar",
  partial: "Parcial",
  paid: "Pagado",
};

const PAYMENT_BADGE: Record<PaymentStatus, "success" | "warning" | "muted"> = {
  unpaid: "muted",
  partial: "warning",
  paid: "success",
};

interface FormState {
  customer_id: string;
  service_id: string;
  start_time: string; // datetime-local
  notes: string;
  modality: "in_person" | "online";
  video_call_url: string;
}

const emptyForm: FormState = {
  customer_id: "",
  service_id: "",
  start_time: "",
  notes: "",
  modality: "in_person",
  video_call_url: "",
};

// Traduce codigos 409 del backend a mensajes claros y distintos entre si.
// SLOT_TAKEN = aforo del servicio alcanzado; DUPLICATE_BOOKING = misma categoria/dia.
function mapBookingError(err: any, fallback: string): string {
  const code = err?.response?.data?.error?.code;
  if (code === "SLOT_TAKEN") return "Ese horario esta lleno (cupo alcanzado).";
  if (code === "DUPLICATE_BOOKING") return "Este cliente ya tiene una cita de esta categoria hoy.";
  return readError(err, fallback);
}

// Si el backend rechaza la URL de videollamada (400 VALIDATION_ERROR), muestra un
// mensaje claro; en caso contrario, devuelve el fallback ya calculado.
function mapVideoUrlError(err: any, fallback: string): string {
  const code = err?.response?.data?.error?.code;
  if (code === "VALIDATION_ERROR") {
    return "La URL de videollamada no es válida (debe empezar con http:// o https://).";
  }
  return fallback;
}

// Clave de dia calendario LOCAL (YYYY-MM-DD) a partir de un ISO. Sirve para agrupar Hoy/Proximas/Pasadas.
function localDayKey(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const smallBtn = (variant: "secondary" | "danger" | "primary" | "ghost"): CSSProperties => ({
  ...btn(variant),
  padding: "6px 12px",
  fontSize: 13,
});

const dangerGhost: CSSProperties = {
  ...btn("ghost"),
  padding: "6px 12px",
  fontSize: 13,
  color: "var(--danger)",
  border: "1px solid var(--danger-soft)",
};

export default function Appointments() {
  const { branches, loadBranches } = useBranchStore();
  // Plan premium del tenant (best-effort, cacheado). Free solo ve la columna "Hoy".
  const { isPremium } = usePremium();
  // Solo el emprendedor (ADMIN) ve la reasignacion y el panel de espera.
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // is_premium autoritativo devuelto por el endpoint de citas. Se prefiere sobre
  // el store usePremium (best-effort/visual) para el gating de reportes y graficas.
  const [apiPremium, setApiPremium] = useState<boolean | null>(null);

  // --- Reporte CSV (solo premium) ---
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");

  // --- Comportamiento por mes (solo premium) ---
  const [stats, setStats] = useState<MonthlyStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");

  // Datos para el modal "Se liberó un espacio" (reasignacion tras cancelar).
  const [reassign, setReassign] = useState<{
    entry: WaitlistEntry;
    slotStart: string;
    slotEnd: string;
    branchId: string | null;
    customerName: string | null;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "">("");
  const [branchFilter, setBranchFilter] = useState<string>(ALL_BRANCHES);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // --- Detalles de la cita (al hacer clic en una tarjeta) ---
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsAppt, setDetailsAppt] = useState<Appointment | null>(null);

  const openDetails = (a: Appointment) => {
    setDetailsAppt(a);
    setDetailsOpen(true);
    setNotes([]);
    setNewNote("");
    setNotesError("");
    setShowNoteForm(false);
    loadNotes(a.id);
  };

  // --- Gestion por cita: reprogramar, telefono y recordatorio de WhatsApp ---
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAppt, setManageAppt] = useState<Appointment | null>(null);
  const [manageServices, setManageServices] = useState<Service[]>([]);
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [rescheduleService, setRescheduleService] = useState("");
  const [rescheduleModality, setRescheduleModality] = useState<"in_person" | "online">("in_person");
  const [manageVideoUrl, setManageVideoUrl] = useState("");
  const [phone, setPhone] = useState("");
  const [manageError, setManageError] = useState("");
  const [manageSuccess, setManageSuccess] = useState("");
  const [showPhoneEdit, setShowPhoneEdit] = useState(false);
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [waLoading, setWaLoading] = useState(false);

  // --- Pago manual ---
  const [amountTotal, setAmountTotal] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [currency, setCurrency] = useState("MXN");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | undefined>(undefined);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [payKind, setPayKind] = useState<"completed" | "partial">("partial");

  // --- Notas internas (bitacora) ---
  const [notes, setNotes] = useState<AppointmentNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [newNote, setNewNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  // El formulario de nota esta oculto por defecto; se abre con "Agregar nota".
  const [showNoteForm, setShowNoteForm] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    const branch_id = branchFilter === ALL_BRANCHES ? undefined : branchFilter;
    dataService
      .listAppointmentsMeta({ branch_id })
      .then((data) => {
        setAppointments(data.appointments);
        setApiPremium(data.is_premium);
      })
      .catch((err) => setError(readError(err, "Error al cargar citas")))
      .finally(() => setLoading(false));
  };

  // Premium efectivo: preferimos el is_premium del endpoint (fuente autoritativa);
  // si aun no llega, usamos el store como aproximacion para el gating visual.
  const effectivePremium = apiPremium ?? isPremium;

  // Carga las estadisticas mensuales (solo premium). Idempotente por render.
  const loadStats = () => {
    setStatsLoading(true);
    setStatsError("");
    dataService
      .getMonthlyStats(6)
      .then((data) => setStats(data))
      .catch((err) => {
        if (err?.response?.status === 403) {
          setStatsError("Esta gráfica es solo para cuentas premium.");
        } else {
          setStatsError(readError(err, "No se pudieron cargar las estadísticas"));
        }
      })
      .finally(() => setStatsLoading(false));
  };

  // Descarga el reporte CSV (solo premium). Muestra estado de carga y errores.
  const handleDownloadReport = async () => {
    setReportLoading(true);
    setReportError("");
    try {
      await dataService.downloadReport();
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setReportError("El reporte en CSV es solo para cuentas premium.");
      } else {
        setReportError(readError(err, "No se pudo generar el reporte"));
      }
    } finally {
      setReportLoading(false);
    }
  };

  // Cuando confirmamos que el tenant es premium, cargamos las estadisticas una vez.
  useEffect(() => {
    if (effectivePremium && !statsLoading && stats.length === 0 && !statsError) {
      loadStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePremium]);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Reservaciones" });
    if (branches.length === 0) loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  // Mapea branch_id -> nombre para etiquetar cada cita.
  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name] as const));
    return (id?: string | null) => (id ? map.get(id) ?? "Sucursal" : "");
  }, [branches]);

  const filtered = useMemo(() => {
    // Limites de rango (inclusivo): "desde" al inicio del dia, "hasta" al final del dia.
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return appointments.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (fromTs !== null || toTs !== null) {
        const ts = new Date(a.start_time).getTime();
        if (isNaN(ts)) return false;
        if (fromTs !== null && ts < fromTs) return false;
        if (toTs !== null && ts > toTs) return false;
      }
      return true;
    });
  }, [appointments, statusFilter, dateFrom, dateTo]);

  // Agrupa las citas ya filtradas en Hoy / Proximas / Pasadas por dia calendario LOCAL.
  // Hoy y Proximas se ordenan por hora ASCENDENTE (lo inmediato primero);
  // Pasadas DESCENDENTE (lo mas reciente primero).
  // Clave de dia de HOY (local). Se usa tanto para agrupar como para saber si una cita es pasada.
  const todayKey = useMemo(() => localDayKey(new Date()), []);

  const groups = useMemo(() => {
    // Limite inferior de Pasadas: hoy - 7 dias. Solo mostramos citas en [hoy-7d, hoy).
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - 7);
    const limitKey = localDayKey(limitDate);
    const today: Appointment[] = [];
    const upcoming: Appointment[] = [];
    const past: Appointment[] = [];
    for (const a of filtered) {
      const key = localDayKey(a.start_time);
      if (!key) {
        upcoming.push(a);
        continue;
      }
      if (key === todayKey) today.push(a);
      else if (key > todayKey) upcoming.push(a);
      else if (key >= limitKey) past.push(a); // solo ultimos 7 dias
    }
    const asc = (x: Appointment, y: Appointment) =>
      new Date(x.start_time).getTime() - new Date(y.start_time).getTime();
    today.sort(asc);
    upcoming.sort(asc);
    past.sort((x, y) => -asc(x, y));
    return { today, upcoming, past };
  }, [filtered, todayKey]);

  // Sucursal destino al agendar: la seleccionada en el filtro (si no es "Todas"),
  // o la primera sucursal disponible como fallback.
  const targetBranchId = branchFilter !== ALL_BRANCHES ? branchFilter : branches[0]?.id;

  // --- Indicador de ocupacion del dia (helper en el modal de creacion) ---
  // Se calcula 100% en cliente a partir de las citas ya cargadas del tenant:
  // para el servicio + sucursal + dia elegidos, cuenta citas ACTIVAS (no canceladas)
  // que solapan cada slot y lo compara contra service.capacity. No requiere endpoints nuevos.
  const occupancy = useMemo(() => {
    if (!form.service_id || !form.start_time) return null;
    const service = services.find((s) => s.id === form.service_id);
    if (!service) return null;
    const dayKey = localDayKey(form.start_time);
    if (!dayKey) return null;
    const capacity = Math.max(1, service.capacity ?? 1);
    const durationMs = Math.max(1, service.duration_mins) * 60_000;

    // Citas activas del mismo servicio+sucursal+dia ya existentes.
    const dayAppts = appointments.filter((a) => {
      if (a.status === "CANCELLED") return false;
      if (a.service_id !== form.service_id) return false;
      const aBranch = a.branch_id ?? undefined;
      const tBranch = targetBranchId ?? undefined;
      if (aBranch !== tBranch) return false;
      return localDayKey(a.start_time) === dayKey;
    });

    // Genera slots del dia usando la duracion del servicio, dentro de un horario razonable (08:00-20:00).
    const [y, m, d] = dayKey.split("-").map(Number);
    const dayStart = new Date(y, (m ?? 1) - 1, d ?? 1, 8, 0, 0, 0).getTime();
    const dayEnd = new Date(y, (m ?? 1) - 1, d ?? 1, 20, 0, 0, 0).getTime();
    const slots: { label: string; used: number; capacity: number; selected: boolean }[] = [];
    const selectedTs = new Date(form.start_time).getTime();
    for (let t = dayStart; t < dayEnd; t += durationMs) {
      const slotStart = t;
      const slotEnd = t + durationMs;
      // Cuenta citas que solapan el slot [slotStart, slotEnd).
      const used = dayAppts.reduce((acc, a) => {
        const aStart = new Date(a.start_time).getTime();
        const aEnd = a.end_time ? new Date(a.end_time).getTime() : aStart + durationMs;
        return aStart < slotEnd && aEnd > slotStart ? acc + 1 : acc;
      }, 0);
      const selected = selectedTs >= slotStart && selectedTs < slotEnd;
      const label = new Date(slotStart).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      slots.push({ label, used, capacity, selected });
    }
    return { capacity, slots, serviceName: service.name };
  }, [form.service_id, form.start_time, services, appointments, targetBranchId]);

  const openCreate = async () => {
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
    try {
      // Categorias de la sucursal destino; si no hay sucursal, usa las del tenant.
      const servicesPromise = targetBranchId
        ? branchService.listServices(targetBranchId)
        : dataService.listServices();
      const [cs, sv] = await Promise.all([dataService.listCustomers(), servicesPromise]);
      setCustomers(cs);
      setServices(sv);
    } catch (err) {
      setFormError(readError(err, "No se pudieron cargar clientes/servicios"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_id || !form.service_id || !form.start_time) {
      setFormError("Cliente, servicio y fecha/hora son obligatorios.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload: AppointmentPayload = {
      customer_id: form.customer_id,
      service_id: form.service_id,
      start_time: new Date(form.start_time).toISOString(),
      notes: form.notes.trim() || undefined,
      branch_id: targetBranchId || undefined,
      modality: form.modality,
      // Online: envia la URL (o undefined si vacia para no tocar). Presencial: "" limpia.
      video_call_url: form.modality === "online" ? form.video_call_url.trim() || undefined : "",
    };
    try {
      await dataService.createAppointment(payload);
      setModalOpen(false);
      load();
    } catch (err) {
      setFormError(mapVideoUrlError(err, mapBookingError(err, "No se pudo agendar la cita")));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (a: Appointment, status: AppointmentStatus) => {
    try {
      await dataService.updateAppointmentStatus(a.id, status);
      load();
    } catch (err) {
      setError(mapBookingError(err, "No se pudo actualizar el estado"));
    }
  };

  const cancel = async (a: Appointment) => {
    if (!window.confirm("Cancelar esta cita?")) return;
    try {
      const result = await dataService.cancelAppointment(a.id);
      load();
      // Si el backend sugiere un cliente en espera, abre el modal de reasignacion
      // usando el hueco (start/end) de la cita que se acaba de cancelar.
      if (result?.waitlist_suggestion) {
        setReassign({
          entry: result.waitlist_suggestion,
          slotStart: a.start_time,
          slotEnd: a.end_time,
          branchId: a.branch_id ?? null,
          customerName: a.customer_name || a.customer?.name || null,
        });
      }
    } catch (err) {
      setError(readError(err, "No se pudo cancelar la cita"));
    }
  };

  // Archivar una cita pasada: la oculta de la vista (no destruye datos). Recarga la lista.
  const handleArchive = async (a: Appointment) => {
    if (!window.confirm("Archivar esta cita? Se ocultara de la vista.")) return;
    try {
      await dataService.archiveAppointment(a.id);
      setDetailsOpen(false);
      load();
    } catch (err) {
      setError(readError(err, "No se pudo archivar la cita"));
    }
  };

  // Abre el panel de gestion (reprogramar / telefono / WhatsApp) para una cita.
  const openManage = async (a: Appointment) => {
    setManageAppt(a);
    setManageOpen(true);
    setManageError("");
    setManageSuccess("");
    setShowPhoneEdit(false);
    setRescheduleStart(toLocalInput(a.start_time));
    setRescheduleService(a.service_id);
    setRescheduleModality(a.modality === "online" ? "online" : "in_person");
    setManageVideoUrl(a.video_call_url ?? "");
    setPhone(a.customer?.phone && a.customer.phone !== "sin-telefono" ? a.customer.phone : "");
    setManageServices([]);
    // Pago: precarga con los valores actuales de la cita.
    setAmountTotal(a.amount_total != null ? String(a.amount_total) : "");
    setAmountPaid(a.amount_paid != null ? String(a.amount_paid) : "");
    setCurrency(a.currency || "MXN");
    setPaymentStatus(a.payment_status);
    setPayKind(a.payment_status === "paid" ? "completed" : "partial");
    try {
      const list = a.branch_id
        ? await branchService.listServices(a.branch_id)
        : await dataService.listServices();
      setManageServices(list);
    } catch {
      /* si falla, el select de servicio mostrara solo el actual */
    }
  };

  const loadNotes = (appointmentId: string) => {
    setNotesLoading(true);
    setNotesError("");
    dataService
      .listNotes(appointmentId)
      .then((list) => setNotes(list))
      .catch((err) => setNotesError(readError(err, "No se pudieron cargar las notas")))
      .finally(() => setNotesLoading(false));
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manageAppt) return;
    const total = Number(amountTotal);
    const paid = payKind === "completed" ? total : Number(amountPaid);
    if (!Number.isFinite(total) || !Number.isFinite(paid)) {
      setManageError("Ingresa montos validos para total y adelanto.");
      return;
    }
    if (total < 0 || paid < 0) {
      setManageError("Los montos no pueden ser negativos.");
      return;
    }
    if (payKind === "partial" && paid > total) {
      setManageError("El adelanto no puede exceder el total.");
      return;
    }
    setPaymentSaving(true);
    setManageError("");
    setManageSuccess("");
    try {
      const updated = await dataService.updatePayment(manageAppt.id, {
        amount_total: total,
        amount_paid: paid,
        currency: currency.trim() || undefined,
      });
      setPaymentStatus(updated.payment_status);
      if (updated.amount_total != null) setAmountTotal(String(updated.amount_total));
      if (updated.amount_paid != null) setAmountPaid(String(updated.amount_paid));
      if (updated.currency) setCurrency(updated.currency);
      setManageAppt((prev) =>
        prev
          ? {
              ...prev,
              payment_status: updated.payment_status,
              amount_total: updated.amount_total,
              amount_paid: updated.amount_paid,
              currency: updated.currency,
            }
          : prev
      );
      setManageSuccess("Pago actualizado.");
      load();
    } catch (err: any) {
      if (err?.response?.data?.error?.code === "VALIDATION_ERROR") {
        setManageError("El adelanto no puede exceder el total.");
      } else {
        setManageError(readError(err, "No se pudo guardar el pago"));
      }
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsAppt) return;
    const body = newNote.trim();
    if (!body) {
      setNotesError("Escribe una nota antes de agregarla.");
      return;
    }
    setNoteSaving(true);
    setNotesError("");
    try {
      const created = await dataService.addNote(detailsAppt.id, body);
      setNotes((prev) => [created, ...prev]);
      setNewNote("");
      setShowNoteForm(false);
    } catch (err) {
      setNotesError(readError(err, "No se pudo agregar la nota"));
    } finally {
      setNoteSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!detailsAppt) return;
    try {
      await dataService.deleteNote(detailsAppt.id, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      setNotesError(readError(err, "No se pudo eliminar la nota"));
    }
  };

  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manageAppt || !rescheduleStart) {
      setManageError("La fecha y hora son obligatorias.");
      return;
    }
    setRescheduleSaving(true);
    setManageError("");
    setManageSuccess("");
    try {
      await dataService.updateAppointment(manageAppt.id, {
        start_time: new Date(rescheduleStart).toISOString(),
        service_id: rescheduleService || undefined,
        modality: rescheduleModality,
        video_call_url: rescheduleModality === "online" ? manageVideoUrl.trim() || undefined : "",
      });
      setManageSuccess("Cita reprogramada.");
      setManageOpen(false);
      load();
    } catch (err: any) {
      setManageError(mapVideoUrlError(err, mapBookingError(err, "No se pudo reprogramar la cita")));
    } finally {
      setRescheduleSaving(false);
    }
  };

  const handleSavePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manageAppt) return;
    if (!phone.trim()) {
      setManageError("Ingresa un telefono valido.");
      return;
    }
    setPhoneSaving(true);
    setManageError("");
    setManageSuccess("");
    try {
      const updated = await dataService.updateCustomerPhone(manageAppt.id, phone.trim());
      // Refleja el nuevo telefono en la cita en memoria para poder reintentar WhatsApp.
      setManageAppt((prev) =>
        prev
          ? { ...prev, customer: { ...(prev.customer as Customer), phone: phone.trim() } }
          : prev
      );
      void updated;
      setManageSuccess("Telefono actualizado. Ya puedes enviar el recordatorio.");
      setShowPhoneEdit(false);
      load();
    } catch (err) {
      setManageError(readError(err, "No se pudo actualizar el telefono"));
    } finally {
      setPhoneSaving(false);
    }
  };

  // Accion rapida de recordatorio desde la fila: un clic si hay telefono.
  // Si falta el telefono (409 PHONE_REQUIRED), abre Gestionar enfocado en editar telefono.
  const [quickWaId, setQuickWaId] = useState<string | null>(null);
  const quickWhatsapp = async (a: Appointment) => {
    setQuickWaId(a.id);
    setError("");
    try {
      const reminder = await dataService.getWhatsappReminder(a.id);
      window.open(reminder.url, "_blank");
    } catch (err: any) {
      if (err?.response?.data?.error?.code === "PHONE_REQUIRED") {
        // Abre el modal avanzado con la edicion de telefono ya visible.
        await openManage(a);
        setShowPhoneEdit(true);
        setManageError("El cliente no tiene telefono; agregalo para enviar el recordatorio.");
      } else {
        setError(readError(err, "No se pudo generar el recordatorio de WhatsApp"));
      }
    } finally {
      setQuickWaId(null);
    }
  };

  const handleWhatsapp = async () => {
    if (!manageAppt) return;
    setWaLoading(true);
    setManageError("");
    setManageSuccess("");
    try {
      const reminder = await dataService.getWhatsappReminder(manageAppt.id);
      window.open(reminder.url, "_blank");
      setManageSuccess("Abrimos WhatsApp con el mensaje listo para enviar.");
    } catch (err: any) {
      if (err?.response?.data?.error?.code === "PHONE_REQUIRED") {
        setShowPhoneEdit(true);
        setManageError("El cliente no tiene telefono; agregalo para enviar el recordatorio.");
      } else {
        setManageError(readError(err, "No se pudo generar el recordatorio de WhatsApp"));
      }
    } finally {
      setWaLoading(false);
    }
  };

  // Tarjeta compacta y CLICABLE: muestra un resumen y abre el modal de detalles.
  const renderCard = (a: Appointment) => (
    <button
      key={a.id}
      type="button"
      style={styles.cardItem}
      onClick={() => openDetails(a)}
      title="Ver detalles de la cita"
    >
      <div style={styles.cardTime}>{formatTimeOrDate(a.start_time)}</div>
      <div style={styles.cardCustomer}>{a.customer_name || a.customer?.name || a.customer_id}</div>
      <div style={styles.cardService}>{a.service_name || a.service?.name || a.service_id}</div>
      {branchName(a.branch_id) && <div style={styles.cardBranch}>🏢 {branchName(a.branch_id)}</div>}
      <div style={styles.cardBadges}>
        <span style={badge(STATUS_BADGE[a.status])}>{STATUS_LABELS[a.status]}</span>
        {a.payment_status && (
          <span style={badge(PAYMENT_BADGE[a.payment_status])}>{PAYMENT_LABELS[a.payment_status]}</span>
        )}
      </div>
    </button>
  );

  return (
    <div>
      <div style={styles.headerRow}>
        <h1 style={pageTitle}>Citas</h1>
        <button style={btn("primary")} onClick={openCreate}>
          + Agendar cita
        </button>
      </div>

      <div style={styles.filterRow}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel} htmlFor="appt-filter-branch">Sucursal</label>
          <select
            id="appt-filter-branch"
            style={styles.select}
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value={ALL_BRANCHES}>Todas</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.status !== "active" ? " (inactiva)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel} htmlFor="appt-filter-status">Estado</label>
          <select
            id="appt-filter-status"
            style={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | "")}
          >
            <option value="">Todos</option>
            {(Object.keys(STATUS_LABELS) as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel} htmlFor="appt-filter-from">Desde</label>
          <input
            id="appt-filter-from"
            type="date"
            style={styles.dateInput}
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel} htmlFor="appt-filter-to">Hasta</label>
          <input
            id="appt-filter-to"
            type="date"
            style={styles.dateInput}
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        {(statusFilter || dateFrom || dateTo || branchFilter !== ALL_BRANCHES) && (
          <button
            style={smallBtn("ghost")}
            onClick={() => {
              setStatusFilter("");
              setDateFrom("");
              setDateTo("");
              setBranchFilter(ALL_BRANCHES);
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Aviso informativo para cuentas free: el backend ya recorta las citas. */}
      {apiPremium === false && (
        <div style={styles.freeBanner} role="note">
          <span aria-hidden style={{ fontSize: 18 }}>💡</span>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text)" }}>
            Estás viendo las citas de los últimos 7 días y el día de mañana. Hazte premium para ver todo tu
            historial, reportes y gráficas.
          </p>
        </div>
      )}

      {/* Herramientas premium: reporte CSV + comportamiento por mes. */}
      {effectivePremium && (
        <div style={styles.premiumTools}>
          <div style={styles.reportRow}>
            <button
              type="button"
              style={btn("secondary")}
              onClick={handleDownloadReport}
              disabled={reportLoading}
            >
              {reportLoading ? "Generando..." : "⬇ Descargar reporte (CSV)"}
            </button>
            {reportError && (
              <span style={{ color: "var(--danger)", fontSize: 13 }} role="alert">
                {reportError}
              </span>
            )}
          </div>

          <section style={{ ...card, padding: 16 }} aria-labelledby="stats-title">
            <h2 id="stats-title" style={styles.statsTitle}>
              Comportamiento por mes
            </h2>
            {statsLoading ? (
              <div style={styles.loading} role="status" aria-live="polite">
                <Spinner /> Cargando estadísticas...
              </div>
            ) : statsError ? (
              <div role="alert">
                <p style={{ color: "var(--danger)", marginBottom: 12 }}>{statsError}</p>
                <button type="button" style={btn("secondary")} onClick={loadStats}>
                  Reintentar
                </button>
              </div>
            ) : stats.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
                Aún no hay datos suficientes para mostrar la gráfica.
              </p>
            ) : (
              <>
                <BarChart data={statsToBars(stats)} orientation="vertical" height={240} />
                <table style={{ ...table, marginTop: 16 }}>
                  <thead>
                    <tr>
                      <th style={th}>Mes</th>
                      <th style={th}>Total</th>
                      <th style={th}>Ingresos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr key={s.month}>
                        <td style={td}>{formatMonth(s.month)}</td>
                        <td style={td}>{s.total}</td>
                        <td style={td}>${Number(s.income ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </div>
      )}

      {loading && (
        <div style={styles.loading} role="status" aria-live="polite">
          <Spinner /> Cargando...
        </div>
      )}
      {error && (
        <div style={styles.errorBox} role="alert" aria-live="assertive">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>
            Reintentar
          </button>
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📅</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>No hay citas</p>
          <p>Agenda tu primera cita para verla aqui.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={styles.board}>
          <ApptSection
            title="Hoy"
            icon="📌"
            tone="info"
            items={groups.today}
            emptyNote="No tienes citas para hoy."
            renderItem={renderCard}
          />
          {isPremium ? (
            <>
              <ApptSection
                title="Proximas"
                icon="🔜"
                tone="success"
                items={groups.upcoming}
                emptyNote="No hay citas proximas."
                renderItem={renderCard}
              />
              <ApptSection
                title="Pasadas"
                icon="🕓"
                tone="muted"
                items={groups.past}
                emptyNote="Sin citas pasadas."
                renderItem={renderCard}
              />
            </>
          ) : (
            // Free: ocultamos Proximas/Pasadas y mostramos una tarjeta discreta.
            <section style={styles.column}>
              <div style={styles.columnHeader}>
                <h2 style={styles.sectionH2}>
                  <span aria-hidden>🔒</span> Proximas y pasadas
                </h2>
                <span style={badge("warning")}>Solo premium</span>
              </div>
              <div style={{ ...card, ...styles.premiumLockCard }}>
                <p style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>
                  Ver proximas y pasadas es solo para premium
                </p>
                <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
                  Con premium veras tu agenda completa. Por ahora, aqui estan tus citas de hoy.
                </p>
              </div>
            </section>
          )}
        </div>
      )}

      <Modal open={modalOpen} title="Agendar cita" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit}>
          {formError && <div style={styles.formError} role="alert">{formError}</div>}
          <div style={field}>
            <label htmlFor="appt-customer">Cliente *</label>
            <select
              id="appt-customer"
              value={form.customer_id}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
              required
            >
              <option value="">Selecciona un cliente</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </div>

          <div style={field}>
            <label htmlFor="appt-service">Servicio *</label>
            <select
              id="appt-service"
              value={form.service_id}
              onChange={(e) => setForm({ ...form, service_id: e.target.value })}
              required
            >
              <option value="">Selecciona un servicio</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration_mins} min - ${s.price})
                </option>
              ))}
            </select>
          </div>

          <div style={field}>
            <label htmlFor="appt-start">Fecha y hora *</label>
            <input
              id="appt-start"
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              required
            />
          </div>

          <ModalitySelector
            value={form.modality}
            onChange={(m) => setForm({ ...form, modality: m })}
          />

          {form.modality === "online" && (
            <div style={field}>
              <label htmlFor="appt-video-url">URL de videollamada (Meet, Zoom, Teams...)</label>
              <input
                id="appt-video-url"
                type="text"
                placeholder="https://..."
                value={form.video_call_url}
                onChange={(e) => setForm({ ...form, video_call_url: e.target.value })}
              />
            </div>
          )}

          {occupancy && <OccupancyPanel occupancy={occupancy} />}

          <div style={field}>
            <label htmlFor="appt-notes">Notas</label>
            <textarea
              id="appt-notes"
              style={{ minHeight: 64, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div style={styles.formActions}>
            <button type="button" style={btn("secondary")} onClick={() => setModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" style={btn("primary")} disabled={saving}>
              {saving ? "Agendando..." : "Agendar"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={detailsOpen}
        title="Detalle de la cita"
        onClose={() => setDetailsOpen(false)}
        headerAction={
          detailsAppt &&
          localDayKey(detailsAppt.start_time) >= todayKey &&
          detailsAppt.status !== "CANCELLED" ? (
            <button
              type="button"
              style={styles.headerIconBtn}
              title="Gestionar cita"
              aria-label="Gestionar cita"
              onClick={() => {
                const a = detailsAppt;
                setDetailsOpen(false);
                openManage(a);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          ) : undefined
        }
      >
        {detailsAppt && (
          <div>
            <div style={styles.detailHeader}>
              <div style={styles.detailName}>
                {detailsAppt.customer_name || detailsAppt.customer?.name || detailsAppt.customer_id}
              </div>
              <div style={styles.detailBadges}>
                <span style={badge(STATUS_BADGE[detailsAppt.status])}>{STATUS_LABELS[detailsAppt.status]}</span>
                {detailsAppt.payment_status && (
                  <span style={badge(PAYMENT_BADGE[detailsAppt.payment_status])}>
                    {PAYMENT_LABELS[detailsAppt.payment_status]}
                  </span>
                )}
              </div>
            </div>

            <dl style={styles.detailList}>
              <div style={styles.detailRow}>
                <dt style={styles.detailKey}>Servicio</dt>
                <dd style={styles.detailVal}>{detailsAppt.service_name || detailsAppt.service?.name || detailsAppt.service_id}</dd>
              </div>
              <div style={styles.detailRow}>
                <dt style={styles.detailKey}>Fecha y hora</dt>
                <dd style={styles.detailVal}>{formatDate(detailsAppt.start_time)}</dd>
              </div>
              <div style={styles.detailRow}>
                <dt style={styles.detailKey}>Modalidad</dt>
                <dd style={styles.detailVal}>{detailsAppt.modality === "online" ? "En linea" : "Presencial"}</dd>
              </div>
              {detailsAppt.video_call_url && (
                <div style={styles.detailRow}>
                  <dt style={styles.detailKey}>Videollamada</dt>
                  <dd style={styles.detailVal}>
                    <a
                      href={detailsAppt.video_call_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--brand)", fontWeight: 600 }}
                    >
                      🎥 Google Meet
                    </a>
                  </dd>
                </div>
              )}
              {branchName(detailsAppt.branch_id) && (
                <div style={styles.detailRow}>
                  <dt style={styles.detailKey}>Sucursal</dt>
                  <dd style={styles.detailVal}>{branchName(detailsAppt.branch_id)}</dd>
                </div>
              )}
              {detailsAppt.customer?.phone && detailsAppt.customer.phone !== "sin-telefono" && (
                <div style={styles.detailRow}>
                  <dt style={styles.detailKey}>Telefono</dt>
                  <dd style={styles.detailVal}>{detailsAppt.customer.phone}</dd>
                </div>
              )}
              {(detailsAppt.amount_total != null || detailsAppt.amount_paid != null) && (
                <div style={styles.detailRow}>
                  <dt style={styles.detailKey}>Pago</dt>
                  <dd style={styles.detailVal}>
                    {(detailsAppt.currency || "MXN")} {Number(detailsAppt.amount_paid ?? 0).toFixed(2)} / {Number(detailsAppt.amount_total ?? 0).toFixed(2)}
                  </dd>
                </div>
              )}
              <div style={styles.detailRow}>
                <dt style={styles.detailKey}>Agendo</dt>
                <dd style={styles.detailVal}>{formatBookedBy(detailsAppt)}</dd>
              </div>
              {detailsAppt.notes && (
                <div style={styles.detailRow}>
                  <dt style={styles.detailKey}>Notas</dt>
                  <dd style={styles.detailVal}>{detailsAppt.notes}</dd>
                </div>
              )}
            </dl>

            {/* Notas internas (bitacora) */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Notas internas</div>
              <p style={styles.sectionHint}>Notas internas, solo visibles para el negocio.</p>

              {notesError && <div style={styles.formError} role="alert">{notesError}</div>}

              {!showNoteForm ? (
                <button
                  type="button"
                  style={smallBtn("secondary")}
                  onClick={() => {
                    setShowNoteForm(true);
                    setNotesError("");
                  }}
                >
                  ＋ Agregar nota
                </button>
              ) : (
                <form onSubmit={handleAddNote}>
                  <div style={field}>
                    <textarea
                      autoFocus
                      aria-label="Nota interna"
                      style={{ minHeight: 64, resize: "vertical" }}
                      placeholder="Escribe una nota interna..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                    />
                  </div>
                  <div style={styles.formActions}>
                    <button
                      type="button"
                      style={btn("secondary")}
                      onClick={() => {
                        setShowNoteForm(false);
                        setNewNote("");
                        setNotesError("");
                      }}
                    >
                      Cancelar
                    </button>
                    <button type="submit" style={btn("primary")} disabled={noteSaving}>
                      {noteSaving ? "Agregando..." : "Agregar"}
                    </button>
                  </div>
                </form>
              )}

              {notesLoading ? (
                <div style={styles.loading}>
                  <Spinner /> Cargando notas...
                </div>
              ) : notes.length === 0 ? (
                <p style={styles.notesEmpty}>Sin notas</p>
              ) : (
                <div style={styles.notesList}>
                  {notes.map((n) => (
                    <div key={n.id} style={styles.noteItem}>
                      <div style={{ flex: 1 }}>
                        <div style={styles.noteBody}>{n.body}</div>
                        <div style={styles.noteDate}>{formatDate(n.created_at)}</div>
                      </div>
                      <button
                        type="button"
                        style={styles.noteDelete}
                        aria-label="Eliminar nota"
                        title="Eliminar nota"
                        onClick={() => handleDeleteNote(n.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {localDayKey(detailsAppt.start_time) < todayKey ? (
              // Cita PASADA: la unica accion disponible es archivar.
              <div style={styles.detailActions}>
                <button style={smallBtn("secondary")} onClick={() => { const a = detailsAppt; handleArchive(a); }}>
                  📦 Archivar
                </button>
              </div>
            ) : (
              detailsAppt.status !== "CANCELLED" && (
                <div style={styles.detailActions}>
                  {detailsAppt.status === "PENDING" && (
                    <button style={smallBtn("secondary")} onClick={() => { const a = detailsAppt; setDetailsOpen(false); changeStatus(a, "CONFIRMED"); }}>
                      ✓ Confirmar
                    </button>
                  )}
                  <button
                    style={smallBtn("primary")}
                    disabled={quickWaId === detailsAppt.id}
                    onClick={() => quickWhatsapp(detailsAppt)}
                  >
                    {quickWaId === detailsAppt.id ? "Abriendo..." : "💬 WhatsApp"}
                  </button>
                  {(detailsAppt.status === "PENDING" || detailsAppt.status === "CONFIRMED") && (
                    <>
                      <button style={smallBtn("secondary")} onClick={() => { const a = detailsAppt; setDetailsOpen(false); changeStatus(a, "COMPLETED"); }}>
                        ✔ Completar
                      </button>
                      <button style={smallBtn("secondary")} onClick={() => { const a = detailsAppt; setDetailsOpen(false); changeStatus(a, "NO_SHOW"); }}>
                        ✕ No asistio
                      </button>
                      <button style={dangerGhost} onClick={() => { const a = detailsAppt; setDetailsOpen(false); cancel(a); }}>
                        🗑 Cancelar
                      </button>
                    </>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </Modal>

      <Modal open={manageOpen} title="Gestionar cita" onClose={() => setManageOpen(false)}>
        {manageAppt && (
          <div>
            <div style={styles.manageHead}>
              <strong>{manageAppt.customer_name || manageAppt.customer?.name || manageAppt.customer_id}</strong>
              <span style={styles.itemMuted}> - {manageAppt.service_name || manageAppt.service?.name}</span>
              <div style={styles.itemSub}>{formatDate(manageAppt.start_time)}</div>
            </div>

            {manageError && <div style={styles.formError} role="alert">{manageError}</div>}
            {manageSuccess && <div style={styles.formSuccess} role="status" aria-live="polite">{manageSuccess}</div>}

            {/* Recordatorio WhatsApp */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Recordatorio por WhatsApp</div>
              <p style={styles.sectionHint}>
                Abriremos WhatsApp con un mensaje prellenado hacia el telefono del cliente.
              </p>
              <button type="button" style={btn("primary")} onClick={handleWhatsapp} disabled={waLoading}>
                {waLoading ? "Generando..." : "Recordatorio WhatsApp"}
              </button>
              {!showPhoneEdit && (
                <button
                  type="button"
                  style={{ ...smallBtn("ghost"), marginLeft: 8 }}
                  onClick={() => {
                    setShowPhoneEdit(true);
                    setManageError("");
                    setManageSuccess("");
                  }}
                >
                  Editar telefono
                </button>
              )}
            </div>

            {/* Editar telefono del cliente */}
            {showPhoneEdit && (
              <form onSubmit={handleSavePhone} style={styles.section}>
                <label htmlFor="manage-phone" style={styles.sectionTitle}>Telefono del cliente</label>
                <div style={field}>
                  <input
                    id="manage-phone"
                    type="tel"
                    placeholder="+52 55 1234 5678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" style={btn("primary")} disabled={phoneSaving}>
                    {phoneSaving ? "Guardando..." : "Guardar telefono"}
                  </button>
                  <button type="button" style={btn("secondary")} onClick={() => setShowPhoneEdit(false)}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {/* Pago manual */}
            <form onSubmit={handleSavePayment} style={styles.section}>
              <div style={styles.sectionTitleRow}>
                <span style={styles.sectionTitle}>Pago</span>
                {paymentStatus && (
                  <span style={badge(PAYMENT_BADGE[paymentStatus])}>{PAYMENT_LABELS[paymentStatus]}</span>
                )}
              </div>
              <div style={{ ...field, marginBottom: 12 }}>
                <div style={styles.segment} role="group" aria-label="Tipo de pago">
                  {([
                    { key: "completed" as const, label: "Pago completado" },
                    { key: "partial" as const, label: "Pago parcial" },
                  ]).map((opt) => {
                    const active = payKind === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPayKind(opt.key)}
                        style={{ ...styles.segmentBtn, ...(active ? styles.segmentBtnActive : null) }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={styles.payRow}>
                <div style={{ ...field, flex: 1, marginBottom: 0 }}>
                  <label htmlFor="pay-total">Total</label>
                  <input
                    id="pay-total"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amountTotal}
                    onChange={(e) => setAmountTotal(e.target.value)}
                  />
                </div>
                {payKind === "partial" && (
                  <div style={{ ...field, flex: 1, marginBottom: 0 }}>
                    <label htmlFor="pay-advance">Adelanto</label>
                    <input
                      id="pay-advance"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                    />
                  </div>
                )}
                <div style={{ ...field, width: 90, marginBottom: 0 }}>
                  <label htmlFor="pay-currency">Moneda</label>
                  <input
                    id="pay-currency"
                    type="text"
                    maxLength={3}
                    placeholder="MXN"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  />
                </div>
              </div>
              {payKind === "partial" && (
                <p style={styles.payRemaining}>
                  Faltante: {currency || "MXN"}{" "}
                  {Math.max(
                    0,
                    (Number.isFinite(Number(amountTotal)) ? Number(amountTotal) : 0) -
                      (Number.isFinite(Number(amountPaid)) ? Number(amountPaid) : 0)
                  ).toFixed(2)}
                </p>
              )}
              <div style={{ ...styles.formActions, marginTop: 12 }}>
                <button type="submit" style={btn("primary")} disabled={paymentSaving}>
                  {paymentSaving ? "Guardando..." : "Guardar pago"}
                </button>
              </div>
            </form>

            {/* Reprogramar */}
            <form onSubmit={handleReschedule} style={styles.section}>
              <div style={styles.sectionTitle}>Reprogramar</div>
              <div style={field}>
                <label htmlFor="reschedule-start">Fecha y hora</label>
                <input
                  id="reschedule-start"
                  type="datetime-local"
                  value={rescheduleStart}
                  onChange={(e) => setRescheduleStart(e.target.value)}
                  required
                />
              </div>
              <div style={field}>
                <label htmlFor="reschedule-service">Servicio</label>
                <select id="reschedule-service" value={rescheduleService} onChange={(e) => setRescheduleService(e.target.value)}>
                  {manageServices.length === 0 && (
                    <option value={manageAppt.service_id}>
                      {manageAppt.service_name || manageAppt.service?.name || "Servicio actual"}
                    </option>
                  )}
                  {manageServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration_mins} min - ${s.price})
                    </option>
                  ))}
                </select>
              </div>
              <ModalitySelector
                value={rescheduleModality}
                onChange={setRescheduleModality}
              />
              {rescheduleModality === "online" && (
                <div style={field}>
                  <label htmlFor="reschedule-video-url">URL de videollamada (Meet, Zoom, Teams...)</label>
                  <input
                    id="reschedule-video-url"
                    type="text"
                    placeholder="https://..."
                    value={manageVideoUrl}
                    onChange={(e) => setManageVideoUrl(e.target.value)}
                  />
                </div>
              )}
              <div style={styles.formActions}>
                <button type="button" style={btn("secondary")} onClick={() => setManageOpen(false)}>
                  Cerrar
                </button>
                <button type="submit" style={btn("primary")} disabled={rescheduleSaving}>
                  {rescheduleSaving ? "Reprogramando..." : "Reprogramar"}
                </button>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* Panel "En espera" + "Espacios en riesgo (12h)" (solo emprendedor). */}
      {isAdmin && <WaitlistPanel services={services} />}

      {/* Modal de reasignacion tras cancelar (si hay cliente en espera). */}
      {reassign && (
        <WaitlistReassignModal
          open={!!reassign}
          onClose={() => setReassign(null)}
          entry={reassign.entry}
          slotStart={reassign.slotStart}
          slotEnd={reassign.slotEnd}
          branchId={reassign.branchId}
          customerName={reassign.customerName}
        />
      )}
    </div>
  );
}

// Columna del tablero (Hoy / Proximas / Pasadas) con encabezado fijo + contador.
function ApptSection({
  title,
  icon,
  tone,
  items,
  emptyNote,
  renderItem,
}: {
  title: string;
  icon: string;
  tone: "success" | "warning" | "danger" | "info" | "muted";
  items: Appointment[];
  emptyNote: string;
  renderItem: (a: Appointment) => ReactElement;
}) {
  return (
    <section style={styles.column}>
      <div style={styles.columnHeader}>
        <h2 style={styles.sectionH2}>
          <span aria-hidden>{icon}</span> {title}
        </h2>
        <span style={badge(tone)}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p style={styles.sectionEmpty}>{emptyNote}</p>
      ) : (
        <div style={styles.columnList}>{items.map(renderItem)}</div>
      )}
    </section>
  );
}

// Panel de ocupacion del dia: color + TEXTO para accesibilidad (no solo color).
function OccupancyPanel({
  occupancy,
}: {
  occupancy: { capacity: number; serviceName: string; slots: { label: string; used: number; capacity: number; selected: boolean }[] };
}) {
  return (
    <div style={styles.occPanel}>
      <div style={styles.occTitle}>
        Ocupacion del dia · {occupancy.serviceName}
        {occupancy.capacity > 1 ? ` (aforo ${occupancy.capacity})` : ""}
      </div>
      <div style={styles.occGrid}>
        {occupancy.slots.map((s, i) => {
          const full = s.used >= s.capacity;
          const partial = s.used > 0 && !full;
          // Verde=Libre, ambar=parcial (usado/total), rojo=Lleno. Siempre con texto.
          const tone: "success" | "warning" | "danger" = full ? "danger" : partial ? "warning" : "success";
          const text =
            s.capacity > 1
              ? full
                ? `Lleno ${s.used}/${s.capacity}`
                : `${s.used}/${s.capacity}`
              : full
              ? "Lleno"
              : "Libre";
          return (
            <div
              key={i}
              style={{
                ...styles.occSlot,
                ...(s.selected ? styles.occSlotSelected : null),
              }}
              title={`${s.label} — ${text}`}
            >
              <span style={styles.occTime}>{s.label}</span>
              <span style={{ ...badge(tone), fontSize: 11 }}>{text}</span>
            </div>
          );
        })}
      </div>
      <p style={styles.occHint}>Verde: libre · Ambar: parcial · Rojo: lleno. Ayuda para elegir un horario.</p>
    </div>
  );
}

// Selector segmentado Presencial / En linea.
// Sin gating: ambas opciones estan siempre disponibles.
function ModalitySelector({
  value,
  onChange,
}: {
  value: "in_person" | "online";
  onChange: (m: "in_person" | "online") => void;
}) {
  const options: { key: "in_person" | "online"; label: string }[] = [
    { key: "in_person", label: "Presencial" },
    { key: "online", label: "En linea" },
  ];
  return (
    <div style={field}>
      <label>Modalidad</label>
      <div style={styles.segment} role="group" aria-label="Modalidad de la cita">
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.key)}
              style={{ ...styles.segmentBtn, ...(active ? styles.segmentBtnActive : null) }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatBookedBy(a: Appointment): string {
  const name = a.booked_by_name?.trim();
  const email = a.booked_by_email?.trim();
  if (name && email) return `Agendo: ${name} (${email})`;
  if (name) return `Agendo: ${name}`;
  if (email) return `Agendo: ${email}`;
  return "Agendada por el negocio";
}

// En columnas: muestra solo la hora para HOY, y fecha corta + hora para el resto.
function formatTimeOrDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-ES");
}

// Convierte un ISO a valor para <input type="datetime-local"> en hora local.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

// Convierte 'YYYY-MM' a una etiqueta corta legible en espanol (p. ej. "ene 2025").
function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const d = new Date(y, m - 1, 1);
  if (isNaN(d.getTime())) return month;
  return d.toLocaleDateString("es-ES", { month: "short", year: "numeric" });
}

// Mapea las estadisticas mensuales a barras (total de citas por mes) para BarChart.
function statsToBars(stats: MonthlyStat[]): BarDatum[] {
  return stats.map((s) => ({ label: formatMonth(s.month), value: s.total }));
}

const styles: Record<string, CSSProperties> = {
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  filterRow: { display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 20, flexWrap: "wrap" },
  filterGroup: { display: "flex", flexDirection: "column", gap: 4 },
  filterLabel: { fontSize: 13, color: "var(--text-muted)", fontWeight: 600 },
  select: { width: "auto", minWidth: 180 },
  dateInput: { width: "auto", minWidth: 150 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  errorBox: {},
  freeBanner: {
    ...card,
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    marginBottom: 16,
    background: "var(--info-soft)",
    borderColor: "var(--info)",
  },
  premiumTools: { display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 },
  reportRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  statsTitle: { fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 12px" },
  // Tablero de 3 columnas (Hoy | Proximas | Pasadas). En pantallas chicas se apila.
  board: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
    alignItems: "start",
  },
  column: {
    ...card,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "var(--surface-hover)",
    maxHeight: "calc(100vh - 220px)",
  },
  columnHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    position: "sticky",
    top: 0,
  },
  columnList: { display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", paddingRight: 2 },
  // Tarjeta compacta clicable.
  cardItem: {
    ...card,
    textAlign: "left",
    cursor: "pointer",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    background: "var(--surface)",
    borderColor: "var(--border)",
  },
  cardTime: { fontSize: 13, fontWeight: 700, color: "var(--brand)" },
  cardCustomer: { fontSize: 15, fontWeight: 700, color: "var(--text)" },
  cardService: { fontSize: 13, color: "var(--text-muted)" },
  cardBranch: { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 },
  cardBadges: { display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" },
  // Modal de detalles.
  detailHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  detailName: { fontSize: 18, fontWeight: 700, color: "var(--text)" },
  detailBadges: { display: "flex", gap: 6, flexWrap: "wrap" },
  detailList: { display: "flex", flexDirection: "column", gap: 0, margin: 0 },
  detailRow: { display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" },
  detailKey: { flex: "0 0 110px", fontSize: 13, fontWeight: 700, color: "var(--text-muted)", margin: 0 },
  detailVal: { flex: 1, fontSize: 14, color: "var(--text)", margin: 0, wordBreak: "break-word" },
  detailActions: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 },
  headerIconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: "var(--radius-sm)",
    color: "var(--text-muted)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    transition: "background-color 0.15s ease, color 0.15s ease",
  },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  sections: { display: "flex", flexDirection: "column", gap: 28 },
  section2: { display: "flex", flexDirection: "column", gap: 12 },
  sectionHeader: { display: "flex", alignItems: "center", gap: 10 },
  sectionH2: { fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0, display: "flex", alignItems: "center", gap: 8 },
  sectionEmpty: { fontSize: 14, color: "var(--text-muted)", fontStyle: "italic", margin: 0, padding: "4px 2px" },
  premiumLockCard: { padding: 16, background: "var(--surface-hover)" },
  occPanel: { ...card, padding: 14, marginBottom: 14, background: "var(--surface-hover)" },
  occTitle: { fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 },
  occGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 },
  occSlot: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 6px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)" },
  occSlotSelected: { borderColor: "var(--brand)", boxShadow: "0 0 0 2px var(--brand)" },
  occTime: { fontSize: 12, fontWeight: 600, color: "var(--text)" },
  occHint: { fontSize: 12, color: "var(--text-muted)", marginTop: 10, marginBottom: 0 },
  item: { padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  itemTitle: { color: "var(--text)", fontSize: 15 },
  itemMuted: { color: "var(--text-muted)" },
  itemSub: { color: "var(--text-muted)", fontSize: 14, marginTop: 4 },
  branchTag: { color: "var(--text-muted)", fontSize: 13, marginTop: 4, fontWeight: 600 },
  bookedBy: { color: "var(--text-muted)", fontSize: 13, marginTop: 4, fontStyle: "italic" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formSuccess: { background: "var(--success-soft)", color: "var(--success)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  manageHead: { marginBottom: 16 },
  section: { paddingTop: 16, marginTop: 16, borderTop: "1px solid var(--border)" },
  sectionTitle: { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 8 },
  sectionTitleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  sectionHint: { fontSize: 13, color: "var(--text-subtle)", marginBottom: 12 },
  payRow: { display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" },
  payRemaining: { fontSize: 14, fontWeight: 700, color: "var(--text)", marginTop: 12, marginBottom: 0 },
  notesEmpty: { fontSize: 14, color: "var(--text-muted)", fontStyle: "italic", marginTop: 8 },
  notesList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 8 },
  noteItem: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: "var(--surface-hover)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" },
  noteBody: { fontSize: 14, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" },
  noteDate: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },
  noteDelete: { background: "transparent", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 4 },
  // Selector segmentado de modalidad (Presencial / En linea).
  segment: { display: "inline-flex", gap: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--surface)" },
  segmentBtn: { padding: "8px 16px", fontSize: 14, fontWeight: 600, background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" },
  segmentBtnActive: { background: "var(--brand)", color: "#fff" },
  segmentHint: { fontSize: 12, color: "var(--text-muted)", marginTop: 6, marginBottom: 0 },
};
