import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { authorizationService } from "../../services/authorization.service";
import type { AuthorizedAdmin } from "../../services/authorization.service";
import { trackEvent } from "../../lib/firebase";
import { pageTitle, subtitle, btn, table, th, td, badge, emptyState } from "../../ui/ui";
import Spinner from "../../components/Spinner";

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("es-ES");
}

export default function AdminAuthorizations() {
  const [items, setItems] = useState<AuthorizedAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError("");
    authorizationService
      .list()
      .then((data) => setItems(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar las autorizaciones"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Authorizations" });
    load();
  }, []);

  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setFormError("Ingresa un correo electronico.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await authorizationService.authorize(value);
      setEmail("");
      load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error?.message || "No se pudo autorizar el correo.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (row: AuthorizedAdmin) => {
    const next = row.status === "active" ? "revoked" : "active";
    // La revocacion es una accion sensible: confirmamos antes de continuar.
    if (next === "revoked" && !window.confirm(`Revocar la autorizacion de ${row.email}?`)) {
      return;
    }
    setBusyId(row.id);
    setError("");
    try {
      await authorizationService.setStatus(row.id, next);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || "No se pudo actualizar el estado.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={pageTitle}>Autorizaciones</h1>
          <p style={{ ...subtitle, marginTop: 4 }}>
            Autoriza correos para que puedan gestionar su negocio como duenos.
          </p>
        </div>
      </div>

      <form onSubmit={handleAuthorize} style={styles.form}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@ejemplo.com"
          aria-label="Correo electronico a autorizar"
          style={styles.input}
          disabled={submitting}
        />
        <button type="submit" style={btn("primary")} disabled={submitting}>
          {submitting ? "Autorizando..." : "Autorizar"}
        </button>
      </form>
      {formError && <p style={{ color: "var(--danger)", marginTop: -8, marginBottom: 16 }}>{formError}</p>}

      {loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {!loading && error && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>Reintentar</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {items.length === 0 ? (
            <div style={emptyState}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>🔑</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin autorizaciones</p>
              <p>Autoriza un correo para empezar.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Email</th>
                    <th style={th}>Estado</th>
                    <th style={th}>Codigo</th>
                    <th style={th}>Fecha</th>
                    <th style={{ ...th, textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td style={td}>{row.email}</td>
                      <td style={td}>
                        {row.status === "active" ? (
                          <span style={badge("success")}>Activo</span>
                        ) : (
                          <span style={badge("muted")}>Revocado</span>
                        )}
                      </td>
                      <td style={{ ...td, fontFamily: "var(--font-mono, monospace)" }}>
                        {row.booking_code ?? "—"}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {row.status === "active" ? (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(row)}
                            style={{ ...btn("ghost"), color: "var(--danger)" }}
                            disabled={busyId === row.id}
                            aria-busy={busyId === row.id}
                            aria-label={`Revocar autorizacion de ${row.email}`}
                          >
                            {busyId === row.id ? "Revocando..." : "Revocar"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(row)}
                            style={btn("secondary")}
                            disabled={busyId === row.id}
                            aria-busy={busyId === row.id}
                            aria-label={`Reactivar autorizacion de ${row.email}`}
                          >
                            {busyId === row.id ? "Reactivando..." : "Reactivar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20, flexWrap: "wrap" },
  form: { display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" },
  input: { flex: 1, minWidth: 240 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
};
