import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import ClientNav from "../../components/ClientNav";
import Spinner from "../../components/Spinner";
import { trackEvent } from "../../lib/firebase";
import {
  loyaltyService,
  type MyLoyalty,
  type LoyaltyProgress,
  type LoyaltyReward,
  type LoyaltyRewardStatus,
} from "../../services/loyalty.service";
import { card, btn, subtitle, pageTitle, badge } from "../../ui/ui";

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const PROGRAM_TYPE_LABEL: Record<string, string> = {
  ACCUMULATION: "Acumulacion",
  PERIODIC: "Por periodo",
};

function rewardStatusInfo(status: LoyaltyRewardStatus): {
  label: string;
  kind: "success" | "warning" | "danger" | "info" | "muted";
} {
  switch (status) {
    case "EARNED":
      return { label: "Ganada", kind: "success" };
    case "CLAIMED":
      return { label: "Reclamada", kind: "info" };
    case "REDEEMED":
      return { label: "Canjeada", kind: "info" };
    case "EXPIRED":
      return { label: "Expirada", kind: "muted" };
    default:
      return { label: status, kind: "muted" };
  }
}

// Filtros de la lista de cupones. "ALL" muestra todos.
type CouponFilter = "ALL" | LoyaltyRewardStatus;

const FILTER_OPTIONS: { value: CouponFilter; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "EARNED", label: "Activos" },
  { value: "CLAIMED", label: "Reclamados" },
  { value: "REDEEMED", label: "Canjeados" },
  { value: "EXPIRED", label: "Expirados" },
];

