import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { adminUsersService } from "../../services/adminUsers.service";
import type { AdminUser, AdminUserRole, AssignableRole } from "../../services/adminUsers.service";
import { subscriptionService } from "../../services/subscription.service";
import type { Subscription, SubscriptionStatus } from "../../services/subscription.service";
import { trackEvent } from "../../lib/firebase";
import { card, pageTitle, subtitle, btn, table, th, td, badge, emptyState } from "../../ui/ui";
import Spinner from "../../components/Spinner";
import { Modal } from "../../components/Modal";

// El sistema tiene EXACTAMENTE 3 roles operativos: SUPERADMIN, ADMIN (emprendedor) y
// CLIENT. ASSISTANT existe como sub-usuario del emprendedor pero NO se asigna desde aqui.
// Los unicos roles que el super admin puede asignar son ADMIN y CLIENT.
const ROLE_LABELS: Record<AdminUserRole, string> = {
  SUPERADMIN: "Super Admin",
  ADMIN: "Emprendedor",
  ASSISTANT: "Colaborador",
  CLIENT: "Cliente",
};

function roleBadgeKind(role: AdminUserRole): "success" | "warning" | "danger" | "info" | "muted" {
  switch (role) {
    case "SUPERADMIN":
      return "danger";
    case "ADMIN":
      return "info";
    case "ASSISTANT":
      return "warning";
    case "CLIENT":
      return "success";
    default:
      return "muted";
  }
}

// Traduce los codigos de error del backend a mensajes amigables.
function roleErrorMessage(err: any): string {
  const code = err?.response?.data?.error?.code;
  switch (code) {
    case "FORBIDDEN_ROLE":
      return "No se puede modificar el rol de un super admin.";
    case "INVALID_ROLE":
      return "Rol invalido. Solo se permite Emprendedor o Cliente.";
    default:
      return err?.response?.data?.error?.message || "No se pudo cambiar el rol.";
  }
}

function formatLastSeen(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES");
}

