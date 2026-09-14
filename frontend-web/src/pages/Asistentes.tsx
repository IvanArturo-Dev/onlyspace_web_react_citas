import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Modal } from "../components/Modal";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { assistantsService, type Assistant, type AssistantStatus } from "../services/assistants.service";
import { usePremium } from "../store/usePremium";
import { isPremiumRequired } from "../lib/premium";
import { pageTitle, subtitle, btn, table, th, td, badge, emptyState } from "../ui/ui";

const smallBtn = (variant: "secondary" | "ghost"): CSSProperties => ({
  ...btn(variant),
  padding: "6px 12px",
  fontSize: 13,
});

// Traduce codigos de error del backend a mensajes amigables.
function inviteErrorMessage(err: any): string {
  if (isPremiumRequired(err)) return "Los colaboradores son solo para premium.";
  const code = err?.response?.data?.error?.code;
  switch (code) {
    case "CANNOT_INVITE_SUPERADMIN":
      return "No puedes invitar al super admin.";
    case "EMAIL_IS_ADMIN":
      return "Ese correo pertenece a otro negocio.";
    case "VALIDATION_ERROR":
      return "El correo no es valido.";
    default:
      return err?.response?.data?.error?.message || err?.message || "No se pudo enviar la invitacion.";
  }
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function Asistentes() {
  const [items, setItems] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const { isPremium } = usePremium();

  const load = () => {
    setLoading(true);
    setError("");
    assistantsService
      .list()
      .then((data) => setItems(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar los colaboradores"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Colaboradores" });
    load();
  }, []);

  const openInvite = () => {
    setEmail("");
    setFormError("");
    setModalOpen(true);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setFormError("El correo es obligatorio.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await assistantsService.invite(value);
      setModalOpen(false);
      load();
    } catch (err) {
      setFormError(inviteErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSetStatus = async (row: Assistant, status: AssistantStatus) => {
    if (row.status === status) return;
    const verb = status === "revoked" ? "revocar" : "reactivar";
    if (!window.confirm(`Deseas ${verb} el acceso de ${row.email}?`)) return;
    setBusyId(row.id);
    setActionError("");
    try {
      await assistantsService.setStatus(row.id, status);
      load();
    } catch (err: any) {
      setActionError(err?.response?.data?.error?.message || "No se pudo actualizar el colaborador.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={pageTitle}>Colaboradores</h1>
          <p style={subtitle}>
            Invita a colaboradores por correo para que te ayuden a gestionar las citas de este
            negocio. Los colaboradores pueden ver y administrar tus reservaciones y clientes.
          </p>
        </div>
        <div style={styles.headerAction}>
          {!isPremium && (
            <span style={badge("warning")} title="Los colaboradores son solo para premium.">
              Solo premium
            </span>
          )}
          <button
            style={!isPremium ? { ...btn("primary"), opacity: 0.6, cursor: "not-allowed" } : btn("primary")}
            onClick={openInvite}
            disabled={!isPremium}
            title={!isPremium ? "Los colaboradores son solo para premium." : undefined}
          >
            + Invitar colaborador
          </button>
        </div>
      </div>

      {loading && items.length === 0 && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {error && items.length === 0 && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>
            Reintentar
          </button>
        </div>
      )}

      {actionError && <div style={styles.formError}>{actionError}</div>}

      {!loading && !error && items.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🤝</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin colaboradores</p>
          <p>Invita a tu primer colaborador para compartir la gestion de tus citas.</p>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Correo</th>
                <th style={th}>Estado</th>
                <th style={th}>Fecha de invitacion</th>
                <th style={{ ...th, textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const active = row.status === "active";
                return (
                  <tr key={row.id}>
                    <td style={td}>{row.email}</td>
                    <td style={td}>
                      {active ? (
                        <span style={badge("success")}>Activo</span>
                      ) : (
                        <span style={badge("muted")}>Revocado</span>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={styles.actions}>
                        {active ? (
                          <button
                            style={{ ...smallBtn("ghost"), color: "var(--danger)" }}
                            onClick={() => handleSetStatus(row, "revoked")}
                            disabled={busyId === row.id}
                          >
                            {busyId === row.id ? "..." : "Revocar"}
                          </button>
                        ) : (
                          <button
                            style={smallBtn("secondary")}
                            onClick={() => handleSetStatus(row, "active")}
                            disabled={busyId === row.id}
                          >
                            {busyId === row.id ? "..." : "Reactivar"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} title="Invitar colaborador" onClose={() => setModalOpen(false)}>
        <form onSubmit={handleInvite}>
          {formError && <div style={styles.formError}>{formError}</div>}
          <p style={{ ...subtitle, marginTop: 0, marginBottom: 14 }}>
            El colaborador podra iniciar sesion y ayudar a gestionar las citas de este negocio.
          </p>
          <div style={styles.field}>
            <label htmlFor="assistant-email">Correo del colaborador *</label>
            <input
              id="assistant-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colaborador@correo.com"
              required
              autoFocus
            />
          </div>
          <div style={styles.formActions}>
            <button type="button" style={btn("secondary")} onClick={() => setModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" style={btn("primary")} disabled={saving}>
              {saving ? "Enviando..." : "Invitar"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  headerRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  headerAction: { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  actions: { display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
};