export default function MisCupones() {
  // Progreso de lealtad (barra por programa) desde /me/loyalty.
  const [progress, setProgress] = useState<LoyaltyProgress[]>([]);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState("");

  // Cupones del cliente desde /me/coupons.
  const [coupons, setCoupons] = useState<LoyaltyReward[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(true);
  const [couponsError, setCouponsError] = useState("");

  const [filter, setFilter] = useState<CouponFilter>("ALL");

  // Estado por-cupon para el flujo de reclamo (id -> en curso / error).
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Mis Cupones" });
    loadProgress();
    loadCoupons();
  }, []);

  const loadProgress = () => {
    setProgressLoading(true);
    setProgressError("");
    loyaltyService
      .getMyLoyalty()
      .then((data: MyLoyalty) => setProgress(data.progress))
      .catch((err) => setProgressError(readError(err, "Error al cargar tu progreso")))
      .finally(() => setProgressLoading(false));
  };

  const loadCoupons = () => {
    setCouponsLoading(true);
    setCouponsError("");
    loyaltyService
      .getMyCoupons()
      .then((data) => setCoupons(data))
      .catch((err) => setCouponsError(readError(err, "Error al cargar tus cupones")))
      .finally(() => setCouponsLoading(false));
  };

  const handleClaim = (reward: LoyaltyReward) => {
    setClaimingId(reward.id);
    setClaimErrors((prev) => {
      const next = { ...prev };
      delete next[reward.id];
      return next;
    });
    loyaltyService
      .claimReward(reward.id)
      .then((updated) => {
        // Reemplaza el cupon en la lista con la version reclamada (incluye claim_code).
        setCoupons((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        trackEvent("loyalty_reward_claimed", { reward_id: updated.id });
      })
      .catch((err) => {
        setClaimErrors((prev) => ({
          ...prev,
          [reward.id]: readError(err, "No se pudo reclamar la recompensa"),
        }));
      })
      .finally(() => setClaimingId(null));
  };

  const filteredCoupons = useMemo(() => {
    if (filter === "ALL") return coupons;
    return coupons.filter((c) => c.status === filter);
  }, [coupons, filter]);

  // Conteo por estado para mostrar el numero en cada chip.
  const counts = useMemo(() => {
    const base: Record<CouponFilter, number> = {
      ALL: coupons.length,
      EARNED: 0,
      CLAIMED: 0,
      REDEEMED: 0,
      EXPIRED: 0,
    };
    for (const c of coupons) base[c.status] += 1;
    return base;
  }, [coupons]);

  return (
    <>
      <ClientNav />
      <div style={styles.page}>
      <div style={styles.header} className="reveal">
        <div>
          <h1 style={pageTitle}>Mis cupones</h1>
          <p style={subtitle}>Tu progreso de lealtad y las recompensas que has ganado</p>
        </div>
      </div>

      {/* ---------- SECCION: MI PROGRESO ---------- */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={styles.sectionTitle}>Mi progreso</h2>

        {progressLoading && (
          <div style={styles.loadingRow}>
            <Spinner /> Cargando...
          </div>
        )}

        {progressError && !progressLoading && (
          <div>
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{progressError}</p>
            <button style={btn("secondary")} onClick={loadProgress}>
              Reintentar
            </button>
          </div>
        )}

        {!progressLoading && !progressError && progress.length === 0 && (
          <div style={{ ...card, padding: 28, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>📈</div>
            <p style={{ fontWeight: 600, color: "var(--text)" }}>Aun no tienes progreso</p>
            <p>Completa tus citas para avanzar en los programas de lealtad.</p>
          </div>
        )}

        {!progressLoading && !progressError && progress.length > 0 && (
          <div style={styles.group}>
            {progress.map((p) => {
              const goal = Math.max(1, p.program.goal);
              const count = Math.max(0, p.count);
              const pct = Math.min(100, Math.round((count / goal) * 100));
              return (
                <div key={p.program.id} style={{ ...card, ...styles.progressCard }} className="reveal lift">
                  <div style={styles.progressHead}>
                    <span style={styles.programName}>{p.program.name}</span>
                    <span style={badge("muted")}>
                      {PROGRAM_TYPE_LABEL[p.program.type] ?? p.program.type}
                    </span>
                  </div>
                  <div
                    style={styles.progressBarTrack}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={goal}
                    aria-valuenow={count}
                    aria-label={`${p.program.name}: ${count} de ${goal}`}
                  >
                    <div style={{ ...styles.progressBarFill, width: `${pct}%` }} />
                  </div>
                  <div style={styles.progressMeta}>
                    <span style={{ fontWeight: 700, color: "var(--text)" }}>
                      {count} de {goal} ({pct}%)
                    </span>
                    {p.program.type === "PERIODIC" && p.program.window_days != null && (
                      <span style={subtitle}>en los ultimos {p.program.window_days} dias</span>
                    )}
                  </div>
                  <div style={subtitle}>{p.program.reward_text}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- SECCION: MIS CUPONES ---------- */}
      <section>
        <h2 style={styles.sectionTitle}>Mis cupones</h2>

        {/* Chips de filtro por estado. */}
        {!couponsLoading && !couponsError && coupons.length > 0 && (
          <div style={styles.chips} role="group" aria-label="Filtrar cupones por estado">
            {FILTER_OPTIONS.map((opt) => {
              const active = filter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(opt.value)}
                  style={{ ...styles.chip, ...(active ? styles.chipActive : null) }}
                >
                  {opt.label} ({counts[opt.value]})
                </button>
              );
            })}
          </div>
        )}

        {couponsLoading && (
          <div style={styles.loadingRow}>
            <Spinner /> Cargando...
          </div>
        )}

        {couponsError && !couponsLoading && (
          <div>
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{couponsError}</p>
            <button style={btn("secondary")} onClick={loadCoupons}>
              Reintentar
            </button>
          </div>
        )}

        {!couponsLoading && !couponsError && coupons.length === 0 && (
          <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>🎁</div>
            <p style={{ fontWeight: 600, color: "var(--text)" }}>Aun no tienes cupones</p>
            <p>Cuando ganes una recompensa aparecera aqui.</p>
          </div>
        )}

        {!couponsLoading && !couponsError && coupons.length > 0 && filteredCoupons.length === 0 && (
          <div style={{ ...card, padding: 28, textAlign: "center", color: "var(--text-muted)" }}>
            <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin cupones en este filtro</p>
            <p>Prueba con otro estado.</p>
          </div>
        )}

        {!couponsLoading && !couponsError && filteredCoupons.length > 0 && (
          <div style={styles.group}>
            {filteredCoupons.map((c) => {
              const rs = rewardStatusInfo(c.status);
              const claimError = claimErrors[c.id];
              const isClaiming = claimingId === c.id;
              return (
                <div key={c.id} style={{ ...card, ...styles.couponCard }} className="reveal lift">
                  <div style={styles.couponHead}>
                    <div style={{ flex: 1 }}>
                      <div style={styles.programName}>{c.reward_text}</div>
                      <div style={subtitle}>Obtenida el {formatDate(c.earned_at)}</div>
                      {c.expires_at && <div style={subtitle}>Vence el {formatDate(c.expires_at)}</div>}
                    </div>
                    <span style={badge(rs.kind)}>{rs.label}</span>
                  </div>

                  {/* EARNED: boton para reclamar. */}
                  {c.status === "EARNED" && (
                    <div style={styles.couponActions}>
                      <button
                        type="button"
                        style={btn("primary")}
                        onClick={() => handleClaim(c)}
                        disabled={isClaiming}
                        aria-busy={isClaiming}
                      >
                        {isClaiming ? "Reclamando..." : "Reclamar"}
                      </button>
                      {claimError && (
                        <span style={{ color: "var(--danger)", fontSize: 13 }} role="alert">
                          {claimError}
                        </span>
                      )}
                    </div>
                  )}

                  {/* CLAIMED: muestra el codigo para presentarlo en el negocio. */}
                  {c.status === "CLAIMED" && c.claim_code && (
                    <div style={styles.codeBox}>
                      <div style={styles.codeLabel}>Muestra este codigo en el negocio</div>
                      <div style={styles.codeValue}>{c.claim_code}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 680, margin: "0 auto", padding: "28px 20px 60px" },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 24,
    flexWrap: "wrap",
  },
  loadingRow: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 },
  group: { display: "flex", flexDirection: "column", gap: 12 },
  progressCard: { padding: 18, display: "flex", flexDirection: "column", gap: 10 },
  progressHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  programName: { fontSize: 15, fontWeight: 700, color: "var(--text)" },
  progressBarTrack: {
    height: 10,
    borderRadius: 999,
    background: "var(--surface-hover)",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--brand), var(--info))",
    borderRadius: 999,
    transition: "width 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
  },
  progressMeta: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  chips: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: {
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 999,
    background: "var(--surface)",
    color: "var(--text-muted)",
    border: "1px solid var(--border-strong)",
    cursor: "pointer",
    transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
  },
  chipActive: {
    background: "var(--brand)",
    color: "var(--brand-contrast)",
    borderColor: "var(--brand)",
  },
  couponCard: { padding: 18, display: "flex", flexDirection: "column", gap: 12 },
  couponHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  couponActions: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  codeBox: {
    borderRadius: "var(--radius-sm)",
    border: "1px dashed var(--brand)",
    background: "var(--surface-hover)",
    padding: "14px 16px",
    textAlign: "center",
  },
  codeLabel: { fontSize: 13, color: "var(--text-muted)", marginBottom: 6 },
  codeValue: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: "0.12em",
    color: "var(--text)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
};
