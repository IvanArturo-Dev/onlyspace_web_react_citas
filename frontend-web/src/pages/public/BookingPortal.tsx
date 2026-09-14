import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ThemeToggle from "../../components/ThemeToggle";
import Spinner from "../../components/Spinner";
import PromoCard from "../../components/ads/PromoCard";
import AdSlot from "../../components/ads/AdSlot";
import { useAuthStore } from "../../store/useAuthStore";
import { trackEvent } from "../../lib/firebase";
import {
  publicBookingService,
  type PublicInfo,
  type PublicService,
  type Slot,
} from "../../services/public.service";
import { waitlistService } from "../../services/waitlist.service";
import { card, btn, subtitle, pageTitle } from "../../ui/ui";

/** Valida que el color de marca sea una cadena usable (hex, rgb(...) o nombre CSS). */
function safeBrandColor(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** Fecha corta legible ("15/03") a partir de un ISO; null si no es valida. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

/**
 * Vigencia legible de una promocion (Req 5.1):
 * - Con inicio y fin: "Del DD/MM al DD/MM".
 * - Solo fin: "Hasta el DD/MM".
 * - Solo inicio: "Desde el DD/MM".
 * - Sin fechas: null (no se muestra vigencia).
 */
function promoValidity(starts_at: string | null, ends_at: string | null): string | null {
  const start = shortDate(starts_at);
  const end = shortDate(ends_at);
  if (start && end) return `Del ${start} al ${end}`;
  if (end) return `Hasta el ${end}`;
  if (start) return `Desde el ${start}`;
  return null;
}

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

export default function BookingPortal() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, loginWithGoogle, user } = useAuthStore();

  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState("");
  const [invalidCode, setInvalidCode] = useState(false);

  const [selectedService, setSelectedService] = useState<PublicService | null>(null);
  const [date, setDate] = useState("");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState("");

  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [modality, setModality] = useState<"in_person" | "online">("in_person");
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  // Enlace de Google Meet devuelto por el backend al confirmar una cita en linea.
  const [videoCallUrl, setVideoCallUrl] = useState<string | null>(null);

  // Lista de espera: cuando no hay huecos para el servicio/fecha, el cliente puede
  // anotarse. Manejo defensivo de errores (falta cliente, deuda, etc.).
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const [waitlistError, setWaitlistError] = useState("");

  // Cargar info del negocio al montar / cambiar de codigo.
  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Booking Portal", code });
    loadInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Vuelve a la pantalla anterior dentro de la app; si se entro directo (link/QR),
  // cae a la pantalla de descubrimiento.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/inicio");
  };

  const loadInfo = () => {
    setLoadingInfo(true);
    setInfoError("");
    setInvalidCode(false);
    publicBookingService
      .getInfo(code)
      .then((data) => setInfo(data))
      .catch((err) => {
        if (err?.response?.status === 404) {
          setInvalidCode(true);
        } else {
          setInfoError(readError(err, "Error al cargar el negocio"));
        }
      })
      .finally(() => setLoadingInfo(false));
  };

  const loadAvailability = (service: PublicService, dateStr: string) => {
    setLoadingSlots(true);
    setSlotsError("");
    setSlots([]);
    setSelectedSlot(null);
    publicBookingService
      .getAvailability(code, service.id, dateStr)
      .then((data) => setSlots(data.slots || []))
      .catch((err) => setSlotsError(readError(err, "Error al cargar la disponibilidad")))
      .finally(() => setLoadingSlots(false));
  };

  const handleSelectService = (service: PublicService) => {
    setSelectedService(service);
    setSelectedSlot(null);
    setSlots([]);
    setBookError("");
    setConfirmed(false);
    setModality("in_person");
    setWaitlistJoined(false);
    setWaitlistError("");
    if (date) loadAvailability(service, date);
  };

  const handleDateChange = (value: string) => {
    setDate(value);
    setSelectedSlot(null);
    setBookError("");
    setWaitlistJoined(false);
    setWaitlistError("");
    if (selectedService && value) loadAvailability(selectedService, value);
  };

  const handleGoogleLogin = async () => {
    setLoggingIn(true);
    setBookError("");
    try {
      await loginWithGoogle();
      trackEvent("login", { method: "google", context: "booking_portal" });
    } catch (err: any) {
      setBookError(readError(err, "No se pudo iniciar sesion con Google"));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedService || !selectedSlot) return;
    setBooking(true);
    setBookError("");
    try {
      const result = await publicBookingService.book(code, {
        service_id: selectedService.id,
        start_time: selectedSlot.start,
        // El cliente siempre puede elegir la modalidad (sin gating por Google).
        modality,
      });
      // Si la cita en linea ya trae enlace de Meet, lo mostramos al cliente.
      setVideoCallUrl(typeof result?.video_call_url === "string" ? result.video_call_url : null);
      trackEvent("appointment_booked", { code, service_id: selectedService.id, modality });
      setConfirmed(true);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setBookError("Ese horario ya fue tomado, elige otro");
        setSelectedSlot(null);
        if (selectedService && date) loadAvailability(selectedService, date);
      } else {
        setBookError(readError(err, "No se pudo agendar la cita"));
      }
    } finally {
      setBooking(false);
    }
  };

  // Anota al cliente en la lista de espera del servicio/fecha elegidos. El portal
  // publico no siempre expone un customerId (la reserva se resuelve por la sesion),
  // por eso la accion es DEFENSIVA: intentamos unir y, si el backend responde con
  // un error (falta cliente, 409 CUSTOMER_HAS_DEBT, etc.), mostramos un mensaje
  // claro en espanol sin romper el flujo de reserva.
  const handleJoinWaitlist = async () => {
    if (!selectedService || !date) return;
    setJoiningWaitlist(true);
    setWaitlistError("");
    // El id de cliente no esta garantizado en el portal publico; enviamos el del
    // usuario autenticado como referencia. Si el backend no lo acepta, el catch
    // muestra un mensaje entendible.
    const customerId = user?.id ?? "";
    try {
      await waitlistService.join({
        serviceId: selectedService.id,
        customerId,
        desiredDate: date,
      });
      trackEvent("waitlist_joined", { code, service_id: selectedService.id });
      setWaitlistJoined(true);
    } catch (err: any) {
      const apiCode = err?.response?.data?.error?.code;
      if (err?.response?.status === 409 || apiCode === "CUSTOMER_HAS_DEBT") {
        setWaitlistError(
          "No puedes anotarte en la lista de espera porque tienes un pago pendiente. Contacta al negocio para regularizarlo."
        );
      } else {
        setWaitlistError(
          readError(err, "No se pudo anotar en la lista de espera. Intenta de nuevo o contacta al negocio.")
        );
      }
    } finally {
      setJoiningWaitlist(false);
    }
  };

  // ---- Branding premium (solo si el tenant es premium efectivo) ----
  const isPremium = Boolean(info?.is_premium);
  // El bloque de AdSense solo aparece si esta configurado (sin placeholder vacio).
  const adsEnabled = Boolean(import.meta.env.VITE_ADSENSE_CLIENT);
  const branding = isPremium ? info?.branding : undefined;
  const ads = isPremium ? info?.ads : undefined;
  // Promociones vigentes (Req 5.1). El backend solo las envia si el negocio es
  // premium; si no hay, la seccion no se renderiza (sin hueco).
  const promotions = info?.promotions ?? [];
  const brandColor = safeBrandColor(branding?.brand_color);
  const accent = brandColor || "var(--brand)";
  const logoUrl = branding?.logo_url || null;
  const bannerTitle = branding?.banner_title || null;
  const bannerText = branding?.banner_text || null;
  const bannerLink = branding?.banner_link || null;
  const hasBanner = Boolean(bannerTitle || bannerText);

  // El color de marca se aplica SOLO dentro del contenedor del portal via una
  // variable CSS local, para no alterar el tema global.
  const portalAccentStyle: CSSProperties = { ["--portal-accent" as any]: accent };

  // ---- Render de estados globales ----
  if (loadingInfo) {
    return (
      <div style={styles.centered}>
        <Spinner size={32} thickness={3} />
        <span style={{ ...subtitle, marginTop: 12 }}>Cargando...</span>
      </div>
    );
  }

  if (invalidCode) {
    return (
      <div style={styles.centered}>
        <div style={{ ...card, ...styles.messageCard }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
          <h2 style={{ ...pageTitle, fontSize: 20 }}>Codigo no valido</h2>
          <p style={{ ...subtitle, marginTop: 8 }}>El codigo "{code}" no corresponde a ningun negocio activo.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
            <button style={btn("ghost")} onClick={goBack} aria-label="Volver">
              ← Volver
            </button>
            <button style={btn("primary")} onClick={() => navigate("/buscar")}>
              Buscar sucursal
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (infoError) {
    return (
      <div style={styles.centered}>
        <div style={{ ...card, ...styles.messageCard }}>
          <p style={{ color: "var(--danger)", marginBottom: 14 }}>{infoError}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button style={btn("ghost")} onClick={goBack} aria-label="Volver">
              ← Volver
            </button>
            <button style={btn("secondary")} onClick={loadInfo}>
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.page, ...portalAccentStyle }}>
      <button type="button" style={styles.backBtn} onClick={goBack} aria-label="Volver">
        ← Volver
      </button>

      <div style={styles.header} className="reveal">
        <div style={styles.headerMain}>
          {logoUrl && (
            <img
              src={logoUrl}
              alt={info?.business?.name || "Logo"}
              style={styles.logo}
              loading="lazy"
            />
          )}
          <div>
            <h1 style={pageTitle}>{info?.business?.name}</h1>
            <p style={subtitle}>
              {info?.branch?.name ? `${info.branch.name} · ` : ""}Agenda tu cita en unos pasos
            </p>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Banner promocional del emprendedor (premium). No intrusivo, integrado al diseno. */}
      {hasBanner && (
        bannerLink ? (
          <a
            href={bannerLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...styles.banner, borderLeft: `4px solid ${accent}`, textDecoration: "none" }}
          >
            {bannerTitle && <div style={styles.bannerTitle}>{bannerTitle}</div>}
            {bannerText && <p style={styles.bannerText}>{bannerText}</p>}
          </a>
        ) : (
          <div style={{ ...styles.banner, borderLeft: `4px solid ${accent}` }}>
            {bannerTitle && <div style={styles.bannerTitle}>{bannerTitle}</div>}
            {bannerText && <p style={styles.bannerText}>{bannerText}</p>}
          </div>
        )
      )}

      {/* Promociones vigentes del negocio (premium). Se muestran encima del flujo
          de reserva; si no hay, la seccion no aparece. No bloquea la reserva. */}
      {promotions.length > 0 && (
        <section style={styles.section} aria-labelledby="promos-title">
          <h2 id="promos-title" style={styles.stepTitle}>
            Promociones
          </h2>
          <div style={styles.promosGrid}>
            {promotions.map((promo) => {
              const validity = promoValidity(promo.starts_at, promo.ends_at);
              return (
                <div key={promo.id} style={{ ...card, ...styles.promoCard }} className="lift zoom-parent">
                  {promo.image_url && (
                    <img
                      src={promo.image_url}
                      alt={promo.title}
                      style={styles.promoImage}
                      className="zoom-img"
                      loading="lazy"
                    />
                  )}
                  <div style={styles.promoBody}>
                    <span style={{ ...styles.promoTag, background: accent }}>🏷️ Promocion</span>
                    <div style={styles.promoTitle}>{promo.title}</div>
                    {promo.description && <p style={styles.promoText}>{promo.description}</p>}
                    {validity && <p style={styles.promoValidity}>{validity}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {confirmed ? (
        <div style={{ ...card, ...styles.confirmCard }} className="reveal-pop">
          <div style={{ fontSize: 46, marginBottom: 10 }}>✅</div>
          <h2 style={{ ...pageTitle, fontSize: 22 }}>¡Tu cita fue agendada!</h2>
          <div style={styles.confirmDetails}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Negocio</span>
              <span style={styles.detailValue}>{info?.business?.name}</span>
            </div>
            {info?.branch?.name && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Sucursal</span>
                <span style={styles.detailValue}>{info.branch.name}</span>
              </div>
            )}
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Categoria</span>
              <span style={styles.detailValue}>{selectedService?.name}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Fecha</span>
              <span style={styles.detailValue}>
                {selectedSlot ? new Date(selectedSlot.start).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : date}
              </span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Hora</span>
              <span style={styles.detailValue}>
                {selectedSlot ? `${formatTime(selectedSlot.start)} - ${formatTime(selectedSlot.end)}` : ""}
              </span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Modalidad</span>
              <span style={styles.detailValue}>{modality === "online" ? "En linea" : "Presencial"}</span>
            </div>
          </div>

          {/* Enlace de Google Meet para citas en linea (si el backend ya lo genero). */}
          {videoCallUrl && (
            <a
              href={videoCallUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...btn("secondary"), marginTop: 16, textDecoration: "none", width: "100%" }}
            >
              🎥 Unirse por Google Meet
            </a>
          )}

          <Link to="/mis-citas" style={{ ...btn("primary"), marginTop: 20, textDecoration: "none" }}>
            Ver mis citas
          </Link>
        </div>
      ) : (
        <>
          {/* Paso 1: Categorias */}
          <section style={styles.section} className="reveal">
            <div style={styles.stepTitle}>1. Elige una categoria</div>
            {info?.services?.length ? (
              <div style={styles.serviceGrid}>
                {info.services.map((s) => {
                  const active = selectedService?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelectService(s)}
                      className="lift focusable"
                      style={{
                        ...styles.serviceCard,
                        borderColor: active ? "var(--portal-accent)" : "var(--border)",
                        background: active ? "var(--brand-soft)" : "var(--surface)",
                      }}
                    >
                      <span style={styles.serviceName}>{s.name}</span>
                      <span style={subtitle}>{s.duration_mins} min</span>
                      <span style={styles.servicePrice}>${s.price}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ ...card, padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                Este negocio aun no tiene categorias disponibles.
              </div>
            )}
          </section>

          {/* Paso 2: Fecha y slots */}
          {selectedService && (
            <section style={styles.section} className="reveal">
              <div style={styles.stepTitle}>2. Elige una fecha</div>
              <input
                type="date"
                value={date}
                min={todayISO()}
                onChange={(e) => handleDateChange(e.target.value)}
                style={styles.dateInput}
                aria-label="Fecha de la cita"
              />

              {date && (
                <div style={{ marginTop: 16 }}>
                  {loadingSlots && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
                      <Spinner /> Cargando horarios...
                    </div>
                  )}
                  {slotsError && !loadingSlots && (
                    <p style={{ color: "var(--danger)" }}>{slotsError}</p>
                  )}
                  {!loadingSlots && !slotsError && slots.length === 0 && (
                    <div style={{ ...card, padding: 18 }}>
                      <p style={{ ...subtitle, marginBottom: 12 }}>
                        No hay horarios disponibles para esta fecha.
                      </p>
                      {waitlistJoined ? (
                        <div style={styles.waitlistOk} role="status">
                          ✅ Te anotamos en la lista de espera. Te avisaremos si se abre un espacio.
                        </div>
                      ) : (
                        <>
                          <p style={{ ...subtitle, marginBottom: 12 }}>
                            ¿Quieres que te avisemos si se libera un espacio ese dia?
                          </p>
                          {waitlistError && (
                            <div style={styles.errorBox} role="alert">
                              {waitlistError}
                            </div>
                          )}
                          {isAuthenticated ? (
                            <button
                              type="button"
                              style={{ ...btn("secondary"), width: "100%" }}
                              onClick={handleJoinWaitlist}
                              disabled={joiningWaitlist}
                              aria-busy={joiningWaitlist}
                            >
                              {joiningWaitlist ? (
                                <>
                                  <Spinner size={16} /> Anotando...
                                </>
                              ) : (
                                "Anotarme en lista de espera"
                              )}
                            </button>
                          ) : (
                            <>
                              <p style={{ ...subtitle, marginBottom: 10 }}>
                                Inicia sesion para anotarte en la lista de espera.
                              </p>
                              <button
                                type="button"
                                style={{ ...btn("secondary"), width: "100%" }}
                                onClick={handleGoogleLogin}
                                disabled={loggingIn}
                                aria-busy={loggingIn}
                              >
                                {loggingIn ? (
                                  <>
                                    <Spinner size={16} /> Conectando...
                                  </>
                                ) : (
                                  "Continuar con Google"
                                )}
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {!loadingSlots && slots.length > 0 && (
                    <div style={styles.slotGrid}>
                      {slots.map((slot) => {
                        const active = selectedSlot?.start === slot.start;
                        return (
                          <button
                            key={slot.start}
                            type="button"
                            onClick={() => {
                              setSelectedSlot(slot);
                              setBookError("");
                            }}
                            style={{
                              ...styles.slotBtn,
                              borderColor: active ? "var(--portal-accent)" : "var(--border-strong)",
                              background: active ? "var(--portal-accent)" : "var(--surface)",
                              color: active ? "var(--brand-contrast)" : "var(--text)",
                            }}
                          >
                            {formatTime(slot.start)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Paso 3: Confirmar */}
          {selectedSlot && (
            <section style={styles.section} className="reveal">
              <div style={styles.stepTitle}>3. Confirma tu cita</div>
              <div style={{ ...card, padding: 20 }}>
                <p style={{ color: "var(--text)", marginBottom: 4 }}>
                  <strong>{selectedService?.name}</strong>
                </p>
                <p style={{ ...subtitle, marginBottom: 16 }}>
                  {new Date(selectedSlot.start).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} ·{" "}
                  {formatTime(selectedSlot.start)} - {formatTime(selectedSlot.end)}
                </p>

                {/* Selector de modalidad: siempre disponible para el cliente (Req 4.3). */}
                <div style={{ marginBottom: 16 }}>
                  <p style={{ ...subtitle, marginBottom: 8 }}>¿Como sera tu cita?</p>
                  <div style={styles.modalityGroup}>
                    {([
                      { key: "in_person", label: "Presencial" },
                      { key: "online", label: "En linea" },
                    ] as const).map((opt) => {
                      const active = modality === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setModality(opt.key)}
                          aria-pressed={active}
                          style={{
                            ...styles.modalityBtn,
                            borderColor: active ? "var(--portal-accent)" : "var(--border-strong)",
                            background: active ? "var(--portal-accent)" : "var(--surface)",
                            color: active ? "var(--brand-contrast)" : "var(--text)",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {bookError && (
                  <div style={styles.errorBox} role="alert">{bookError}</div>
                )}

                {isAuthenticated ? (
                  <button
                    type="button"
                    style={{ ...btn("primary"), width: "100%" }}
                    onClick={handleConfirm}
                    disabled={booking}
                    aria-busy={booking}
                  >
                    {booking ? (
                      <>
                        <Spinner size={16} /> Agendando...
                      </>
                    ) : (
                      "Confirmar cita"
                    )}
                  </button>
                ) : (
                  <>
                    <p style={{ ...subtitle, marginBottom: 10 }}>Inicia sesion para confirmar tu reserva.</p>
                    <button
                      type="button"
                      style={{ ...btn("secondary"), width: "100%" }}
                      onClick={handleGoogleLogin}
                      disabled={loggingIn}
                      aria-busy={loggingIn}
                    >
                      {loggingIn ? (
                        <>
                          <Spinner size={16} /> Conectando...
                        </>
                      ) : (
                        "Continuar con Google"
                      )}
                    </button>
                  </>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* Promociones propias del emprendedor (premium). No bloquean el flujo de reserva. */}
      {ads && ads.length > 0 && (
        <section style={styles.section} aria-label="Promociones">
          <div style={styles.stepTitle}>Promociones</div>
          <div style={styles.adsGrid}>
            {ads.map((ad) => (
              <PromoCard
                key={ad.id}
                title={ad.title}
                body={ad.body ?? undefined}
                imageUrl={ad.image_url ?? undefined}
                linkUrl={ad.link_url ?? undefined}
                brandColor={brandColor ?? undefined}
              />
            ))}
          </div>
        </section>
      )}

      {/* Portal no premium: espacio de AdSense discreto y claramente etiquetado.
          AdSlot no renderiza nada en produccion si VITE_ADSENSE_CLIENT no esta definido. */}
      {!isPremium && adsEnabled && (
        <section style={styles.section} aria-label="Publicidad">
          <AdSlot />
        </section>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto", padding: "28px 20px 60px" },
  backBtn: { ...btn("ghost"), padding: "6px 12px", marginBottom: 16 },
  centered: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    background: "var(--bg)",
  },
  messageCard: { padding: 32, maxWidth: 420, textAlign: "center" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24 },
  headerMain: { display: "flex", alignItems: "center", gap: 14, minWidth: 0 },
  logo: { height: 44, width: "auto", maxWidth: 140, objectFit: "contain", borderRadius: "var(--radius-sm)", flexShrink: 0 },
  banner: {
    ...card,
    padding: "16px 18px",
    marginBottom: 24,
    display: "block",
    color: "inherit",
  },
  bannerTitle: { fontSize: 16, fontWeight: 700, color: "var(--text)" },
  bannerText: { fontSize: 14, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 },
  adsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 },
  promosGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 },
  promoCard: { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" },
  promoImage: { width: "100%", height: 140, objectFit: "cover", display: "block" },
  promoBody: { padding: 16, display: "flex", flexDirection: "column", gap: 6 },
  promoTag: {
    alignSelf: "flex-start",
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#fff",
  },
  promoTitle: { fontSize: 16, fontWeight: 700, color: "var(--text)" },
  promoText: { fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 },
  promoValidity: { fontSize: 12, fontWeight: 600, color: "var(--brand)", margin: 0 },
  section: { marginBottom: 28 },
  stepTitle: { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 12 },
  serviceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 },
  serviceCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    padding: 16,
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s ease, background-color 0.15s ease",
  },
  serviceName: { fontSize: 15, fontWeight: 700, color: "var(--text)" },
  servicePrice: { fontSize: 15, fontWeight: 700, color: "var(--brand)", marginTop: 4 },
  dateInput: {
    padding: "10px 12px",
    fontSize: 15,
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
  },
  slotGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 10 },
  modalityGroup: { display: "flex", gap: 10 },
  modalityBtn: {
    flex: 1,
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-strong)",
    cursor: "pointer",
    transition: "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease",
  },
  slotBtn: {
    padding: "10px 8px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-strong)",
    cursor: "pointer",
    transition: "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease",
  },
  confirmCard: { padding: 32, textAlign: "center", maxWidth: 480, margin: "0 auto" },
  confirmDetails: { marginTop: 18, textAlign: "left" },
  detailRow: { display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" },
  detailLabel: { fontSize: 13, color: "var(--text-muted)" },
  detailValue: { fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: "right" },
  errorBox: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    padding: 12,
    borderRadius: "var(--radius-sm)",
    marginBottom: 14,
    fontSize: 14,
  },
  waitlistOk: {
    background: "var(--success-soft)",
    color: "var(--success)",
    padding: 12,
    borderRadius: "var(--radius-sm)",
    fontSize: 14,
    fontWeight: 600,
  },
};
