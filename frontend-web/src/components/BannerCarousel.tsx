import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DiscoverItem, LandingBanner } from "../services/public.service";

interface BannerCarouselProps {
  // Banners gestionados por el Super Admin. Se muestran PRIMERO en el carrusel.
  // Opcional: si no viene, el carrusel solo muestra los premium.
  banners?: LandingBanner[];
  // Items YA filtrados por el padre a "premium con banner". Se muestran DESPUES
  // de los banners del admin. Si viene vacio (y sin banners), el componente no
  // renderiza nada (Req 1.5).
  items: DiscoverItem[];
  // El padre decide la navegacion de un item premium (p.ej. /reservar/:code).
  onSelect: (item: DiscoverItem) => void;
  // El padre decide que hacer al pulsar un banner del admin (abrir link_url, etc.).
  onBannerClick?: (banner: LandingBanner) => void;
}

// Intervalo de autoplay (ms).
const AUTOPLAY_MS = 5000;

// Modelo unificado de slide: un banner del admin o un negocio premium.
type Slide =
  | {
      kind: "banner";
      key: string;
      title: string;
      text: string;
      logo: string | null;
      image: string | null;
      accent: string;
      banner: LandingBanner;
    }
  | {
      kind: "premium";
      key: string;
      title: string;
      text: string;
      logo: string | null;
      image: string | null;
      accent: string;
      item: DiscoverItem;
    };

// ¿El usuario prefiere movimiento reducido? Si es asi, desactivamos autoplay y
// transiciones (Req 2.2 / accesibilidad). Evaluado de forma defensiva por si el
// entorno no soporta matchMedia.
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Color de acento seguro: usa el brand_color del item o cae al token de marca.
function accent(color: string | null | undefined): string {
  const c = (color ?? "").trim();
  return c.length > 0 ? c : "var(--brand)";
}

/**
 * Carrusel de banners del landing (Req 1.x, 2.x).
 *
 * - Presentacional: recibe banners del Super Admin (primero) y negocios premium
 *   ya filtrados (despues), mas los callbacks de navegacion.
 * - Muestra un slide a la vez con transicion de opacidad (fade) y un sutil zoom
 *   del fondo al entrar.
 * - Autoplay ~5s; PAUSA en hover y en focus dentro del contenedor.
 * - Respeta prefers-reduced-motion: sin autoplay ni transiciones bruscas.
 * - Navegacion: botones prev/next, dots clicables y flechas del teclado.
 * - Cada slide es un boton accesible.
 */
