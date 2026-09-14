import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { adminService } from "../../services/admin.service";
import { impersonationService } from "../../services/impersonation.service";
import { useImpersonation } from "../../store/useImpersonation";
import { trackEvent } from "../../lib/firebase";
import type { TenantSummary } from "../../types/admin";
import { card, pageTitle, subtitle, btn, badge, table, th, td, emptyState } from "../../ui/ui";
import Spinner from "../../components/Spinner";

export default function AdminTenants() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Tenant que se esta activando (para mostrar "Entrando..." solo en su boton).
  const [enteringId, setEnteringId] = useState<string | null>(null);
  // Error puntual al intentar actuar como un negocio (403/404, etc.).
  const [actionError, setActionError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    adminService
      .getTenants()
      .then((data) => setTenants(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar los negocios"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Tenants" });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleActAs = async (tenant: TenantSummary) => {
    if (enteringId) return;
    setEnteringId(tenant.tenant_id);
    setActionError("");
    try {
      const { token, tenant: target } = await impersonationService.start(tenant.tenant_id);
      // Guardamos el token + nombre en el store (sessionStorage) para que el
      // interceptor y el banner tomen el contexto del negocio objetivo.
      useImpersonation.getState().start(token, target?.name || tenant.name, tenant.tenant_id);
      trackEvent("impersonation_start", { tenant_id: tenant.tenant_id });
      // Recarga dura para que TODAS las pantallas reinicien con el token de impersonacion.
      window.location.href = "/";
    } catch (err: any) {
      const status = err?.response?.status;
      const apiMsg = err?.response?.data?.error?.message;
      const msg =
        status === 404
          ? "El negocio ya no existe o no esta disponible."
          : status === 403
            ? "No tienes permiso para actuar como este negocio."
            : apiMsg || "No se pudo entrar al negocio. Intentalo de nuevo.";
      setActionError(msg);
      setEnteringId(null);
    }
  };

  return (
    <div>
      <h1 style={pageTitle}>Negocios</h1>
      <p style={{ ...subtitle, marginTop: 4 }}>Da soporte actuando como cualquier negocio.</p>

      {actionError && (
        <div style={{ ...card, ...styles.errorPanel }}>
          <p style={{ color: "var(--danger)", margin: 0, fontWeight: 600 }}>{actionError}</p>
        </div>
      )}

      {loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {error && !loading && (
        <div style={{ marginTop: 20 }}>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>Reintentar</button>
        </div>
      )}

      {!loading && !error && tenants.length === 0 && (
        <div style={{ ...emptyState, marginTop: 20 }}>
          Aun no hay negocios registrados en la plataforma.
        </div>
      )}

      {!loading && !error && tenants.length > 0 && (
        <div style={{ marginTop: 20, overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Negocio</th>
                <th style={{ ...th, textAlign: "right" }}>Usuarios</th>
                <th style={{ ...th, textAlign: "right" }}>Clientes</th>
                <th style={{ ...th, textAlign: "right" }}>Servicios</th>
                <th style={{ ...th, textAlign: "right" }}>Citas</th>
                <th style={{ ...th, textAlign: "right" }}>Accion</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const isEntering = enteringId === t.tenant_id;
                return (
                  <tr key={t.tenant_id}>
                    <td style={td}>
                      <div style={styles.nameCell}>
                        <span style={styles.name}>{t.name}</span>
                        <span style={badge("muted")}>{t.appointments} citas</span>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{t.users}</td>
                    <td style={{ ...td, textAlign: "right" }}>{t.customers}</td>
                    <td style={{ ...td, textAlign: "right" }}>{t.services}</td>
                    <td style={{ ...td, textAlign: "right" }}>{t.appointments}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        type="button"
                        style={{ ...btn("primary"), ...(enteringId && !isEntering ? styles.btnDisabled : {}) }}
                        onClick={() => handleActAs(t)}
                        disabled={!!enteringId}
                        aria-label={`Actuar como ${t.name}`}
                      >
                        {isEntering ? (
                          <>
                            <Spinner /> Entrando...
                          </>
                        ) : (
                          "Actuar como"
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", marginTop: 20 },
  errorPanel: { padding: 14, marginTop: 16, background: "var(--danger-soft)", borderColor: "var(--danger)" },
  nameCell: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  name: { fontWeight: 600, color: "var(--text)" },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
};
