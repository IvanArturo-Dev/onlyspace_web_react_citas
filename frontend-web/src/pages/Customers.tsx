import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Modal } from "../components/Modal";
import Spinner from "../components/Spinner";
import { dataService, type CustomerPayload, type CustomerBehavior } from "../services/data.service";
import {
  cancellationPolicyService,
  type CustomerCancellationState,
} from "../services/cancellationPolicy.service";
import { useAuthStore } from "../store/useAuthStore";
import type { Customer } from "../types";
import { pageTitle, btn, badge, field, table, th, td, emptyState } from "../ui/ui";

interface FormState {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

const emptyForm: FormState = { name: "", phone: "", email: "", notes: "" };

const smallBtn = (variant: "secondary" | "danger" | "ghost"): CSSProperties => ({
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

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  // Termino de busqueda con debounce (~300ms) para no saturar el backend mientras se escribe.
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  // Id del cliente que se esta eliminando, para dar feedback y evitar dobles clics.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Solo el emprendedor (ADMIN) puede confirmar el pago de una penalizacion.
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN");

  // Estado de cancelacion/deuda del cliente en edicion (se carga al abrir el modal).
  const [cancelState, setCancelState] = useState<CustomerCancellationState | null>(null);
  const [cancelStateLoading, setCancelStateLoading] = useState(false);
  const [cancelStateError, setCancelStateError] = useState("");
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [paymentMsg, setPaymentMsg] = useState("");

  // Comportamiento del cliente en edicion (asistio/cancelo/no asistio + at_risk).
  const [behavior, setBehavior] = useState<CustomerBehavior | null>(null);
  const [behaviorLoading, setBehaviorLoading] = useState(false);
  const [behaviorError, setBehaviorError] = useState("");
  // Bloqueo/desbloqueo del cliente (accion de ADMIN).
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState("");

  // Carga el listado consultando al backend con el termino de busqueda (name/email/phone, contains).
  const load = (term: string = debouncedSearch) => {
    setLoading(true);
    setError("");
    dataService
      .listCustomers(term.trim() || undefined)
      .then((data) => setCustomers(data))
      .catch((err) => setError(readError(err, "Error al cargar clientes")))
      .finally(() => setLoading(false));
  };

  // Debounce: espera ~300ms tras el ultimo tecleo antes de fijar el termino que dispara la carga.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Recarga desde el backend cuando cambia el termino con debounce.
  useEffect(() => {
    load(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  };

  const loadCancelState = (customerId: string) => {
    setCancelState(null);
    setCancelStateError("");
    setPaymentMsg("");
    setCancelStateLoading(true);
    cancellationPolicyService
      .getCustomerCancellationState(customerId)
      .then(setCancelState)
      .catch((err) => setCancelStateError(readError(err, "No se pudo cargar el estado de cancelaciones")))
      .finally(() => setCancelStateLoading(false));
  };

  const loadBehavior = (customerId: string) => {
    setBehavior(null);
    setBehaviorError("");
    setStatusError("");
    setBehaviorLoading(true);
    dataService
      .getCustomerBehavior(customerId)
      .then(setBehavior)
      .catch((err) => setBehaviorError(readError(err, "No se pudo cargar el comportamiento")))
      .finally(() => setBehaviorLoading(false));
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone, email: c.email || "", notes: c.notes || "" });
    setFormError("");
    setModalOpen(true);
    loadCancelState(c.id);
    loadBehavior(c.id);
  };

  const handleToggleStatus = async () => {
    if (!editing) return;
    const isBlocked = editing.status === "blocked";
    const next: "active" | "blocked" = isBlocked ? "active" : "blocked";
    const confirmMsg = isBlocked
      ? `¿Desbloquear al cliente "${editing.name}"? Podra volver a reservar.`
      : `¿Bloquear al cliente "${editing.name}"? No podra crear nuevas citas.`;
    if (!window.confirm(confirmMsg)) return;
    setStatusSaving(true);
    setStatusError("");
    try {
      const updated = await dataService.setCustomerStatus(editing.id, next);
      setEditing(updated);
      load();
    } catch (err) {
      setStatusError(readError(err, "No se pudo actualizar el estado del cliente"));
    } finally {
      setStatusSaving(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (!editing) return;
    setConfirmingPayment(true);
    setCancelStateError("");
    setPaymentMsg("");
    try {
      const updated = await cancellationPolicyService.confirmPenaltyPayment(editing.id);
      setCancelState(updated);
      setPaymentMsg("Pago confirmado. La deuda quedó en cero.");
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setCancelStateError("No tienes permisos para confirmar el pago.");
      } else {
        setCancelStateError(readError(err, "No se pudo confirmar el pago"));
      }
    } finally {
      setConfirmingPayment(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      setFormError("Nombre y telefono son obligatorios.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload: CustomerPayload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    try {
      if (editing) await dataService.updateCustomer(editing.id, payload);
      else await dataService.createCustomer(payload);
      setModalOpen(false);
      load();
    } catch (err) {
      setFormError(readError(err, "No se pudo guardar el cliente"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Customer) => {
    if (!window.confirm(`¿Eliminar al cliente "${c.name}"? Esta accion no se puede deshacer.`)) return;
    setDeletingId(c.id);
    setError("");
    try {
      await dataService.deleteCustomer(c.id);
      load();
    } catch (err) {
      setError(readError(err, "No se pudo eliminar el cliente"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div style={styles.headerRow}>
        <h1 style={pageTitle}>Clientes</h1>
        <button style={btn("primary")} onClick={openCreate}>
          + Nuevo cliente
        </button>
      </div>

      <input
        style={styles.search}
        type="search"
        placeholder="Buscar por nombre o correo"
        aria-label="Buscar clientes por nombre o correo"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}
      {error && (
        <div role="alert" aria-live="assertive">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={() => load()} style={btn("secondary")}>
            Reintentar
          </button>
        </div>
      )}
      {!loading && !error && customers.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>👥</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin clientes</p>
          <p>{debouncedSearch.trim() ? "No hay coincidencias con tu busqueda." : "Agrega tu primer cliente."}</p>
        </div>
      )}

      {!loading && !error && customers.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Nombre</th>
                <th style={th}>Telefono</th>
                <th style={th}>Email</th>
                <th style={{ ...th, textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {(c.status === "blocked" || c.at_risk) && (
                      <div style={styles.nameBadges}>
                        {c.status === "blocked" && <span style={badge("danger")}>Bloqueado</span>}
                        {c.at_risk && <span style={badge("warning")}>Riesgo inasistencia</span>}
                      </div>
                    )}
                    {c.notes && <div style={styles.notes}>{c.notes}</div>}
                  </td>
                  <td style={td}>{c.phone}</td>
                  <td style={td}>{c.email || <span style={{ color: "var(--text-subtle)" }}>-</span>}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <div style={styles.actions}>
                      <button
                        style={smallBtn("secondary")}
                        onClick={() => openEdit(c)}
                        disabled={deletingId === c.id}
                      >
                        Editar
                      </button>
                      <button
                        style={dangerGhost}
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.id}
                      >
                        {deletingId === c.id ? "Eliminando..." : "Eliminar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        title={editing ? "Editar cliente" : "Nuevo cliente"}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {formError && <div style={styles.formError} role="alert">{formError}</div>}
          <div style={field}>
            <label htmlFor="customer-name">Nombre *</label>
            <input id="customer-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={field}>
            <label htmlFor="customer-phone">Telefono *</label>
            <input id="customer-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          </div>
          <div style={field}>
            <label htmlFor="customer-email">Email</label>
            <input id="customer-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div style={field}>
            <label htmlFor="customer-notes">Notas</label>
            <textarea
              id="customer-notes"
              style={{ minHeight: 72, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {/* Estado de cancelaciones / deuda del cliente (solo al editar). */}
          {editing && (
            <div style={styles.debtBox}>
              <div style={styles.debtTitle}>Cancelaciones y deuda</div>
              {cancelStateLoading ? (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }} role="status" aria-live="polite">
                  Cargando estado...
                </p>
              ) : cancelStateError ? (
                <p style={{ color: "var(--danger)", fontSize: 14 }} role="alert">
                  {cancelStateError}
                </p>
              ) : cancelState ? (
                cancelState.debt_amount > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={badge("danger")}>Deuda: {formatMoney(cancelState.debt_amount)}</span>
                      <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                        Cancelaciones: {cancelState.count}
                      </span>
                    </div>
                    {cancelState.debt_reason && (
                      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                        {cancelState.debt_reason}
                      </p>
                    )}
                    {paymentMsg && (
                      <p style={{ color: "var(--success)", fontSize: 14, margin: 0 }} role="status" aria-live="polite">
                        {paymentMsg}
                      </p>
                    )}
                    {isAdmin && (
                      <div>
                        <button
                          type="button"
                          style={smallBtn("secondary")}
                          onClick={handleConfirmPayment}
                          disabled={confirmingPayment}
                        >
                          {confirmingPayment ? "Confirmando..." : "Confirmar pago"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={badge("success")}>Sin deuda</span>
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      Cancelaciones: {cancelState.count}
                    </span>
                    {paymentMsg && (
                      <span style={{ color: "var(--success)", fontSize: 13 }} role="status" aria-live="polite">
                        {paymentMsg}
                      </span>
                    )}
                  </div>
                )
              ) : null}
            </div>
          )}

          {/* Comportamiento del cliente (solo al editar): asistio/cancelo/no asistio + bloqueo. */}
          {editing && (
            <div style={styles.debtBox}>
              <div style={{ ...styles.debtTitle, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Comportamiento</span>
                {editing.status === "blocked" && <span style={badge("danger")}>Bloqueado</span>}
              </div>
              {behaviorLoading ? (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }} role="status" aria-live="polite">
                  Cargando comportamiento...
                </p>
              ) : behaviorError ? (
                <p style={{ color: "var(--danger)", fontSize: 14 }} role="alert">
                  {behaviorError}
                </p>
              ) : behavior ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={styles.behaviorRow}>
                    <div style={styles.behaviorStat}>
                      <span style={styles.behaviorNum}>{behavior.attended}</span>
                      <span style={styles.behaviorLabel}>Asistió</span>
                    </div>
                    <div style={styles.behaviorStat}>
                      <span style={styles.behaviorNum}>{behavior.cancelled}</span>
                      <span style={styles.behaviorLabel}>Canceló</span>
                    </div>
                    <div style={styles.behaviorStat}>
                      <span style={styles.behaviorNum}>{behavior.no_show}</span>
                      <span style={styles.behaviorLabel}>No asistió</span>
                    </div>
                  </div>
                  {behavior.at_risk && (
                    <div>
                      <span style={badge("warning")}>Riesgo de inasistencia</span>
                    </div>
                  )}
                </div>
              ) : null}

              {statusError && (
                <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 10, marginBottom: 0 }} role="alert">
                  {statusError}
                </p>
              )}

              {isAdmin && (
                <div style={{ marginTop: 12 }}>
                  {editing.status === "blocked" ? (
                    <button
                      type="button"
                      style={smallBtn("secondary")}
                      onClick={handleToggleStatus}
                      disabled={statusSaving}
                    >
                      {statusSaving ? "Guardando..." : "Desbloquear"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={smallBtn("danger")}
                      onClick={handleToggleStatus}
                      disabled={statusSaving}
                    >
                      {statusSaving ? "Guardando..." : "Bloquear cliente"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={styles.formActions}>
            <button type="button" style={btn("secondary")} onClick={() => setModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" style={btn("primary")} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

function formatMoney(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const styles: Record<string, CSSProperties> = {
  debtBox: {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-hover)",
    padding: 14,
    marginBottom: 14,
  },
  debtTitle: { fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 },
  behaviorRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  behaviorStat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    minWidth: 64,
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
  },
  behaviorNum: { fontSize: 18, fontWeight: 700, color: "var(--text)" },
  behaviorLabel: { fontSize: 12, color: "var(--text-muted)" },
  nameBadges: { display: "inline-flex", gap: 6, flexWrap: "wrap", marginTop: 4 },
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  search: { marginBottom: 20 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  notes: { color: "var(--text-subtle)", fontSize: 13, marginTop: 3 },
  actions: { display: "inline-flex", gap: 8, justifyContent: "flex-end" },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
};