export default function BannerCarousel({ banners, items, onSelect, onBannerClick }: BannerCarouselProps) {
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Componemos la lista: [banners del admin] seguidos de [premium con branding].
  const slides = useMemo<Slide[]>(() => {
    const adminSlides: Slide[] = (banners ?? []).map((b) => ({
      kind: "banner" as const,
      key: `banner-${b.id}`,
      title: b.title,
      text: b.subtitle ?? "",
      logo: null,
      image: b.image_url,
      accent: "var(--brand)",
      banner: b,
    }));
    const premiumSlides: Slide[] = items.map((it) => ({
      kind: "premium" as const,
      key: `premium-${it.code}`,
      title: it.branding?.banner_title || it.business_name,
      text: it.branding?.banner_text || "",
      logo: it.branding?.logo_url || null,
      image: null,
      accent: accent(it.branding?.brand_color),
      item: it,
    }));
    return [...adminSlides, ...premiumSlides];
  }, [banners, items]);

  const count = slides.length;

  // Si cambia la cantidad de slides, mantenemos el indice en rango.
  useEffect(() => {
    setIndex((prev) => (count === 0 ? 0 : prev % count));
  }, [count]);

  const goTo = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count]
  );

  const prev = useCallback(() => goTo(index - 1), [goTo, index]);
  const next = useCallback(() => goTo(index + 1), [goTo, index]);

  // Autoplay: solo cuando hay mas de un slide, no esta pausado y el usuario no
  // pidio movimiento reducido. Limpieza del interval en cada cambio de deps y al
  // desmontar (sin fugas, sin bucles).
  useEffect(() => {
    if (reducedMotion || paused || count <= 1) return;
    const id = window.setInterval(() => {
      setIndex((prevIdx) => (prevIdx + 1) % count);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [reducedMotion, paused, count]);

  // Flechas del teclado cuando el foco esta dentro del carrusel.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (count <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    },
    [count, prev, next]
  );

  // Nada que mostrar (Req 1.5).
  if (count === 0) return null;

  const pauseOn = () => setPaused(true);
  const resumeOff = () => setPaused(false);

  const activate = (slide: Slide) => {
    if (slide.kind === "premium") onSelect(slide.item);
    else onBannerClick?.(slide.banner);
  };

  return (
    <section
      style={styles.wrap}
      aria-roledescription="carrusel"
      aria-label="Destacados"
      onMouseEnter={pauseOn}
      onMouseLeave={resumeOff}
      onFocus={pauseOn}
      onBlur={resumeOff}
      onKeyDown={onKeyDown}
    >
      <div style={styles.viewport}>
        {slides.map((slide, i) => {
          const active = i === index;
          const ariaLabel =
            slide.kind === "premium"
              ? `Ver ${slide.item.business_name}`
              : slide.banner.link_url
              ? `Abrir ${slide.title}`
              : slide.title;
          return (
            <button
              key={slide.key}
              type="button"
              onClick={() => activate(slide)}
              aria-label={ariaLabel}
              aria-hidden={!active}
              tabIndex={active ? 0 : -1}
              style={{
                ...styles.slide,
                background: slide.accent,
                opacity: active ? 1 : 0,
                pointerEvents: active ? "auto" : "none",
                transition: reducedMotion ? "none" : "opacity 0.6s ease",
                zIndex: active ? 2 : 1,
              }}
            >
              {/* Imagen de fondo (banners del admin). Zoom sutil al entrar. */}
              {slide.image && (
                <img
                  src={slide.image}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  style={{
                    ...styles.bgImage,
                    transform: active && !reducedMotion ? "scale(1.05)" : "scale(1)",
                    transition: reducedMotion ? "none" : "transform 6s ease-out",
                  }}
                />
              )}
              {/* Capa de oscurecimiento para asegurar contraste del texto. */}
              <span style={styles.overlay} aria-hidden="true" />
              <span style={styles.slideContent}>
                {slide.logo && (
                  <img src={slide.logo} alt="" aria-hidden="true" style={styles.logo} loading="lazy" />
                )}
                <span style={styles.textCol}>
                  <span style={styles.bannerTitle}>{slide.title}</span>
                  {slide.text && <span style={styles.bannerText}>{slide.text}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Controles: solo tienen sentido con mas de un slide. */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Anterior"
            style={{ ...styles.navBtn, ...styles.navPrev }}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Siguiente"
            style={{ ...styles.navBtn, ...styles.navNext }}
          >
            ›
          </button>

          <div style={styles.dots} role="tablist" aria-label="Seleccionar destacado">
            {slides.map((slide, i) => {
              const activeDot = i === index;
              return (
                <button
                  key={slide.key}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Ir al destacado ${i + 1}`}
                  aria-current={activeDot ? "true" : undefined}
                  style={{
                    ...styles.dot,
                    ...(activeDot ? styles.dotActive : {}),
                  }}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: "relative",
    width: "100%",
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    boxShadow: "var(--shadow-md)",
    margin: "0 auto",
  },
  viewport: {
    position: "relative",
    width: "100%",
    height: "clamp(200px, 32vw, 300px)",
  },
  slide: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: 0,
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "#fff",
    overflow: "hidden",
  },
  bgImage: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    zIndex: 0,
  },
  overlay: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    background: "linear-gradient(90deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.30) 55%, rgba(0,0,0,0.12) 100%)",
  },
  slideContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "0 clamp(24px, 6vw, 56px)",
    maxWidth: "100%",
  },
  logo: {
    width: "clamp(56px, 12vw, 88px)",
    height: "clamp(56px, 12vw, 88px)",
    borderRadius: 16,
    objectFit: "cover",
    background: "rgba(255,255,255,0.15)",
    flexShrink: 0,
    boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
  },
  textCol: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: "clamp(22px, 4vw, 36px)",
    fontWeight: 800,
    lineHeight: 1.12,
    letterSpacing: "-0.015em",
    textShadow: "0 2px 6px rgba(0,0,0,0.45)",
  },
  bannerText: {
    fontSize: "clamp(14px, 2.2vw, 18px)",
    fontWeight: 500,
    lineHeight: 1.4,
    opacity: 0.96,
    textShadow: "0 1px 3px rgba(0,0,0,0.45)",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  navBtn: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 3,
    width: 42,
    height: 42,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(0,0,0,0.4)",
    color: "#fff",
    fontSize: 24,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    backdropFilter: "blur(4px)",
    transition: "background-color 0.2s ease, transform 0.2s ease",
  },
  navPrev: { left: 12 },
  navNext: { right: 12 },
  dots: {
    position: "absolute",
    bottom: 14,
    left: 0,
    right: 0,
    zIndex: 3,
    display: "flex",
    justifyContent: "center",
    gap: 8,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    border: "none",
    padding: 0,
    background: "rgba(255,255,255,0.55)",
    cursor: "pointer",
    transition: "background-color 0.2s ease, transform 0.2s ease, width 0.2s ease",
  },
  dotActive: {
    background: "#fff",
    width: 24,
  },
};
