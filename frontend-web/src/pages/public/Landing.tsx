import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import ThemeToggle from "../../components/ThemeToggle";
import ClientNav from "../../components/ClientNav";
import AdSlot from "../../components/ads/AdSlot";
import BannerCarousel from "../../components/BannerCarousel";
import { trackEvent } from "../../lib/firebase";
import { useAuthStore } from "../../store/useAuthStore";
import { publicBookingService } from "../../services/public.service";
import type { DiscoverItem, LandingBanner } from "../../services/public.service";
import { card, btn, pageTitle, subtitle, emptyState } from "../../ui/ui";

interface Benefit {
  title: string;
  text: string;
  icon: string;
}

const BENEFITS: Benefit[] = [
  {
    title: "Reserva en segundos",
    text: "Elige el servicio, el dia y la hora desde tu celular. Sin llamadas ni esperas.",
    icon: "⚡",
  },
  {
    title: "Elige tu horario",
    text: "Mira los horarios disponibles en tiempo real y agenda el que mejor te acomode.",
    icon: "🗓️",
  },
  {
    title: "Recordatorios",
    text: "Recibe la confirmacion de tu cita y recordatorios para no olvidarla.",
    icon: "🔔",
  },
];

// Coordenadas del cliente (geolocalizacion del navegador).
interface Coords {
  lat: number;
  lng: number;
}

// Estado de la geolocalizacion: idle (sin activar), loading (resolviendo),
// active (ordenando por cercania), error (no se pudo obtener).
type GeoStatus = "idle" | "loading" | "active" | "error";

// Formatea una distancia en km con un decimal ("a 1.2 km").
function formatDistance(km: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  return `a ${km.toFixed(1)} km`;
}

// Convierte un color de marca a algo seguro para usar como acento. Si es
// invalido/ausente cae al color de marca del tema.
function accentColor(brand: string | null | undefined): string {
  const c = (brand ?? "").trim();
  return c.length > 0 ? c : "var(--brand)";
}

// Formatea el promedio de calificacion a un decimal ("4.5"). null/invalido -> null.
function formatRating(avg: number | null): string | null {
  if (avg == null || !Number.isFinite(avg)) return null;
  return avg.toFixed(1);
}

/**
 * Landing publica de descubrimiento (Req 4, 5, 8). Puerta de entrada del cliente
 * NO autenticado: hero con buscador prominente, chips de categoria, boton
 * "Cerca de mi" (geolocalizacion), grid de negocios (tarjeta premium destacada /
 * tarjeta free simple) y una seccion "Podria interesarte". Tema-aware y responsiva.
 */
