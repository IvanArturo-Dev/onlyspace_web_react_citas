import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { adminService } from "../../services/admin.service";
import type { LandingBanner, LandingBannerInput } from "../../types/admin";
import { trackEvent } from "../../lib/firebase";
import { pageTitle, subtitle, btn, badge, table, th, td, field, emptyState } from "../../ui/ui";
import Spinner from "../../components/Spinner";
import { Modal } from "../../components/Modal";

interface FormState {
  title: string;
  subtitle: string;
  image_url: string;
  link_url: string;
  sort_order: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  title: "",
  subtitle: "",
  image_url: "",
  link_url: "",
  sort_order: "0",
  is_active: true,
};

function apiError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || fallback;
}

export default function AdminLanding() {
  const [banners, setBanners] = useState<LandingBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal de creacion/edicion.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LandingBanner | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Acciones por fila (eliminar / activar-desactivar).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    adminService
      .getLandingBanners()
      .then((data) => setBanners(data))
      .catch((err) => setError(apiError(err, "Error al cargar los banners del landing")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Landing" });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (banner: LandingBanner) => {
    setEditing(banner);
    setForm({
      title: banner.title,
      subtitle: banner.subtitle ?? "",
      image_url: banner.image_url ?? "",
      link_url: banner.link_url ?? "",
      sort_order: String(banner.sort_order),
      is_active: banner.is_active,
    });
    setFormError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setFormError("El titulo es obligatorio.");
      return;
    }
    // El orden es opcional; si viene vacio o no numerico usamos 0.
    const parsedOrder = Number(form.sort_order);
    const sort_order = Number.isFinite(parsedOrder) ? Math.trunc(parsedOrder) : 0;

    const payload: LandingBannerInput = {
      title,
      subtitle: form.subtitle.trim() || null,
      image_url: form.image_url.trim() || null,
      link_url: form.link_url.trim() || null,
      sort_order,
      is_active: form.is_active,
    };

    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        await adminService.updateLandingBanner(editing.id, payload);
      } else {
        await adminService.createLandingBanner(payload);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(apiError(err, editing ? "No se pudo actualizar el banner." : "No se pudo crear el banner."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (banner: LandingBanner) => {
    if (!window.confirm(`Eliminar el banner "${banner.title}"? Esta accion no se puede deshacer.`)) {
      return;
    }
    setDeletingId(banner.id);
    setRowError("");
    try {
      await adminService.deleteLandingBanner(banner.id);
      setBanners((prev) => prev.filter((b) => b.id !== banner.id));
    } catch (err: any) {
      setRowError(apiError(err, "No se pudo eliminar el banner."));
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (banner: LandingBanner) => {
    const next = !banner.is_active;
    setTogglingId(banner.id);
    setRowError("");
    try {
      const updated = await adminService.updateLandingBanner(banner.id, { is_active: next });
      setBanners((prev) => prev.map((b) => (b.id === banner.id ? updated : b)));
    } catch (err: any) {
      setRowError(apiError(err, "No se pudo actualizar el estado del banner."));
    } finally {
      setTogglingId(null);
    }
  };

  const rowBusy = (id: string) => deletingId === id || togglingId === id;

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={pageTitle}>Landing</h1>
          <p style={{ ...subtitle, marginTop: 4 }}>
            Gestiona los banners que se muestran en la pagina de inicio publica.
          </p>
        </div>
        <button type="button" style={btn("primary")} onClick={openCreate}>
          Nuevo banner
        </button>
      </div>

      {rowError && (
        <p role="alert" style={styles.rowError}>
          {rowError}
        </p>
      )}

      {loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {!loading && error && (
        <div style={{ marginTop: 20 }}>
          <p role="alert" style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>Reintentar</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {banners.length === 0 ? (
            <div style={{ ...emptyState, marginTop: 20 }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>📣</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin banners</p>
              <p>Crea el primer banner para el landing publico.</p>
            </div>
          ) : (
            <div style={{ marginTop: 20, overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Imagen</th>
                    <th style={th}>Banner</th>
                    <th style={{ ...th, textAlign: "right" }}>Orden</th>
                    <th style={th}>Estado</th>
                    <th style={{ ...th, textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {banners.map((b) => {
                    const busy = rowBusy(b.id);
                    return (
                      <tr key={b.id}>
                        <td style={td}>
                          {b.image_url ? (
                            <img
                              src={b.image_url}
                              alt={`Miniatura de ${b.title}`}
                              style={styles.thumb}
                            />
                          ) : (
                            <div style={styles.thumbPlaceholder} aria-label="Sin imagen">
                              🖼️
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          <div style={styles.titleCell}>{b.title}</div>
                          {b.subtitle && <div style={styles.subCell}>{b.subtitle}</div>}
                          {b.link_url && (
                            <a href={b.link_url} target="_blank" rel="noopener noreferrer" style={styles.link}>
                              {b.link_url}
                            </a>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{b.sort_order}</td>
                        <td style={td}>
                          {b.is_active ? (
                            <span style={badge("success")}>Activo</span>
                          ) : (
                            <span style={badge("muted")}>Inactivo</span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <div style={styles.actions}>
                            <button
                              type="button"
                              style={btn("secondary")}
                              onClick={() => handleToggleActive(b)}
                              disabled={busy}
                              aria-busy={togglingId === b.id}
                              aria-label={`${b.is_active ? "Desactivar" : "Activar"} banner ${b.title}`}
                            >
                              {togglingId === b.id
                                ? "Guardando..."
                                : b.is_active
                                  ? "Desactivar"
                                  : "Activar"}
                            </button>
                            <button
                              type="button"
                              style={btn("ghost")}
                              onClick={() => openEdit(b)}
                              disabled={busy}
                              aria-label={`Editar banner ${b.title}`}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              style={{ ...btn("ghost"), color: "var(--danger)" }}
                              onClick={() => handleDelete(b)}
                              disabled={busy}
                              aria-busy={deletingId === b.id}
                              aria-label={`Eliminar banner ${b.title}`}
                            >
                              {deletingId === b.id ? "Eliminando..." : "Eliminar"}
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
        title={editing ? "Editar banner" : "Nuevo banner"}
        onClose={closeModal}
        footer={
          <div style={styles.footer}>
            <button type="button" style={btn("secondary")} onClick={closeModal} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" form="landing-banner-form" style={btn("primary")} disabled={submitting}>
              {submitting ? "Guardando..." : editing ? "Guardar cambios" : "Crear banner"}
            </button>
          </div>
        }
      >
        <form id="landing-banner-form" onSubmit={handleSubmit}>
          {formError && (
            <p role="alert" style={styles.formError}>
              {formError}
            </p>
          )}
          <div style={field}>
            <label htmlFor="banner-title">Titulo *</label>
            <input
              id="banner-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
              maxLength={160}
            />
          </div>
          <div style={field}>
            <label htmlFor="banner-subtitle">Subtitulo</label>
            <textarea
              id="banner-subtitle"
              value={form.subtitle}
              onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
              rows={3}
              style={{ minHeight: 72, resize: "vertical" }}
            />
          </div>
          <div style={field}>
            <label htmlFor="banner-image">URL de imagen</label>
            <input
              id="banner-image"
              type="url"
              value={form.image_url}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div style={field}>
            <label htmlFor="banner-link">URL de enlace</label>
            <input
              id="banner-link"
              type="url"
              value={form.link_url}
              onChange={(e) => setForm({ ...form, link_url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div style={field}>
            <label htmlFor="banner-order">Orden</label>
            <input
              id="banner-order"
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              step={1}
            />
          </div>
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <span>Activo</span>
          </label>
        </form>
      </Modal>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", marginTop: 20 },
  rowError: { color: "var(--danger)", marginBottom: 12, fontWeight: 600 },
  formError: {
    color: "var(--danger)",
    background: "var(--danger-soft)",
    padding: "8px 12px",
    borderRadius: "var(--radius-sm)",
    marginTop: 0,
    marginBottom: 14,
    fontSize: 14,
  },
  thumb: {
    width: 64,
    height: 40,
    objectFit: "cover",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    display: "block",
  },
  thumbPlaceholder: {
    width: 64,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-sm)",
    border: "1px dashed var(--border-strong)",
    background: "var(--surface-hover)",
    fontSize: 18,
  },
  titleCell: { fontWeight: 600, color: "var(--text)" },
  subCell: { fontSize: 13, color: "var(--text-muted)", marginTop: 2 },
  link: { fontSize: 12, color: "var(--brand)", marginTop: 4, display: "inline-block", wordBreak: "break-all" },
  actions: { display: "inline-flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" },
  checkRow: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "var(--text)" },
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 },
};
