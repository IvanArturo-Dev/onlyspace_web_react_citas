import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Modal } from "../components/Modal";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { promotionService, type Promotion, type PromotionInput } from "../services/promotion.service";
import { useBranchStore } from "../store/useBranchStore";
import { usePremium } from "../store/usePremium";
import { mapPremiumError } from "../lib/premium";
import { pageTitle, subtitle, btn, table, th, td, badge, emptyState } from "../ui/ui";

const smallBtn = (variant: "secondary" | "ghost"): CSSProperties => ({
  ...btn(variant),
  padding: "6px 12px",
  fontSize: 13,
});

// Convierte un ISO del backend a un valor para <input type="datetime-local">
// (formato "YYYY-MM-DDTHH:MM" en hora local). Devuelve "" si no hay valor.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convierte el valor de un input datetime-local a ISO (o null si vacio).
function localInputToIso(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Formatea una fecha ISO a un texto corto legible; "" si no hay.
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

type Vigencia = "vigente" | "programada" | "expirada" | "inactiva";

// Calcula el estado de vigencia de una promocion respecto a "ahora".
function computeVigencia(p: Promotion, now: Date): Vigencia {
  if (!p.is_active) return "inactiva";
  if (p.starts_at) {
    const start = new Date(p.starts_at);
    if (!isNaN(start.getTime()) && start.getTime() > now.getTime()) return "programada";
  }
  if (p.ends_at) {
    const end = new Date(p.ends_at);
    if (!isNaN(end.getTime()) && end.getTime() < now.getTime()) return "expirada";
  }
  return "vigente";
}

function vigenciaBadge(v: Vigencia) {
  switch (v) {
    case "vigente":
      return <span style={badge("success")}>Vigente</span>;
    case "programada":
      return <span style={badge("info")}>Programada</span>;
    case "expirada":
      return <span style={badge("muted")}>Expirada</span>;
    case "inactiva":
      return <span style={badge("muted")}>Inactiva</span>;
  }
}

export default function Promociones() {
  const { branches, activeBranchId, loadBranches } = useBranchStore();
  const { isPremium } = usePremium();

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const loadPromotions = useCallback(async (branchId: string) => {
    setLoading(true);
    setError("");
    try {
      const list = await promotionService.list(branchId);
      setPromotions(list);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || "No se pudieron cargar las promociones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Promociones" });
    // Asegura que las sucursales esten cargadas para conocer la sucursal activa.
    if (branches.length === 0) loadBranches();
  }, [loadBranches, branches.length]);

  useEffect(() => {
    if (activeBranchId) {
      loadPromotions(activeBranchId);
    } else {
      setPromotions([]);
    }
  }, [activeBranchId, loadPromotions]);

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setImageUrl("");
    setStartsAt("");
    setEndsAt("");
    setIsActive(true);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (p: Promotion) => {
    setEditing(p);
    setTitle(p.title);
    setDescription(p.description ?? "");
    setImageUrl(p.image_url ?? "");
    setStartsAt(isoToLocalInput(p.starts_at));
    setEndsAt(isoToLocalInput(p.ends_at));
    setIsActive(p.is_active);
    setFormError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBranchId) return;
    if (!title.trim()) {
      setFormError("El titulo es obligatorio.");
      return;
    }
    const startsIso = localInputToIso(startsAt);
    const endsIso = localInputToIso(endsAt);
    // Validacion ligera en cliente; el backend valida de forma definitiva.
    if (startsIso && endsIso && new Date(endsIso).getTime() < new Date(startsIso).getTime()) {
      setFormError("La fecha de fin no puede ser anterior a la de inicio.");
      return;
    }

    const payload: PromotionInput = {
      title: title.trim(),
      description: description.trim() === "" ? null : description.trim(),
      image_url: imageUrl.trim() === "" ? null : imageUrl.trim(),
      starts_at: startsIso,
      ends_at: endsIso,
      is_active: isActive,
    };

    setSaving(true);
    setFormError("");
    try {
      if (editing) {
        await promotionService.update(activeBranchId, editing.id, payload);
      } else {
        await promotionService.create(activeBranchId, payload);
      }
      setModalOpen(false);
      await loadPromotions(activeBranchId);
    } catch (err) {
      setFormError(
        mapPremiumError(err, "Gestionar promociones es solo para premium.", "No se pudo guardar la promoción")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Promotion) => {
    if (!activeBranchId) return;
    if (!window.confirm(`¿Eliminar la promoción "${p.title}"?`)) return;
    setBusyId(p.id);
    setActionError("");
    try {
      await promotionService.remove(activeBranchId, p.id);
      await loadPromotions(activeBranchId);
    } catch (err) {
      setActionError(
        mapPremiumError(err, "Gestionar promociones es solo para premium.", "No se pudo eliminar la promoción")
      );
    } finally {
      setBusyId(null);
    }
  };

  const now = new Date();

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={pageTitle}>Promociones</h1>
          <p style={subtitle}>Crea avisos informativos para comunicar ofertas a tus clientes por sucursal.</p>
          {activeBranch && (
            <p style={styles.branchNote}>
              Sucursal activa: <strong>{activeBranch.name}</strong>
            </p>
          )}
          {!isPremium && (
            <p style={styles.freeNote}>
              Gestionar promociones es una función premium. Puedes ver el estado, pero al reactivar premium podrás
              crear y editar.
            </p>
          )}
        </div>
        <div style={styles.headerAction}>
          {!isPremium && (
            <span style={badge("warning")} title="Gestionar promociones es solo para premium.">
              Solo premium
            </span>
          )}
          <button
            style={
              !isPremium || !activeBranchId
                ? { ...btn("primary"), opacity: 0.6, cursor: "not-allowed" }
                : btn("primary")
            }
            onClick={openCreate}
            disabled={!isPremium || !activeBranchId}
            title={!isPremium ? "Gestionar promociones es solo para premium." : undefined}
          >
            + Nueva promoción
          </button>
        </div>
      </div>

      {!activeBranchId && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🏢</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin sucursal activa</p>
          <p>Elige o crea una sucursal en la sección Sucursales para gestionar sus promociones.</p>
        </div>
      )}

      {activeBranchId && (
        <>
          {loading && promotions.length === 0 && (
            <div style={styles.loading}>
              <Spinner /> Cargando...
            </div>
          )}

          {error && promotions.length === 0 && (
            <div role="alert" aria-live="assertive">
              <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
              <button onClick={() => loadPromotions(activeBranchId)} style={btn("secondary")}>
                Reintentar
              </button>
            </div>
          )}

          {actionError && <div style={styles.formError} role="alert">{actionError}</div>}

          {!loading && !error && promotions.length === 0 && (
            <div style={emptyState}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>📣</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin promociones</p>
              <p>Crea tu primera promoción para comunicar ofertas de esta sucursal.</p>
            </div>
          )}

          {promotions.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Título</th>
                    <th style={th}>Estado</th>
                    <th style={th}>Vigencia</th>
                    <th style={th}>Periodo</th>
                    <th style={{ ...th, textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((p) => {
                    const vig = computeVigencia(p, now);
                    const desde = formatDate(p.starts_at);
                    const hasta = formatDate(p.ends_at);
                    return (
                      <tr key={p.id}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{p.title}</div>
                          {p.description && <div style={styles.descPreview}>{p.description}</div>}
                        </td>
                        <td style={td}>
                          {p.is_active ? (
                            <span style={badge("success")}>Activa</span>
                          ) : (
                            <span style={badge("muted")}>Inactiva</span>
                          )}
                        </td>
                        <td style={td}>{vigenciaBadge(vig)}</td>
                        <td style={{ ...td, color: desde || hasta ? undefined : "var(--text-muted)" }}>
                          {desde || hasta ? `${desde || "—"} → ${hasta || "—"}` : "Sin límite"}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <div style={styles.actions}>
                            <button style={smallBtn("secondary")} onClick={() => openEdit(p)} disabled={!isPremium}>
                              Editar
                            </button>
                            <button
                              style={smallBtn("ghost")}
                              onClick={() => handleDelete(p)}
                              disabled={!isPremium || busyId === p.id}
                            >
                              {busyId === p.id ? "..." : "Eliminar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        title={editing ? "Editar promoción" : "Nueva promoción"}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {formError && <div style={styles.formError} role="alert">{formError}</div>}
          <div style={styles.field}>
            <label htmlFor="promo-title">Título *</label>
            <input id="promo-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={120} />
          </div>
          <div style={styles.field}>
            <label htmlFor="promo-description">Descripción</label>
            <textarea
              id="promo-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Detalles de la promoción"
            />
          </div>
          <div style={styles.field}>
            <label htmlFor="promo-image">URL de imagen</label>
            <input
              id="promo-image"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              inputMode="url"
            />
          </div>
          <div style={styles.datesRow}>
            <div style={{ ...styles.field, flex: 1, marginBottom: 0 }}>
              <label htmlFor="promo-starts">Desde</label>
              <input id="promo-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div style={{ ...styles.field, flex: 1, marginBottom: 0 }}>
              <label htmlFor="promo-ends">Hasta</label>
              <input id="promo-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>Activa</span>
          </label>

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

const styles: Record<string, CSSProperties> = {
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  branchNote: { color: "var(--text-muted)", fontSize: 13, marginTop: 6 },
  freeNote: { color: "var(--text-muted)", fontSize: 13, marginTop: 6, maxWidth: 520 },
  headerAction: { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  actions: { display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  descPreview: { color: "var(--text-muted)", fontSize: 13, marginTop: 2, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
  datesRow: { display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 14, color: "var(--text)" },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
};
