import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Modal } from "../components/Modal";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { useAuthStore } from "../store/useAuthStore";
import {
  loyaltyService,
  type LoyaltyProgram,
  type LoyaltyProgramInput,
  type LoyaltyProgramType,
  type LoyaltyReward,
  type LoyaltyRewardStatus,
  type LoyaltyStats,
} from "../services/loyalty.service";
import { usePremium } from "../store/usePremium";
import { mapPremiumError } from "../lib/premium";
import { pageTitle, subtitle, btn, card, table, th, td, badge, emptyState } from "../ui/ui";

const TYPE_LABEL: Record<LoyaltyProgramType, string> = {
  ACCUMULATION: "Acumulacion",
  PERIODIC: "Por periodo",
};

const STATUS_LABEL: Record<LoyaltyRewardStatus, string> = {
  EARNED: "Ganada",
  CLAIMED: "Reclamada",
  REDEEMED: "Canjeada",
  EXPIRED: "Expirada",
};

const STATUS_BADGE: Record<LoyaltyRewardStatus, "success" | "info" | "muted"> = {
  EARNED: "success",
  CLAIMED: "info",
  REDEEMED: "info",
  EXPIRED: "muted",
};

const smallBtn = (variant: "primary" | "secondary" | "ghost"): CSSProperties => ({
  ...btn(variant),
  padding: "6px 12px",
  fontSize: 13,
});

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

