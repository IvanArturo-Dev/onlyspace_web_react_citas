import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import ClientNav from "../../components/ClientNav";
import Spinner from "../../components/Spinner";
import { trackEvent } from "../../lib/firebase";
import { Modal } from "../../components/Modal";
import {
  clientService,
  type MyAppointment,
  type Review,
  type Favorite,
} from "../../services/client.service";
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

function statusInfo(status: string): { label: string; kind: "success" | "warning" | "danger" | "info" | "muted" } {
  switch (status) {
    case "PENDING":
      return { label: "Pendiente", kind: "warning" };
    case "CONFIRMED":
      return { label: "Confirmada", kind: "success" };
    case "COMPLETED":
      return { label: "Completada", kind: "info" };
    case "CANCELLED":
      return { label: "Cancelada", kind: "danger" };
    case "NO_SHOW":
      return { label: "No asistio", kind: "muted" };
    default:
      return { label: status, kind: "muted" };
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export default function MyAppointments() {
  const navigate = useNavigate();

  const [items, setItems] = useState<MyAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Estado propio para la seccion de lealtad; no interfiere con la carga de citas.
  const [loyalty, setLoyalty] = useState<MyLoyalty>({ progress: [], rewards: [] });
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loyaltyError, setLoyaltyError] = useState("");

  // Estado propio para favoritos; independiente de citas y lealtad.
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesError, setFavoritesError] = useState("");

  // Mapa appointment_id -> Review para pintar/editar resenas en citas COMPLETED.
  const [reviewsByAppointment, setReviewsByAppointment] = useState<Record<string, Review>>({});

  // Cita cuya resena se esta creando/editando (null = modal cerrado).
  const [reviewTarget, setReviewTarget] = useState<MyAppointment | null>(null);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Mis Citas" });
    load();
    loadLoyalty();
    loadFavorites();
    loadReviews();
  }, []);

  const load = () => {
    setLoading(true);
    setError("");
    clientService
      .myAppointments()
      .then((data) => setItems(data))
      .catch((err) => setError(readError(err, "Error al cargar tus citas")))
      .finally(() => setLoading(false));
  };

  const loadLoyalty = () => {
    setLoyaltyLoading(true);
    setLoyaltyError("");
    loyaltyService
      .getMyLoyalty()
      .then((data) => setLoyalty(data))
      .catch((err) => setLoyaltyError(readError(err, "Error al cargar tus recompensas")))
      .finally(() => setLoyaltyLoading(false));
  };

  const loadFavorites = () => {
    setFavoritesLoading(true);
    setFavoritesError("");
    clientService
      .listFavorites()
      .then((data) => setFavorites(data))
      .catch((err) => setFavoritesError(readError(err, "Error al cargar tus favoritos")))
      .finally(() => setFavoritesLoading(false));
  };

  const loadReviews = () => {
    clientService
      .getMyReviews()
      .then((data) => {
        const map: Record<string, Review> = {};
        for (const r of data) map[r.appointment_id] = r;
        setReviewsByAppointment(map);
      })
      .catch(() => {
        // Silencioso: la ausencia de resenas no debe romper la lista de citas.
        setReviewsByAppointment({});
      });
  };

  // Quita un negocio de favoritos (toggle) y actualiza la lista en memoria.
  const handleRemoveFavorite = async (fav: Favorite) => {
    try {
      await clientService.toggleFavorite(fav.tenant_id);
      setFavorites((prev) => prev.filter((f) => f.tenant_id !== fav.tenant_id));
    } catch (err) {
      setFavoritesError(readError(err, "No se pudo actualizar el favorito"));
    }
  };

  // Guarda (crea/edita) la resena de una cita y actualiza el mapa en memoria.
  const handleReviewSaved = (review: Review) => {
    setReviewsByAppointment((prev) => ({ ...prev, [review.appointment_id]: review }));
    setReviewTarget(null);
  };

  return (
    <>
      <ClientNav />
      <div style={styles.page}>
      <div style={styles.header} className="reveal">
        <div>
          <h1 style={pageTitle}>Mis citas</h1>
          <p style={subtitle}>Consulta el estado de tus reservas</p>
        </div>
      </div>

      <section style={{ marginBottom: 28 }}>
        <h2 style={styles.sectionTitle}>Mis recompensas</h2>

        {loyaltyLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
            <Spinner /> Cargando...
          </div>
        )}

        {loyaltyError && !loyaltyLoading && (
          <div>
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{loyaltyError}</p>
            <button style={btn("secondary")} onClick={loadLoyalty}>
              Reintentar
            </button>
          </div>
        )}

        {!loyaltyLoading &&
          !loyaltyError &&
          loyalty.progress.length === 0 &&
          loyalty.rewards.length === 0 && (
            <div style={{ ...card, padding: 28, textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🎁</div>
              <p style={{ fontWeight: 600, color: "var(--text)" }}>Aun no tienes recompensas ni progreso</p>
              <p>Completa tus citas para avanzar en los programas de lealtad.</p>
            </div>
          )}

        {!loyaltyLoading && !loyaltyError && loyalty.progress.length > 0 && (
          <div style={styles.loyaltyGroup}>
            {loyalty.progress.map((p: LoyaltyProgress) => {
              const goal = Math.max(1, p.program.goal);
              const count = Math.max(0, p.count);
              const pct = Math.min(100, Math.round((count / goal) * 100));
              return (
                <div key={p.program.id} style={{ ...card, ...styles.progressCard }} className="reveal lift">
                  <div style={styles.progressHead}>
                    <span style={styles.programName}>{p.program.name}</span>
                    <span style={badge("muted")}>{PROGRAM_TYPE_LABEL[p.program.type] ?? p.program.type}</span>
                  </div>
                  <div style={styles.progressBarTrack}>
                    <div style={{ ...styles.progressBarFill, width: `${pct}%` }} />
                  </div>
                  <div style={styles.progressMeta}>
                    <span style={{ fontWeight: 700, color: "var(--text)" }}>
                      {count} de {goal}
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

        {!loyaltyLoading && !loyaltyError && loyalty.rewards.length > 0 && (
          <div style={{ ...styles.loyaltyGroup, marginTop: 12 }}>
            {loyalty.rewards.map((r: LoyaltyReward) => {
              const rs = rewardStatusInfo(r.status);
              return (
                <div key={r.id} style={{ ...card, ...styles.rewardItem }}>
                  <div style={{ flex: 1 }}>
                    <div style={styles.programName}>{r.reward_text}</div>
                    <div style={subtitle}>Obtenida el {formatDate(r.earned_at)}</div>
                    {r.expires_at && <div style={subtitle}>Vence el {formatDate(r.expires_at)}</div>}
                  </div>
                  <span style={badge(rs.kind)}>{rs.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={styles.sectionTitle}>Mis favoritos</h2>

        {favoritesLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
            <Spinner /> Cargando...
          </div>
        )}

        {favoritesError && !favoritesLoading && (
          <div>
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{favoritesError}</p>
            <button style={btn("secondary")} onClick={loadFavorites}>
              Reintentar
            </button>
          </div>
        )}

        {!favoritesLoading && !favoritesError && favorites.length === 0 && (
          <div style={{ ...card, padding: 28, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>⭐</div>
            <p style={{ fontWeight: 600, color: "var(--text)" }}>Aun no tienes favoritos</p>
            <p>Marca negocios como favoritos para volver a reservar rapido.</p>
          </div>
        )}

        {!favoritesLoading && !favoritesError && favorites.length > 0 && (
          <div style={styles.loyaltyGroup}>
            {favorites.map((f) => (
              <div key={f.tenant_id} style={{ ...card, ...styles.rewardItem }} className="reveal lift">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.programName}>{f.business_name}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
                  {f.code && (
                    <button
                      style={btn("primary")}
                      onClick={() => navigate(`/reservar/${encodeURIComponent(f.code as string)}`)}
                    >
                      Reservar
                    </button>
                  )}
                  <button
                    style={btn("ghost")}
                    onClick={() => handleRemoveFavorite(f)}
                    aria-label={`Quitar ${f.business_name} de favoritos`}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
          <Spinner /> Cargando...
        </div>
      )}

      {error && !loading && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button style={btn("secondary")} onClick={load}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📭</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Aun no tienes citas</p>
          <p>Cuando agendes una cita aparecera aqui.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div style={styles.list}>
          {items.map((a) => {
            const st = statusInfo(a.status);
            const isCompleted = a.status === "COMPLETED";
            const review = reviewsByAppointment[a.id];
            return (
              <div key={a.id} style={{ ...card, ...styles.itemCol }} className="reveal lift">
                <div style={styles.itemRow}>
                  <div style={{ flex: 1 }}>
                    <div style={styles.business}>{a.business_name}</div>
                    <div style={styles.service}>{a.service_name}</div>
                    <div style={subtitle}>{formatDateTime(a.start_time)}</div>
                    {a.video_call_url && (
                      <a
                        href={a.video_call_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.videoLink}
                      >
                        🎥 Unirse a la videollamada
                      </a>
                    )}
                  </div>
                  <span style={badge(st.kind)}>{st.label}</span>
                </div>

                {/* Resenas: solo citas COMPLETED ofrecen calificar/editar (Req 6.3). */}
                {isCompleted && (
                  <div style={styles.reviewArea}>
                    {review && (
                      <div style={styles.reviewShown}>
                        <div style={styles.starsShown} aria-label={`Tu calificacion: ${review.rating} de 5`}>
                          <span aria-hidden="true">{"★".repeat(review.rating)}</span>
                          <span aria-hidden="true" style={{ color: "var(--text-subtle)" }}>
                            {"★".repeat(5 - review.rating)}
                          </span>
                        </div>
                        {review.comment && <p style={styles.reviewComment}>{review.comment}</p>}
                      </div>
                    )}
                    <button style={btn("secondary")} onClick={() => setReviewTarget(a)}>
                      {review ? "Editar resena" : "Calificar"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ReviewModal
        appointment={reviewTarget}
        existing={reviewTarget ? reviewsByAppointment[reviewTarget.id] : undefined}
        onClose={() => setReviewTarget(null)}
        onSaved={handleReviewSaved}
      />
      </div>
    </>
  );
}

/**
 * Modal para crear/editar la resena de una cita COMPLETED. Selector de estrellas
 * 1-5 accesible + comentario opcional. Valida rating 1-5 antes de enviar y
 * muestra el error del backend si lo hubiera.
 */
function ReviewModal({
  appointment,
  existing,
  onClose,
  onSaved,
}: {
  appointment: MyAppointment | null;
  existing?: Review;
  onClose: () => void;
  onSaved: (review: Review) => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [hoverRating, setHoverRating] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Precarga los valores existentes cada vez que se abre para una cita.
  useEffect(() => {
    if (appointment) {
      setRating(existing?.rating ?? 0);
      setComment(existing?.comment ?? "");
      setHoverRating(0);
      setError("");
      setSaving(false);
    }
  }, [appointment, existing]);

  const handleSave = async () => {
    if (!appointment) return;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      setError("Selecciona una calificacion de 1 a 5 estrellas");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await clientService.upsertReview({
        appointment_id: appointment.id,
        rating,
        comment: comment.trim() ? comment.trim() : null,
      });
      onSaved(saved);
    } catch (err) {
      setError(readError(err, "No se pudo guardar tu resena"));
      setSaving(false);
    }
  };

  const shown = hoverRating || rating;

  return (
    <Modal
      open={appointment != null}
      title={existing ? "Editar resena" : "Calificar cita"}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={btn("ghost")} onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button style={btn("primary")} onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      }
    >
      {appointment && (
        <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 14 }}>
          {appointment.business_name} · {appointment.service_name}
        </div>
      )}

      <div
        style={styles.starPicker}
        role="radiogroup"
        aria-label="Calificacion de 1 a 5 estrellas"
        onMouseLeave={() => setHoverRating(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHoverRating(n)}
            style={{
              ...styles.starBtn,
              color: n <= shown ? "#f59e0b" : "var(--text-subtle)",
            }}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comentario (opcional)"
        aria-label="Comentario"
        rows={4}
        style={styles.textarea}
      />

      {error && (
        <p style={{ color: "var(--danger)", marginTop: 10, fontSize: 14 }} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 680, margin: "0 auto", padding: "28px 20px 60px" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  item: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 18 },
  itemCol: { display: "flex", flexDirection: "column", gap: 12, padding: 18 },
  itemRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  reviewArea: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    alignItems: "flex-start",
  },
  reviewShown: { display: "flex", flexDirection: "column", gap: 4 },
  starsShown: { fontSize: 16, color: "#f59e0b", letterSpacing: 1 },
  reviewComment: { fontSize: 14, color: "var(--text)", margin: 0 },
  starPicker: { display: "flex", gap: 6, marginBottom: 14 },
  starBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 32,
    lineHeight: 1,
    padding: 0,
    transition: "color 0.12s ease",
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 14,
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
  },
  business: { fontSize: 15, fontWeight: 700, color: "var(--text)" },
  service: { fontSize: 14, color: "var(--text)", marginTop: 2 },
  videoLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--brand)",
    textDecoration: "none",
  },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 },
  loyaltyGroup: { display: "flex", flexDirection: "column", gap: 12 },
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
  rewardItem: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 18, flexWrap: "wrap" },
};