export default function Landing() {
  const navigate = useNavigate();
  const adsEnabled = Boolean(import.meta.env.VITE_ADSENSE_CLIENT);

  // Sesion: cuando el visitante es un CLIENT autenticado, la landing pasa a ser
  // su "home" (menu de cliente arriba + orden por cercania por defecto).
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const isClient = isAuthenticated && role === "CLIENT";

  // --- Estado de filtros ---
  const [query, setQuery] = useState(""); // texto tal como se escribe
  const [debouncedQuery, setDebouncedQuery] = useState(""); // texto con debounce (~300ms)
  const [category, setCategory] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");

  // --- Datos ---
  const [categories, setCategories] = useState<string[]>([]);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Marca si la ultima carga de descubrimiento fallo, para distinguir "sin
  // resultados" (vacio real) de un error de red y ofrecer reintentar.
  const [loadError, setLoadError] = useState(false);
  // Contador que, al incrementarse, fuerza a reintentar la carga de descubrimiento.
  const [reloadTick, setReloadTick] = useState(0);
  const [suggestions, setSuggestions] = useState<DiscoverItem[]>([]);
  // Banners del carrusel gestionados por el Super Admin (se muestran primero).
  const [adminBanners, setAdminBanners] = useState<LandingBanner[]>([]);

  // Evita que respuestas de discover fuera de orden pisen a las mas recientes.
  const requestSeq = useRef(0);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Landing" });
  }, []);

  // Carga las categorias una sola vez al montar (para los chips).
  useEffect(() => {
    let alive = true;
    publicBookingService
      .getCategories()
      .then((cats) => {
        if (alive) setCategories(cats);
      })
      .catch(() => {
        if (alive) setCategories([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Carga una sola vez los banners del carrusel gestionados por el Super Admin.
  // Ante cualquier error caemos a [] (el carrusel usa los premium como respaldo).
  useEffect(() => {
    let alive = true;
    publicBookingService
      .getLandingBanners()
      .then((banners) => {
        if (alive) setAdminBanners(banners);
      })
      .catch(() => {
        if (alive) setAdminBanners([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Debounce del texto de busqueda: solo consultamos ~300ms despues de dejar de escribir.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const hasActiveFilters = debouncedQuery.length > 0 || category != null;

  // Consulta principal de descubrimiento. Se dispara cuando cambian los filtros
  // relevantes: texto (debounced), categoria o coordenadas. Deps controladas
  // para NO entrar en bucle.
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(false);
    publicBookingService
      .discover({
        q: debouncedQuery || undefined,
        category: category ?? undefined,
        lat: coords?.lat,
        lng: coords?.lng,
      })
      .then((res) => {
        if (seq !== requestSeq.current) return; // respuesta obsoleta
        setItems(res);
        setLoadError(false);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setItems([]);
        setLoadError(true);
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [debouncedQuery, category, coords, reloadTick]);

  // Seccion "Podria interesarte" (Req 4): solo cuando hay categoria/q activa y hay
  // resultados. Segunda consulta por la MISMA categoria (o, si solo hay texto, la
  // categoria del primer resultado como semilla), excluyendo los codes ya mostrados.
  useEffect(() => {
    // Sin filtros activos o sin resultados: no hay sugerencias.
    if (!hasActiveFilters || items.length === 0) {
      setSuggestions([]);
      return;
    }
    const seedCategory = category ?? items[0]?.categories?.[0] ?? null;
    if (!seedCategory) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const shownCodes = new Set(items.map((i) => i.code));
    publicBookingService
      .discover({ category: seedCategory })
      .then((res) => {
        if (!alive) return;
        // Excluir los ya mostrados en el grid principal; premium ya viene primero.
        const fresh = res.filter((i) => !shownCodes.has(i.code)).slice(0, 6);
        setSuggestions(fresh);
      })
      .catch(() => {
        if (alive) setSuggestions([]);
      });
    return () => {
      alive = false;
    };
  }, [hasActiveFilters, category, items]);

  // Alterna una categoria (toggle). Volver a tocar el chip activo lo deselecciona.
  const toggleCategory = useCallback((cat: string) => {
    setCategory((prev) => (prev === cat ? null : cat));
    trackEvent("landing_filter", { type: "category", value: cat });
  }, []);

  // Limpia el filtro de categoria ("Todas").
  const clearCategory = useCallback(() => setCategory(null), []);

  // Activa "Cerca de mi": pide geolocalizacion al navegador. En exito ordena por
  // cercania; en error/no-soporte muestra un aviso discreto y usa orden normal.
  const enableNearby = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("error");
      return;
    }
    setGeoStatus("loading");
    trackEvent("landing_cta", { cta: "cerca_de_mi" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("active");
      },
      () => {
        // Permiso negado o error: no rompemos la pagina, caemos a orden normal.
        setCoords(null);
        setGeoStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Desactiva la cercania y vuelve al orden normal.
  const disableNearby = useCallback(() => {
    setCoords(null);
    setGeoStatus("idle");
  }, []);

  // Auto-cercania para el CLIENT autenticado: al ser su "home", intentamos ordenar
  // por cercania sin que tenga que pulsar el boton. Guard con ref para dispararlo
  // UNA sola vez y solo si aun no ha activado/intentado geolocalizacion (idle).
  // Para visitantes anonimos NO se auto-solicita (seria intrusivo). Si el navegador
  // niega el permiso, enableNearby cae al aviso discreto + orden normal (no rompe).
  const autoNearbyTried = useRef(false);
  useEffect(() => {
    if (!isClient) return;
    if (autoNearbyTried.current) return;
    if (geoStatus !== "idle") return;
    autoNearbyTried.current = true;
    enableNearby();
  }, [isClient, geoStatus, enableNearby]);

  // Limpia TODOS los filtros (texto, categoria y cercania).
  const clearAllFilters = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setCategory(null);
    setCoords(null);
    setGeoStatus("idle");
  }, []);

  const goToBooking = useCallback(
    (item: DiscoverItem) => {
      trackEvent("landing_card_click", { code: item.code, premium: item.is_premium });
      navigate(`/reservar/${encodeURIComponent(item.code)}`);
    },
    [navigate]
  );

  // Click en un banner del Super Admin: si trae link_url lo abrimos de forma
  // segura (interno via router / externo en pestana nueva). Si no, sin accion.
  const onBannerClick = useCallback(
    (banner: LandingBanner) => {
      const url = (banner.link_url ?? "").trim();
      if (!url) return;
      trackEvent("landing_banner_click", { id: banner.id });
      // URL absoluta -> destino externo en pestana nueva; ruta relativa -> router.
      if (/^https?:\/\//i.test(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        navigate(url.startsWith("/") ? url : `/${url}`);
      }
    },
    [navigate]
  );

  const showSuggestions = hasActiveFilters && suggestions.length > 0;

  // Items para el carrusel de banners destacados (Req 1.x). Decision de fuente
  // de datos: reutilizamos los `items` del estado actual filtrados a "premium con
  // banner", en lugar de disparar una segunda llamada a discover(). Motivo:
  //   - Cero peticiones extra y sin riesgo de bucles (deps ya controladas arriba).
  //   - Coherencia visual: el carrusel muestra los destacados del mismo conjunto
  //     que el usuario esta viendo.
  // El componente retorna null cuando el arreglo queda vacio, de modo que no deja
  // hueco cuando una busqueda no arroja premium-con-banner.
  const carouselItems = useMemo(
    () =>
      items.filter(
        (i) =>
          i.is_premium &&
          i.branding &&
          (i.branding.banner_title || i.branding.banner_text || i.branding.logo_url)
      ),
    [items]
  );

  const resultsHeading = useMemo(() => {
    if (category && debouncedQuery) return `Resultados para "${debouncedQuery}" en ${category}`;
    if (category) return `Negocios de ${category}`;
    if (debouncedQuery) return `Resultados para "${debouncedQuery}"`;
    return "Explora negocios";
  }, [category, debouncedQuery]);

  return (
    <div style={styles.root}>
      {/* Barra superior. Para el CLIENT autenticado mostramos el menu de cliente
          (navegacion consistente); para visitantes anonimos, la barra publica con
          "Iniciar sesion". */}
      {isClient ? (
        <ClientNav />
      ) : (
        <header style={styles.topBar}>
          <span style={styles.brandMark}><img src="/onlyspace.png" alt="onlyspace" style={styles.brandLogoImg} />onlyspace</span>
          <div style={styles.topActions}>
            <ThemeToggle />
            <button style={btn("secondary")} onClick={() => navigate("/login")}>
              Iniciar sesion
            </button>
          </div>
        </header>
      )}

      <main style={styles.main}>
        {/* Hero con buscador prominente */}
        <section style={styles.hero} aria-labelledby="hero-title" className="hero-glow">
          <span style={styles.heroKicker} className="reveal">
            ✨ Reserva en linea, sin complicaciones
          </span>
          <h1
            id="hero-title"
            style={styles.heroTitle}
            className="reveal"
          >
            Reserva tu cita en <span style={styles.heroAccent}>segundos</span>
          </h1>
          <p style={styles.heroTagline} className="reveal">
            Descubre negocios cerca de ti, filtra por categoria y aparta tu espacio al
            instante. Rapido, gratis y sin registros complicados.
          </p>

          {/* Buscador */}
          <div style={{ ...styles.searchRow, ["--reveal-delay" as any]: "80ms" }} className="reveal">
            <div style={styles.searchBox}>
              <span aria-hidden="true" style={styles.searchIcon}>
                🔍
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busca por negocio, servicio o categoria"
                aria-label="Buscar negocios"
                style={styles.searchInput}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Limpiar busqueda"
                  style={styles.searchClear}
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="button"
              style={{ ...btn("secondary"), ...styles.codeBtn }}
              onClick={() => {
                trackEvent("landing_cta", { cta: "codigo" });
                navigate("/codigo");
              }}
            >
              Tengo un codigo
            </button>
          </div>

          {/* Cerca de mi + estado */}
          <div style={{ ...styles.nearbyRow, ["--reveal-delay" as any]: "140ms" }} className="reveal">
            {geoStatus === "active" ? (
              <>
                <span style={styles.nearbyActive} role="status">
                  📍 Ordenando por cercania
                </span>
                <button
                  type="button"
                  style={{ ...btn("ghost"), ...styles.nearbyToggleOff }}
                  onClick={disableNearby}
                >
                  Desactivar
                </button>
              </>
            ) : (
              <button
                type="button"
                style={{ ...btn("secondary"), ...styles.nearbyBtn }}
                onClick={enableNearby}
                disabled={geoStatus === "loading"}
                aria-busy={geoStatus === "loading"}
              >
                {geoStatus === "loading" ? "Ubicandote..." : "📍 Cerca de mi"}
              </button>
            )}
          </div>
          {geoStatus === "error" && (
            <p style={styles.geoNotice} role="status">
              No pudimos obtener tu ubicacion; mostrando resultados destacados.
            </p>
          )}
        </section>

        {/* Carrusel de destacados (Req 1.x): primero los banners del Super Admin
            y luego los negocios premium-con-branding. Si ambos estan vacios,
            BannerCarousel retorna null (sin hueco). */}
        {!loading && (adminBanners.length > 0 || carouselItems.length > 0) && (
          <section style={styles.carouselSection} aria-label="Destacados" className="reveal">
            <BannerCarousel
              banners={adminBanners}
              items={carouselItems}
              onSelect={goToBooking}
              onBannerClick={onBannerClick}
            />
          </section>
        )}

        {/* Chips de categoria */}
        {categories.length > 0 && (
          <section style={styles.chipsSection} aria-label="Filtrar por categoria" className="reveal">
            <div style={styles.chipsRow}>
              <button
                type="button"
                onClick={clearCategory}
                aria-pressed={category == null}
                style={category == null ? { ...styles.chip, ...styles.chipActive } : styles.chip}
              >
                Todas
              </button>
              {categories.map((cat) => {
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    aria-pressed={active}
                    style={active ? { ...styles.chip, ...styles.chipActive } : styles.chip}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Grid de resultados */}
        <section style={styles.section} aria-labelledby="results-title">
          <div style={styles.sectionHeadRow}>
            <h2 id="results-title" style={styles.sectionTitleLeft}>
              {resultsHeading}
            </h2>
            {(hasActiveFilters || geoStatus === "active") && !loading && (
              <button type="button" style={btn("ghost")} onClick={clearAllFilters}>
                Limpiar filtros
              </button>
            )}
          </div>

          {loading ? (
            <div style={styles.grid} aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ ...card, ...styles.skeletonCard }} className="skeleton-shimmer" />
              ))}
            </div>
          ) : loadError ? (
            <div style={emptyState} role="alert">
              <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                No pudimos cargar los negocios
              </p>
              <p style={{ marginBottom: 18 }}>
                Revisa tu conexion e intentalo de nuevo.
              </p>
              <button type="button" style={btn("primary")} onClick={() => setReloadTick((t) => t + 1)}>
                Reintentar
              </button>
            </div>
          ) : items.length === 0 ? (
            <div style={emptyState}>
              <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                No encontramos negocios con esos filtros
              </p>
              <p style={{ marginBottom: 18 }}>
                Prueba con otra categoria o cambia el texto de busqueda.
              </p>
              <button type="button" style={btn("primary")} onClick={clearAllFilters}>
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div style={styles.grid}>
              {items.map((item, i) => (
                <DiscoverCard key={item.code} item={item} onBook={goToBooking} index={i} />
              ))}
            </div>
          )}
        </section>

        {/* Podria interesarte */}
        {showSuggestions && (
          <section style={styles.section} aria-labelledby="suggest-title">
            <h2 id="suggest-title" style={styles.sectionTitleLeft}>
              Podria interesarte
            </h2>
            <div style={styles.grid}>
              {suggestions.map((item, i) => (
                <DiscoverCard key={item.code} item={item} onBook={goToBooking} index={i} />
              ))}
            </div>
          </section>
        )}

        {/* Beneficios */}
        <section style={styles.section} aria-labelledby="benefits-title">
          <h2 id="benefits-title" style={styles.sectionTitle}>
            Reservar nunca fue tan facil
          </h2>
          <div style={styles.benefitGrid}>
            {BENEFITS.map((b, i) => (
              <div
                key={b.title}
                style={{ ...card, ...styles.benefitCard, ["--reveal-delay" as any]: `${i * 90}ms` }}
                className="reveal lift"
              >
                <span style={styles.benefitIcon} aria-hidden="true">
                  {b.icon}
                </span>
                <div style={styles.benefitTitle}>{b.title}</div>
                <p style={styles.benefitText}>{b.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Espacio publicitario: solo si AdSense esta configurado. */}
        {adsEnabled && (
          <section style={styles.adSection} aria-label="Publicidad">
            <AdSlot style={{ maxWidth: 728, margin: "0 auto" }} />
          </section>
        )}
      </main>

      {/* Pie de pagina */}
      <footer style={styles.footer}>
        <span style={styles.brandMark}><img src="/onlyspace.png" alt="onlyspace" style={styles.brandLogoImg} />onlyspace</span>
        <p style={styles.footerText}>
          © {new Date().getFullYear()} onlyspace · Reserva tu cita en linea.
        </p>
        <button type="button" onClick={() => navigate("/login")} style={styles.footerLink}>
          ¿Tienes un negocio? Inicia sesion aqui
        </button>
      </footer>
    </div>
  );
}

/**
 * Tarjeta de un negocio en el descubrimiento. Premium -> destacada (banner con
 * brand_color, logo, etiqueta "Destacado"); Free -> simple. Toda la tarjeta es un
 * <button> navegable por teclado que lleva a reservar.
 */
function DiscoverCard({
  item,
  onBook,
  index = 0,
}: {
  item: DiscoverItem;
  onBook: (item: DiscoverItem) => void;
  index?: number;
}) {
  const isPremium = item.is_premium && !!item.branding;
  const accent = isPremium ? accentColor(item.branding?.brand_color) : undefined;
  const distance = formatDistance(item.distance_km);
  const location = item.city || item.address || null;
  const cats = item.categories.slice(0, 3);
  const title = isPremium && item.branding?.banner_title ? item.branding.banner_title : item.business_name;
  // Solo mostramos promedio cuando hay al menos una resena (Req 3.5).
  const ratingText = item.rating_count > 0 ? formatRating(item.rating_avg) : null;
  // Promociones vigentes (Req 5.2/5.3). Solo negocios premium traen elementos.
  const promos = item.promotions ?? [];
  const hasPromos = promos.length > 0;
  const firstPromoTitle = promos[0]?.title ?? null;

  const cardStyle: CSSProperties = {
    ...card,
    ...styles.discoverCard,
    ...(isPremium ? { borderColor: accent, boxShadow: "var(--shadow-md, var(--shadow-sm))" } : {}),
    // Escalona la entrada segun la posicion en el grid (limitado para no tardar).
    ["--reveal-delay" as any]: `${Math.min(index, 8) * 60}ms`,
  };

  return (
    <button
      type="button"
      onClick={() => onBook(item)}
      style={cardStyle}
      className="reveal lift zoom-parent focusable"
      aria-label={`Reservar en ${item.business_name}${item.branch_name ? `, ${item.branch_name}` : ""}`}
    >
      {/* Barra/banner de acento para premium */}
      {isPremium && <div style={{ ...styles.accentBar, background: accent }} aria-hidden="true" />}

      <div style={styles.cardBody}>
        <div style={styles.cardHeader}>
          {isPremium && item.branding?.logo_url ? (
            <img
              src={item.branding.logo_url}
              alt={`Logo de ${item.business_name}`}
              style={styles.logo}
              className="zoom-img"
              loading="lazy"
            />
          ) : (
            <div style={styles.logoFallback} aria-hidden="true">
              {item.business_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={styles.cardTitleRow}>
              <span style={styles.cardTitle}>{title}</span>
              {isPremium && (
                <span style={{ ...styles.featuredTag, background: accent }}>★ Destacado</span>
              )}
            </div>
            {item.branch_name && <span style={styles.cardBranch}>{item.branch_name}</span>}
          </div>
        </div>

        {/* Texto de banner premium, si existe */}
        {isPremium && item.branding?.banner_text && (
          <p style={styles.bannerText}>{item.branding.banner_text}</p>
        )}

        {(location || distance) && (
          <div style={styles.metaRow}>
            {location && <span style={styles.metaItem}>📍 {location}</span>}
            {distance && <span style={styles.metaDistance}>{distance}</span>}
          </div>
        )}

        {/* Calificacion (Req 3.5): estrellas + promedio + numero de resenas.
            DiscoverItem no expone tenant_id, por lo que aqui NO se muestra el
            boton de favorito; la gestion de favoritos vive en "Mis citas". */}
        {ratingText ? (
          <div
            style={styles.ratingRow}
            aria-label={`Calificacion ${ratingText} de 5, ${item.rating_count} ${
              item.rating_count === 1 ? "resena" : "resenas"
            }`}
          >
            <span aria-hidden="true" style={styles.ratingStar}>
              ★
            </span>
            <span style={styles.ratingValue}>{ratingText}</span>
            <span style={styles.ratingCount} aria-hidden="true">
              ({item.rating_count})
            </span>
          </div>
        ) : (
          <div style={styles.ratingEmpty} aria-label="Sin resenas">
            Sin resenas
          </div>
        )}

        {/* Indicador discreto de promociones vigentes (premium). Muestra el titulo
            de la primera promo (truncado) o un chip generico si no hay titulo. */}
        {hasPromos && (
          <div style={styles.promoChip} title={firstPromoTitle ?? "Promociones vigentes"}>
            <span aria-hidden="true">🏷️</span>
            <span style={styles.promoChipText}>{firstPromoTitle ?? "Promos"}</span>
          </div>
        )}

        {cats.length > 0 && (
          <div style={styles.cardChips}>
            {cats.map((c) => (
              <span key={c} style={styles.miniChip}>
                {c}
              </span>
            ))}
          </div>
        )}

        <span style={{ ...btn("primary"), ...styles.reserveBtn }} aria-hidden="true">
          Reservar
        </span>
      </div>
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "16px 20px",
    maxWidth: 1040,
    width: "100%",
    margin: "0 auto",
  },
  topActions: { display: "flex", alignItems: "center", gap: 10 },
  brandLogoImg: { width: 26, height: 26, objectFit: "contain", borderRadius: 6 },
  brandMark: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "var(--brand)",
  },
  main: {
    flex: 1,
    width: "100%",
    maxWidth: 1040,
    margin: "0 auto",
    padding: "0 20px",
  },
  hero: {
    textAlign: "center",
    padding: "56px 12px 32px",
    maxWidth: 760,
    margin: "0 auto",
    borderRadius: "var(--radius-lg)",
  },
  heroKicker: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    marginBottom: 18,
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--brand)",
    background: "var(--brand-soft)",
    border: "1px solid var(--brand)",
  },
  heroTitle: {
    ...pageTitle,
    fontSize: "clamp(30px, 6.5vw, 50px)",
    lineHeight: 1.08,
    marginBottom: 16,
    letterSpacing: "-0.02em",
  },
  heroAccent: {
    background: "linear-gradient(120deg, var(--brand), var(--info))",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "var(--brand)",
  },
  heroTagline: {
    fontSize: "clamp(15px, 2.5vw, 18px)",
    color: "var(--text-muted)",
    lineHeight: 1.6,
    marginBottom: 24,
  },
  searchRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: "1 1 340px",
    minWidth: 240,
    maxWidth: 540,
    padding: "0 16px",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: 999,
    boxShadow: "var(--shadow-md)",
  },
  searchIcon: { fontSize: 18, opacity: 0.75 },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text)",
    fontSize: 15,
    padding: "13px 0",
    minWidth: 0,
  },
  searchClear: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 14,
    padding: 4,
    lineHeight: 1,
  },
  codeBtn: { padding: "13px 20px", borderRadius: 999 },
  nearbyRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  nearbyBtn: { padding: "9px 16px" },
  nearbyActive: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    background: "var(--success-soft)",
    color: "var(--success)",
  },
  nearbyToggleOff: { padding: "6px 10px", fontSize: 13 },
  geoNotice: {
    ...subtitle,
    marginTop: 10,
    color: "var(--text-subtle)",
  },
  carouselSection: { padding: "8px 0 12px" },
  chipsSection: { padding: "6px 0 4px" },
  chipsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  chip: {
    padding: "7px 14px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    background: "var(--surface)",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    cursor: "pointer",
    transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
  },
  chipActive: {
    background: "var(--brand)",
    color: "var(--brand-contrast)",
    borderColor: "var(--brand)",
  },
  section: { padding: "26px 0 8px" },
  sectionHeadRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text)",
    textAlign: "center",
    marginBottom: 24,
  },
  sectionTitleLeft: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 16,
  },
  skeletonCard: {
    height: 240,
    border: "1px solid var(--border)",
  },
  discoverCard: {
    display: "flex",
    flexDirection: "column",
    textAlign: "left",
    padding: 0,
    overflow: "hidden",
    cursor: "pointer",
    color: "var(--text)",
    background: "var(--surface)",
    width: "100%",
  },
  accentBar: { height: 5, width: "100%" },
  cardBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 18,
    flex: 1,
  },
  cardHeader: { display: "flex", alignItems: "center", gap: 12 },
  logo: {
    width: 46,
    height: 46,
    borderRadius: 10,
    objectFit: "cover",
    background: "var(--surface-hover)",
    flexShrink: 0,
  },
  logoFallback: {
    width: 46,
    height: 46,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--surface-hover)",
    color: "var(--text-muted)",
    fontWeight: 800,
    fontSize: 20,
    flexShrink: 0,
  },
  cardTitleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 },
  featuredTag: {
    fontSize: 10,
    fontWeight: 800,
    color: "#fff",
    padding: "2px 8px",
    borderRadius: 999,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
  },
  cardBranch: { fontSize: 13, color: "var(--text-muted)", display: "block", marginTop: 2 },
  bannerText: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    margin: 0,
  },
  metaRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  metaItem: { fontSize: 13, color: "var(--text-muted)" },
  metaDistance: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--brand)",
    background: "var(--surface-hover)",
    padding: "2px 8px",
    borderRadius: 999,
  },
  ratingRow: { display: "flex", alignItems: "center", gap: 5 },
  ratingStar: { fontSize: 14, color: "#f59e0b", lineHeight: 1 },
  ratingValue: { fontSize: 13, fontWeight: 700, color: "var(--text)" },
  ratingCount: { fontSize: 12, color: "var(--text-muted)" },
  ratingEmpty: { fontSize: 12, color: "var(--text-subtle)" },
  promoChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    maxWidth: "100%",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: "var(--brand-soft, var(--surface-hover))",
    color: "var(--brand)",
    border: "1px solid var(--brand)",
  },
  promoChipText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 160,
  },
  cardChips: { display: "flex", flexWrap: "wrap", gap: 6 },
  miniChip: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--surface-hover)",
    padding: "3px 8px",
    borderRadius: 999,
  },
  reserveBtn: { marginTop: "auto", width: "100%", padding: "10px 16px" },
  benefitGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
  },
  benefitCard: {
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  benefitIcon: { fontSize: 28 },
  benefitTitle: { fontSize: 16, fontWeight: 700, color: "var(--text)" },
  benefitText: { fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 },
  adSection: { padding: "36px 0" },
  footer: {
    borderTop: "1px solid var(--border)",
    padding: "24px 20px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    marginTop: 24,
  },
  footerText: { fontSize: 13, color: "var(--text-muted)" },
  footerLink: {
    background: "none",
    border: "none",
    padding: 0,
    marginTop: 4,
    color: "var(--text-subtle)",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "underline",
  },
};