function readErrorCode(err: any): string | undefined {
  return err?.response?.data?.error?.code;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

interface ProgramFormState {
  name: string;
  type: LoyaltyProgramType;
  goal: string;
  window_days: string;
  reward_text: string;
  validity_days: string;
}

const emptyForm: ProgramFormState = {
  name: "",
  type: "ACCUMULATION",
  goal: "",
  window_days: "",
  reward_text: "",
  validity_days: "",
};

export default function Lealtad() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "ADMIN";
  const { isPremium } = usePremium();

  // ------- METRICAS -------
  const [stats, setStats] = useState<LoyaltyStats | null>(null);
  const [statsError, setStatsError] = useState("");

  // ------- PROGRAMAS -------
  const [programs, setPrograms] = useState<LoyaltyProgram[]>([]);
  const [programsLoading, setProgramsLoading] = useState(true);
  const [programsError, setProgramsError] = useState("");
  const [programActionError, setProgramActionError] = useState("");
  const [busyProgramId, setBusyProgramId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LoyaltyProgram | null>(null);
  const [form, setForm] = useState<ProgramFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // ------- RECOMPENSAS -------
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [rewardsError, setRewardsError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | LoyaltyRewardStatus>("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [busyRewardId, setBusyRewardId] = useState<string | null>(null);
  const [rewardActionError, setRewardActionError] = useState("");
  const [rewardActionOk, setRewardActionOk] = useState("");

  const loadStats = useCallback(async () => {
    setStatsError("");
    try {
      setStats(await loyaltyService.getStats());
    } catch (err) {
      setStatsError(readError(err, "No se pudieron cargar las metricas"));
    }
  }, []);

  const loadPrograms = useCallback(async () => {
    setProgramsLoading(true);
    setProgramsError("");
    try {
      setPrograms(await loyaltyService.listPrograms());
    } catch (err) {
      setProgramsError(readError(err, "No se pudieron cargar los programas"));
    } finally {
      setProgramsLoading(false);
    }
  }, []);

  const loadRewards = useCallback(async () => {
    setRewardsLoading(true);
    setRewardsError("");
    try {
      setRewards(
        await loyaltyService.listRewards({
          status: statusFilter || undefined,
          customerId: customerSearch.trim() || undefined,
        })
      );
    } catch (err) {
      setRewardsError(readError(err, "No se pudieron cargar las recompensas"));
    } finally {
      setRewardsLoading(false);
    }
  }, [statusFilter, customerSearch]);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Lealtad" });
    // Free: no cargamos programas/metricas para evitar el 403 del backend;
    // se muestra un estado bloqueado "Solo premium" mas abajo.
    if (!isPremium) return;
    loadStats();
    loadPrograms();
  }, [isPremium, loadStats, loadPrograms]);

  useEffect(() => {
    if (!isPremium) return;
    loadRewards();
  }, [isPremium, loadRewards]);

  // ------- PROGRAMAS: modal -------
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (p: LoyaltyProgram) => {
    setEditing(p);
    setForm({
      name: p.name,
      type: p.type,
      goal: String(p.goal),
      window_days: p.window_days != null ? String(p.window_days) : "",
      reward_text: p.reward_text,
      validity_days: p.validity_days != null ? String(p.validity_days) : "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const validateForm = (): { input: LoyaltyProgramInput } | { error: string } => {
    const name = form.name.trim();
    if (!name) return { error: "El nombre es obligatorio." };

    const reward_text = form.reward_text.trim();
    if (!reward_text) return { error: "La recompensa es obligatoria." };

    const goal = Number(form.goal);
    if (!Number.isInteger(goal) || goal < 1) {
      return { error: "La meta debe ser un numero entero mayor o igual a 1." };
    }

    let window_days: number | null = null;
    if (form.type === "PERIODIC") {
      window_days = Number(form.window_days);
      if (!Number.isInteger(window_days) || window_days < 1) {
        return { error: "Para programas por periodo, los dias deben ser un entero mayor o igual a 1." };
      }
    }

    let validity_days: number | null = null;
    if (form.validity_days.trim() !== "") {
      validity_days = Number(form.validity_days);
      if (!Number.isInteger(validity_days) || validity_days < 1) {
        return { error: "La vigencia debe estar vacia (sin vencimiento) o ser un entero mayor o igual a 1." };
      }
    }

    return {
      input: {
        name,
        type: form.type,
        goal,
        window_days,
        reward_text,
        validity_days,
      },
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateForm();
    if ("error" in result) {
      setFormError(result.error);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editing) {
        await loyaltyService.updateProgram(editing.id, result.input);
      } else {
        await loyaltyService.createProgram(result.input);
      }
      setModalOpen(false);
      await Promise.all([loadPrograms(), loadStats()]);
    } catch (err) {
      setFormError(
        mapPremiumError(err, "Los programas de lealtad son solo para premium.", "No se pudo guardar el programa")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: LoyaltyProgram) => {
    setBusyProgramId(p.id);
    setProgramActionError("");
    try {
      await loyaltyService.setProgramActive(p.id, !p.is_active);
      await Promise.all([loadPrograms(), loadStats()]);
    } catch (err) {
      setProgramActionError(readError(err, "No se pudo cambiar el estado del programa"));
    } finally {
      setBusyProgramId(null);
    }
  };

  // ------- RECOMPENSAS: canje -------
  const handleRedeem = async (r: LoyaltyReward) => {
    setBusyRewardId(r.id);
    setRewardActionError("");
    setRewardActionOk("");
    try {
      await loyaltyService.redeemReward(r.id);
      setRewardActionOk("Recompensa marcada como canjeada.");
      await Promise.all([loadRewards(), loadStats()]);
    } catch (err) {
      const code = readErrorCode(err);
      if (code === "REWARD_ALREADY_REDEEMED") {
        setRewardActionError("Esta recompensa ya fue canjeada.");
      } else if (code === "REWARD_EXPIRED") {
        setRewardActionError("Esta recompensa ya expiro y no puede canjearse.");
      } else if (code === "REWARD_NOT_FOUND") {
        setRewardActionError("La recompensa ya no existe.");
      } else {
        setRewardActionError(readError(err, "No se pudo canjear la recompensa"));
      }
      // Refresca para reflejar el estado real tras un conflicto.
      await loadRewards();
    } finally {
      setBusyRewardId(null);
    }
  };

  // Free: pantalla bloqueada. No listamos programas/recompensas ni metricas
  // (el backend responde 403 en /loyalty/programs para tenants free).
  if (!isPremium) {
    return (
      <div>
        <div style={styles.headerRow}>
          <div>
            <h1 style={pageTitle}>Lealtad</h1>
            <p style={subtitle}>
              Configura programas de recompensas y gestiona los canjes de tus clientes.
            </p>
          </div>
        </div>

        <div style={styles.lockedCard}>
          <div style={{ fontSize: 40, marginBottom: 4 }}>🎁</div>
          <span style={badge("warning")}>Solo premium</span>
          <h2 style={{ ...styles.sectionTitle, marginTop: 12 }}>Lealtad es solo para premium</h2>
          <p style={{ ...subtitle, maxWidth: 460 }}>
            Los programas de recompensas y el seguimiento de canjes estan disponibles con
            premium. Activa tu suscripcion para premiar la fidelidad de tus clientes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={pageTitle}>Lealtad</h1>
          <p style={subtitle}>
            Configura programas de recompensas y gestiona los canjes de tus clientes.
          </p>
        </div>
        {isAdmin && (
          <div style={styles.headerAction}>
            <button style={btn("primary")} onClick={openCreate}>
              + Nuevo programa
            </button>
          </div>
        )}
      </div>

      {/* ------- METRICAS ------- */}
      {statsError && <div style={styles.formError}>{statsError}</div>}
      <div style={styles.metricsRow}>
        <MetricCard label="Programas activos" value={stats?.activePrograms} />
        <MetricCard label="Recompensas ganadas" value={stats?.rewardsEarned} />
        <MetricCard label="Por canjear" value={stats?.rewardsPending} />
        <MetricCard label="Canjeadas" value={stats?.rewardsRedeemed} />
        <MetricCard label="Expiradas" value={stats?.rewardsExpired} />
      </div>

      {/* ------- PROGRAMAS ------- */}
      <section style={{ marginTop: 32 }}>
        <h2 style={styles.sectionTitle}>Programas</h2>
        <p style={subtitle}>Reglas de acumulacion y recompensas de tu negocio.</p>

        {programActionError && <div style={{ ...styles.formError, marginTop: 12 }}>{programActionError}</div>}

        {programsLoading && programs.length === 0 && (
          <div style={styles.loading}>
            <Spinner /> Cargando...
          </div>
        )}

        {programsError && programs.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{programsError}</p>
            <button onClick={() => loadPrograms()} style={btn("secondary")}>
              Reintentar
            </button>
          </div>
        )}

        {!programsLoading && !programsError && programs.length === 0 && (
          <div style={{ ...emptyState, marginTop: 16 }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>🎁</div>
            <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin programas</p>
            <p>
              {isAdmin
                ? "Crea tu primer programa para empezar a premiar la fidelidad de tus clientes."
                : "Aun no hay programas configurados."}
            </p>
          </div>
        )}

        {programs.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Nombre</th>
                  <th style={th}>Tipo</th>
                  <th style={th}>Meta</th>
                  <th style={th}>Recompensa</th>
                  <th style={th}>Vigencia</th>
                  <th style={th}>Estado</th>
                  {isAdmin && <th style={{ ...th, textAlign: "right" }}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {programs.map((p) => (
                  <tr key={p.id}>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                    </td>
                    <td style={td}>{TYPE_LABEL[p.type]}</td>
                    <td style={td}>
                      {p.goal}
                      {p.type === "PERIODIC" && p.window_days != null ? ` / ${p.window_days} dias` : ""}
                    </td>
                    <td style={td}>{p.reward_text}</td>
                    <td style={td}>{p.validity_days != null ? `${p.validity_days} dias` : "Sin vencimiento"}</td>
                    <td style={td}>
                      {p.is_active ? (
                        <span style={badge("success")}>Activo</span>
                      ) : (
                        <span style={badge("muted")}>Inactivo</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td style={{ ...td, textAlign: "right" }}>
                        <div style={styles.actions}>
                          <button style={smallBtn("secondary")} onClick={() => openEdit(p)}>
                            Editar
                          </button>
                          <button
                            style={smallBtn("ghost")}
                            onClick={() => handleToggleActive(p)}
                            disabled={busyProgramId === p.id}
                          >
                            {busyProgramId === p.id ? "..." : p.is_active ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------- RECOMPENSAS ------- */}
      <section style={{ marginTop: 40 }}>
        <h2 style={styles.sectionTitle}>Recompensas por canjear</h2>
        <p style={subtitle}>Filtra por estado o busca por cliente y marca las recompensas como canjeadas.</p>

        <div style={styles.filters}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | LoyaltyRewardStatus)}
            style={styles.select}
            aria-label="Filtrar recompensas por estado"
          >
            <option value="">Todas</option>
            <option value="EARNED">Ganada</option>
            <option value="REDEEMED">Canjeada</option>
            <option value="EXPIRED">Expirada</option>
          </select>
          <input
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="ID de cliente"
            style={styles.searchInput}
            aria-label="Buscar por ID de cliente"
          />
        </div>

        {rewardActionError && <div style={{ ...styles.formError, marginTop: 12 }}>{rewardActionError}</div>}
        {rewardActionOk && <div style={{ ...styles.formOk, marginTop: 12 }}>{rewardActionOk}</div>}

        {rewardsLoading && rewards.length === 0 && (
          <div style={styles.loading}>
            <Spinner /> Cargando...
          </div>
        )}

        {rewardsError && rewards.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{rewardsError}</p>
            <button onClick={() => loadRewards()} style={btn("secondary")}>
              Reintentar
            </button>
          </div>
        )}

        {!rewardsLoading && !rewardsError && rewards.length === 0 && (
          <div style={{ ...emptyState, marginTop: 16 }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>✨</div>
            <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin recompensas</p>
            <p>No hay recompensas que coincidan con el filtro seleccionado.</p>
          </div>
        )}

        {rewards.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Cliente</th>
                  <th style={th}>Recompensa</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Ganada</th>
                  <th style={th}>Vence</th>
                  <th style={{ ...th, textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rewards.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 }}>
                      {r.customer_id}
                    </td>
                    <td style={td}>{r.reward_text}</td>
                    <td style={td}>
                      <span style={badge(STATUS_BADGE[r.status])}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td style={td}>{formatDate(r.earned_at)}</td>
                    <td style={td}>{r.expires_at ? formatDate(r.expires_at) : "Sin vencimiento"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {r.status === "EARNED" ? (
                        <button
                          style={smallBtn("primary")}
                          onClick={() => handleRedeem(r)}
                          disabled={busyRewardId === r.id}
                        >
                          {busyRewardId === r.id ? "..." : "Marcar canjeada"}
                        </button>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------- MODAL CREAR / EDITAR ------- */}
      <Modal
        open={modalOpen}
        title={editing ? "Editar programa" : "Nuevo programa"}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {formError && <div style={styles.formError}>{formError}</div>}

          <div style={styles.field}>
            <label htmlFor="loyalty-name">Nombre *</label>
            <input id="loyalty-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>

          <div style={styles.field}>
            <label htmlFor="loyalty-type">Tipo *</label>
            <select
              id="loyalty-type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as LoyaltyProgramType })}
            >
              <option value="ACCUMULATION">Acumulacion</option>
              <option value="PERIODIC">Por periodo</option>
            </select>
          </div>

          <div style={styles.field}>
            <label htmlFor="loyalty-goal">Meta (citas) *</label>
            <input
              id="loyalty-goal"
              type="number"
              min={1}
              step={1}
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              required
            />
          </div>

          {form.type === "PERIODIC" && (
            <div style={styles.field}>
              <label htmlFor="loyalty-window">Ventana (dias) *</label>
              <input
                id="loyalty-window"
                type="number"
                min={1}
                step={1}
                value={form.window_days}
                onChange={(e) => setForm({ ...form, window_days: e.target.value })}
                required
              />
            </div>
          )}

          <div style={styles.field}>
            <label htmlFor="loyalty-reward">Recompensa *</label>
            <input
              id="loyalty-reward"
              value={form.reward_text}
              onChange={(e) => setForm({ ...form, reward_text: e.target.value })}
              placeholder="Ej. Una cita gratis"
              required
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="loyalty-validity">Vigencia (dias)</label>
            <input
              id="loyalty-validity"
              type="number"
              min={1}
              step={1}
              value={form.validity_days}
              onChange={(e) => setForm({ ...form, validity_days: e.target.value })}
              placeholder="Vacio = sin vencimiento"
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

function MetricCard({ label, value }: { label: string; value?: number }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricValue}>{value != null ? value : "—"}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  headerAction: { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  lockedCard: { ...card, padding: 32, marginTop: 24, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" },
  metricsRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 },
  metricCard: { ...card, padding: 16, display: "flex", flexDirection: "column", gap: 4 },
  metricValue: { fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" },
  metricLabel: { fontSize: 13, color: "var(--text-muted)" },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", marginTop: 12 },
  actions: { display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  filters: { display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" },
  select: { padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 14 },
  searchInput: { padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 14, minWidth: 220 },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formOk: { background: "var(--success-soft)", color: "var(--success)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
};