// ISO (o null) -> valor para <input type="date"> (yyyy-mm-dd). Vacio si no hay fecha.
function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// yyyy-mm-dd -> ISO (fin del dia) o null si esta vacio.
function dateInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(`${value}T23:59:59`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function AdminUsers() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const [busyId, setBusyId] = useState<string | null>(null);

  // ------- SUSCRIPCION (por emprendedor) -------
  const [subUser, setSubUser] = useState<AdminUser | null>(null);
  const [subData, setSubData] = useState<Subscription | null>(null);
  const [subStatus, setSubStatus] = useState<SubscriptionStatus>("inactive");
  const [subExpires, setSubExpires] = useState("");
  const [subLoading, setSubLoading] = useState(false);
  const [subSaving, setSubSaving] = useState(false);
  const [subError, setSubError] = useState("");

  const openSubscription = (row: AdminUser) => {
    if (!row.tenant_id) return;
    setSubUser(row);
    setSubData(null);
    setSubError("");
    setSubStatus("inactive");
    setSubExpires("");
    setSubLoading(true);
    subscriptionService
      .getSubscription(row.tenant_id)
      .then((s) => {
        setSubData(s);
        setSubStatus(s.status);
        setSubExpires(isoToDateInput(s.expires_at));
      })
      .catch((err) => setSubError(err?.response?.data?.error?.message || "No se pudo cargar la suscripcion."))
      .finally(() => setSubLoading(false));
  };

  const handleSaveSubscription = async () => {
    if (!subUser?.tenant_id) return;
    setSubSaving(true);
    setSubError("");
    try {
      const updated = await subscriptionService.setSubscription(subUser.tenant_id, {
        status: subStatus,
        expires_at: subStatus === "active" ? dateInputToIso(subExpires) : null,
      });
      setSubData(updated);
      setSubStatus(updated.status);
      setSubExpires(isoToDateInput(updated.expires_at));
    } catch (err: any) {
      setSubError(err?.response?.data?.error?.message || "No se pudo guardar la suscripcion.");
    } finally {
      setSubSaving(false);
    }
  };

  const load = () => {
    setLoading(true);
    setError("");
    adminUsersService
      .list()
      .then((data) => setItems(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar los usuarios"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Admin Users" });
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Conteos por rol derivados de la lista completa (no del filtro).
  const counts = useMemo(() => {
    const c = { total: items.length, SUPERADMIN: 0, ADMIN: 0, ASSISTANT: 0, CLIENT: 0 } as Record<string, number>;
    for (const u of items) {
      if (c[u.role] !== undefined) c[u.role] += 1;
    }
    return c;
  }, [items]);

  const handleToggleBlock = async (row: AdminUser) => {
    const nextBlocked = row.is_active; // si esta activo, la accion es bloquear
    if (nextBlocked && !window.confirm(`Bloquear a ${row.name || row.email}?`)) {
      return;
    }
    setBusyId(row.id);
    setError("");
    try {
      await adminUsersService.setBlocked(row.id, nextBlocked);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || "No se pudo actualizar el estado.");
    } finally {
      setBusyId(null);
    }
  };

  // Promueve a Emprendedor (ADMIN) o degrada a Cliente (CLIENT).
  const handleSetRole = async (row: AdminUser, role: AssignableRole) => {
    if (row.role === role) return;
    const verb = role === "ADMIN" ? "convertir en Emprendedor" : "degradar a Cliente";
    if (!window.confirm(`Deseas ${verb} a ${row.name || row.email}?`)) return;
    setBusyId(row.id);
    setError("");
    try {
      await adminUsersService.changeRole(row.id, role);
      load();
    } catch (err: any) {
      setError(roleErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={pageTitle}>Usuarios</h1>
          <p style={{ ...subtitle, marginTop: 4 }}>
            Administra el estado y el rol de las cuentas del sistema. Puedes convertir un cliente en
            emprendedor (dueño de negocio) o revocar ese acceso.
          </p>
        </div>
      </div>

      {/* Resumen: total y conteos por rol derivados de la lista real. */}
      <div style={styles.summary}>
        <SummaryCard label="Usuarios totales" value={counts.total} kind="muted" />
        <SummaryCard label="Emprendedores" value={counts.ADMIN} kind="info" />
        <SummaryCard label="Colaboradores" value={counts.ASSISTANT} kind="warning" />
        <SummaryCard label="Clientes" value={counts.CLIENT} kind="success" />
      </div>

      <div style={styles.toolbar}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o email"
          aria-label="Buscar usuarios por nombre o email"
          style={styles.input}
        />
      </div>

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
          {filtered.length === 0 ? (
            <div style={emptyState}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>👥</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin usuarios</p>
              <p>{query ? "No hay coincidencias con la busqueda." : "Aun no hay usuarios registrados."}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Nombre</th>
                    <th style={th}>Email</th>
                    <th style={th}>Rol</th>
                    <th style={th}>Estado</th>
                    <th style={th}>Ultima actividad</th>
                    <th style={{ ...th, minWidth: 280 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isSuper = row.role === "SUPERADMIN";
                    const isAdmin = row.role === "ADMIN";
                    const isAssistant = row.role === "ASSISTANT";
                    const busy = busyId === row.id;
                    return (
                      <tr key={row.id}>
                        <td style={td}>{row.name || "—"}</td>
                        <td style={td}>{row.email}</td>
                        <td style={td}>
                          <span style={badge(roleBadgeKind(row.role))}>{ROLE_LABELS[row.role]}</span>
                        </td>
                        <td style={td}>
                          {row.is_active ? (
                            <span style={badge("success")}>Activo</span>
                          ) : (
                            <span style={badge("danger")}>Bloqueado</span>
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{formatLastSeen(row.last_seen)}</td>
                        <td style={td}>
                          <div style={styles.actions}>
                            <button
                              type="button"
                              onClick={() => handleToggleBlock(row)}
                              style={row.is_active ? { ...btn("ghost"), color: "var(--danger)" } : btn("secondary")}
                              disabled={busy || isSuper}
                              aria-busy={busy}
                              title={isSuper ? "No disponible para super admin" : undefined}
                            >
                              {busy ? "Guardando..." : row.is_active ? "Bloquear" : "Desbloquear"}
                            </button>

                            {isSuper ? (
                              <span style={{ ...subtitle, fontSize: 13 }}>Rol protegido</span>
                            ) : isAdmin ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSetRole(row, "CLIENT")}
                                  style={{ ...btn("secondary") }}
                                  disabled={busy}
                                  aria-busy={busy}
                                  title="Revocar el acceso de emprendedor y dejarlo como cliente"
                                >
                                  {busy ? "Guardando..." : "Degradar a Cliente"}
                                </button>
                                {row.tenant_id && (
                                  <button
                                    type="button"
                                    onClick={() => openSubscription(row)}
                                    style={btn("secondary")}
                                    disabled={busy}
                                    title="Activar o desactivar la suscripcion premium del emprendedor"
                                  >
                                    Suscripcion
                                  </button>
                                )}
                              </>
                            ) : (
                              // CLIENT o ASSISTANT: pueden promoverse a Emprendedor.
                              <button
                                type="button"
                                onClick={() => handleSetRole(row, "ADMIN")}
                                style={btn("primary")}
                                disabled={busy}
                                aria-busy={busy}
                                title={
                                  isAssistant
                                    ? "Convertir en emprendedor con su propio negocio"
                                    : "Convertir en emprendedor (whitelist, obtiene negocio y sucursal)"
                                }
                              >
                                {busy ? "Guardando..." : "Hacer Emprendedor"}
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
        </>
      )}

      <Modal
        open={!!subUser}
        title={`Suscripcion${subUser ? ` — ${subUser.name || subUser.email}` : ""}`}
        onClose={() => setSubUser(null)}
        footer={
          <div style={styles.modalActions}>
            <button type="button" style={btn("secondary")} onClick={() => setSubUser(null)}>
              Cerrar
            </button>
            <button type="button" style={btn("primary")} onClick={handleSaveSubscription} disabled={subLoading || subSaving}>
              {subSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        }
      >
        {subLoading ? (
          <div style={styles.loading}>
            <Spinner /> Cargando...
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16 }}>
              {subData?.is_premium ? (
                <span style={badge("success")}>Premium activo</span>
              ) : (
                <span style={badge("muted")}>Inactivo</span>
              )}
            </div>

            <div style={styles.field}>
              <label htmlFor="sub-status">Estado</label>
              <select id="sub-status" value={subStatus} onChange={(e) => setSubStatus(e.target.value as SubscriptionStatus)}>
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
              </select>
            </div>

            {subStatus === "active" && (
              <div style={styles.field}>
                <label htmlFor="sub-expires">Fecha de expiracion (opcional)</label>
                <input id="sub-expires" type="date" value={subExpires} onChange={(e) => setSubExpires(e.target.value)} />
                <span style={{ ...subtitle, fontSize: 12 }}>
                  Dejala vacia para una suscripcion sin vencimiento. Una fecha pasada se considera vencida.
                </span>
              </div>
            )}

            {subError && <div style={styles.modalError}>{subError}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  kind,
}: {
  label: string;
  value: number;
  kind: "success" | "warning" | "danger" | "info" | "muted";
}) {
  return (
    <div style={{ ...card, ...styles.summaryCard }}>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryLabelRow}>
        <span style={badge(kind)}>{label}</span>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20, flexWrap: "wrap" },
  summary: { display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20 },
  summaryCard: { flex: "1 1 150px", minWidth: 150, padding: 16 },
  summaryValue: { fontSize: 26, fontWeight: 700, color: "var(--text)" },
  summaryLabelRow: { marginTop: 8 },
  toolbar: { display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" },
  input: { flex: 1, minWidth: 240 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  actions: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
  modalActions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  modalError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", fontSize: 14 },
};
