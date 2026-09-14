import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Modal } from "../components/Modal";
import BranchSelector from "../components/BranchSelector";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { dataService, type ServicePayload } from "../services/data.service";
import { branchService } from "../services/branch.service";
import { useBranchStore } from "../store/useBranchStore";
import { usePremium } from "../store/usePremium";
import { mapPremiumError } from "../lib/premium";
import type { Service } from "../types";
import { pageTitle, btn, badge, field, table, th, td, emptyState } from "../ui/ui";

interface FormState {
  name: string;
  description: string;
  duration_mins: string;
  price: string;
  color: string;
  capacity: string;
}

const emptyForm: FormState = { name: "", description: "", duration_mins: "60", price: "0", color: "#4f46e5", capacity: "1" };

const smallBtn = (variant: "secondary" | "ghost"): CSSProperties => ({
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

// Limite de categorias por tenant para free (el backend es la verdad; aqui es
// una aproximacion por sucursal para deshabilitar el boton proactivamente).
const FREE_SERVICE_LIMIT = 5;

export default function Services() {
  const { activeBranchId } = useBranchStore();
  // Plan premium del tenant (best-effort, cacheado).
  const { isPremium } = usePremium();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    if (!activeBranchId) {
      setServices([]);
      return;
    }
    setLoading(true);
    setError("");
    branchService
      .listServices(activeBranchId)
      .then((data) => setServices(data))
      .catch((err) => setError(readError(err, "Error al cargar categorias")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Categorias" });
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (s: Service) => {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description || "",
      duration_mins: String(s.duration_mins),
      price: String(s.price),
      color: s.color || "#4f46e5",
      capacity: String(s.capacity ?? 1),
    });
    setFormError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBranchId) {
      setFormError("Selecciona una sucursal activa.");
      return;
    }
    const duration = Number(form.duration_mins);
    const price = Number(form.price);
    const capacity = Number(form.capacity);
    if (!form.name.trim()) {
      setFormError("El nombre es obligatorio.");
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      setFormError("La duracion debe ser un numero mayor a 0.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setFormError("El precio debe ser un numero valido.");
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      setFormError("El cupo debe ser un numero entero mayor o igual a 1.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload: ServicePayload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      duration_mins: duration,
      price,
      color: form.color || undefined,
      capacity,
    };
    try {
      // Editar/eliminar por id sigue usando dataService; crear/listar es por sucursal.
      if (editing) await dataService.updateService(editing.id, payload);
      else await branchService.createService(activeBranchId, payload);
      setModalOpen(false);
      load();
    } catch (err) {
      // El backend limita a 5 categorias por tenant para free (403 PREMIUM_REQUIRED).
      setFormError(
        mapPremiumError(err, "Agregar mas de 5 categorias es solo para premium.", "No se pudo guardar la categoria")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: Service) => {
    if (!window.confirm(`Eliminar la categoria "${s.name}"?`)) return;
    setDeletingId(s.id);
    setError("");
    try {
      await dataService.deleteService(s.id);
      load();
    } catch (err) {
      setError(readError(err, "No se pudo eliminar la categoria"));
    } finally {
      setDeletingId(null);
    }
  };

  // Free con 5+ categorias (aprox. por sucursal): deshabilitamos crear y mostramos
  // "Solo premium". Con menos de 5, o siendo premium, se permite (el backend valida).
  const createBlocked = !isPremium && services.length >= FREE_SERVICE_LIMIT;

  return (
    <div>
      <div style={styles.headerRow}>
        <h1 style={pageTitle}>Categorias</h1>
        <div style={styles.headerAction}>
          {createBlocked && (
            <span style={badge("warning")} title="Agregar mas de 5 categorias es solo para premium.">
              Solo premium
            </span>
          )}
          <button
            style={createBlocked ? { ...btn("primary"), opacity: 0.6, cursor: "not-allowed" } : btn("primary")}
            onClick={openCreate}
            disabled={!activeBranchId || createBlocked}
            title={createBlocked ? "Agregar mas de 5 categorias es solo para premium." : undefined}
          >
            + Nueva categoria
          </button>
        </div>
      </div>

      <BranchSelector />

      {!activeBranchId && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🏢</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Selecciona una sucursal</p>
          <p>Elige una sucursal activa para configurar sus categorias.</p>
        </div>
      )}

      {activeBranchId && loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}
      {activeBranchId && error && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>
            Reintentar
          </button>
        </div>
      )}
      {activeBranchId && !loading && !error && services.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>💼</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin categorias</p>
          <p>Configura tu primera categoria para poder agendarla.</p>
        </div>
      )}

      {activeBranchId && !loading && !error && services.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Categoria</th>
                <th style={th}>Duracion</th>
                <th style={th}>Precio</th>
                <th style={th}>Cupo</th>
                <th style={{ ...th, textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ ...styles.dot, background: s.color || "var(--brand)" }} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                        {s.description && <div style={styles.notes}>{s.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={td}>{s.duration_mins} min</td>
                  <td style={td}>${s.price}</td>
                  <td style={td}>Cupo: {s.capacity ?? 1}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <div style={styles.actions}>
                      <button style={smallBtn("secondary")} onClick={() => openEdit(s)} disabled={deletingId === s.id}>
                        Editar
                      </button>
                      <button style={dangerGhost} onClick={() => handleDelete(s)} disabled={deletingId === s.id}>
                        {deletingId === s.id ? "Eliminando..." : "Eliminar"}
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
        title={editing ? "Editar categoria" : "Nueva categoria"}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {formError && <div style={styles.formError}>{formError}</div>}
          <div style={field}>
            <label htmlFor="svc-name">Nombre *</label>
            <input id="svc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={field}>
            <label htmlFor="svc-description">Descripcion</label>
            <textarea
              id="svc-description"
              style={{ minHeight: 64, resize: "vertical" }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div style={field}>
            <label htmlFor="svc-duration">Duracion (min) *</label>
            <input
              id="svc-duration"
              type="number"
              min={1}
              value={form.duration_mins}
              onChange={(e) => setForm({ ...form, duration_mins: e.target.value })}
              required
            />
          </div>
          <div style={field}>
            <label htmlFor="svc-price">Precio *</label>
            <input
              id="svc-price"
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
          </div>
          <div style={field}>
            <label htmlFor="svc-capacity">Cupo por horario *</label>
            <input
              id="svc-capacity"
              type="number"
              min={1}
              step={1}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              required
            />
            <span style={styles.hint}>Cuantas personas admite este servicio en el mismo horario (minimo 1).</span>
          </div>
          <div style={field}>
            <label htmlFor="svc-color">Color</label>
            <input
              id="svc-color"
              style={{ height: 44, padding: 4 }}
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </div>
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

const styles: Record<string, CSSProperties> = {
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  headerAction: { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  dot: { width: 14, height: 14, borderRadius: "50%", flexShrink: 0 },
  notes: { color: "var(--text-subtle)", fontSize: 13, marginTop: 3 },
  actions: { display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  hint: { fontSize: 12, color: "var(--text-subtle)" },
};
