import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { trackEvent } from "../lib/firebase";
import { useAuthStore } from "../store/useAuthStore";
import { useIsSuperAdmin } from "../store/useIsSuperAdmin";
import { useBrandingStore } from "../store/useBrandingStore";
import { useImpersonation } from "../store/useImpersonation";
import { impersonationService } from "../services/impersonation.service";
import { notificationService, type NotificationItem } from "../services/notification.service";
import ThemeToggle from "./ThemeToggle";
import TrialBanner from "./TrialBanner";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

// Iconos SVG inline pequenos y consistentes (heredan currentColor).
function Icon({ path }: { path: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path.split("|").map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const ICONS = {
  dashboard: "M3 3h8v8H3z|M13 3h8v5h-8z|M13 12h8v9h-8z|M3 15h8v6H3z",
  calendar: "M3 4h18v18H3z|M16 2v4|M8 2v4|M3 10h18",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M23 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75",
  briefcase: "M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z|M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  layers: "M12 2 2 7l10 5 10-5-10-5z|M2 17l10 5 10-5|M2 12l10 5 10-5",
  chart: "M18 20V10|M12 20V4|M6 20v-6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 6v6l4 2",
  qr: "M3 3h7v7H3z|M14 3h7v7h-7z|M3 14h7v7H3z|M14 14h3v3h-3z|M20 14v3|M17 20h4v1",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  sliders: "M4 21v-7|M4 10V3|M12 21v-9|M12 8V3|M20 21v-5|M20 12V3|M1 14h6|M9 8h6|M17 16h6",
  building: "M3 21h18|M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16|M9 7h1|M14 7h1|M9 11h1|M14 11h1|M9 15h1|M14 15h1",
  calendarOff: "M3 4h18v18H3z|M16 2v4|M8 2v4|M3 10h18|M9 14l6 6|M15 14l-6 6",
  gift: "M20 12v10H4V12|M2 7h20v5H2z|M12 22V7|M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z|M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z",
  megaphone: "M3 11l18-5v12L3 14v-3z|M11.6 16.8a3 3 0 1 1-5.8-1.6",
  plug: "M9 2v6|M15 2v6|M6 8h12v3a6 6 0 0 1-12 0V8z|M12 20v2",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9|M13.73 21a2 2 0 0 1-3.46 0",
};

// Hora relativa corta en espanol para las notificaciones ("hace 5 min", "hace 2 h").
// Cae a fecha corta cuando pasa mas de un dia. Nunca lanza (fallback: cadena vacia).
function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const diffMs = Date.now() - then;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

// Navegacion del emprendedor (ADMIN). Los items de configuracion (lealtad, colaboradores,
// sucursales, categorias, horarios, asuetos) los restringe el backend a ADMIN; para el
// colaborador (ASSISTANT) los ocultamos por claridad, dejando visibles solo las secciones
// operativas: Dashboard, Citas, Clientes y Mi Codigo.
// La guia consume un endpoint ADMIN (/me/setup-progress); se oculta al colaborador
// (ASSISTANT) para evitar un 403 confuso, igual que el resto de secciones de config.
const CONFIG_ONLY_ROUTES = new Set(["/guia", "/lealtad", "/asistentes", "/sucursales", "/services", "/horarios", "/asuetos", "/marketing", "/promociones", "/suscripcion"]);

const managementNav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: <Icon path={ICONS.dashboard} />, end: true },
  { to: "/guia", label: "Guia de uso", icon: <Icon path={ICONS.layers} /> },
  { to: "/appointments", label: "Citas", icon: <Icon path={ICONS.calendar} /> },
  { to: "/customers", label: "Clientes", icon: <Icon path={ICONS.users} /> },
  { to: "/lealtad", label: "Lealtad", icon: <Icon path={ICONS.gift} /> },
  { to: "/asistentes", label: "Colaboradores", icon: <Icon path={ICONS.users} /> },
  { to: "/sucursales", label: "Sucursales", icon: <Icon path={ICONS.building} /> },
  { to: "/services", label: "Categorias", icon: <Icon path={ICONS.briefcase} /> },
  { to: "/horarios", label: "Horarios", icon: <Icon path={ICONS.clock} /> },
  { to: "/asuetos", label: "Asuetos", icon: <Icon path={ICONS.calendarOff} /> },
  { to: "/marketing", label: "Personalizacion", icon: <Icon path={ICONS.megaphone} /> },
  { to: "/promociones", label: "Promociones", icon: <Icon path={ICONS.megaphone} /> },
  { to: "/mi-codigo", label: "Mi Codigo", icon: <Icon path={ICONS.qr} /> },
  { to: "/suscripcion", label: "Suscripcion", icon: <Icon path={ICONS.gift} /> },
];

const adminNav: NavItem[] = [
  { to: "/admin", label: "Resumen", icon: <Icon path={ICONS.layers} />, end: true },
  { to: "/admin/landing", label: "Landing", icon: <Icon path={ICONS.megaphone} /> },
  { to: "/admin/realtime", label: "Tiempo real", icon: <Icon path={ICONS.activity} /> },
  { to: "/admin/users", label: "Usuarios", icon: <Icon path={ICONS.users} /> },
  { to: "/admin/tenants", label: "Negocios", icon: <Icon path={ICONS.building} /> },
  { to: "/admin/modules", label: "Modulos", icon: <Icon path={ICONS.sliders} /> },
  { to: "/admin/metrics", label: "Metricas", icon: <Icon path={ICONS.chart} /> },
  { to: "/admin/loyalty", label: "Lealtad", icon: <Icon path={ICONS.gift} /> },
  { to: "/admin/audit", label: "Auditoria", icon: <Icon path={ICONS.shield} /> },
  { to: "/admin/authorizations", label: "Autorizaciones", icon: <Icon path={ICONS.key} /> },
];

function sectionTitleFor(pathname: string, isSuperAdmin: boolean): string {
  const source = isSuperAdmin ? adminNav : managementNav;
  const match = [...source]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + "/")));
  if (match) return match.label;
  if (pathname === "/profile") return "Perfil";
  return "onlyspace";
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSuperAdmin = useIsSuperAdmin();
  const { user, logout } = useAuthStore();
  // Personalizacion del emprendedor para reflejar su marca en el menu. Se carga
  // en el store compartido y se actualiza sola al guardar en Personalizacion.
  const branding = useBrandingStore((st) => st.branding);
  const loadBranding = useBrandingStore((st) => st.load);

  // Impersonacion (modo soporte del super admin). Cuando esta activa mostramos una
  // barra fija de advertencia con opcion de salir.
  const impersonating = useImpersonation((st) => st.isImpersonating);
  const impersonatingName = useImpersonation((st) => st.name);
  const impersonatingTenantId = useImpersonation((st) => st.tenantId);
  const stopImpersonation = useImpersonation((st) => st.stop);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState<boolean>(() => (typeof window !== "undefined" ? window.innerWidth <= 768 : false));
  const [menuOpen, setMenuOpen] = useState(false);

  // Campana de notificaciones in-app del area logueada (staff/admin/super admin).
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifItems, setNotifItems] = useState<NotificationItem[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState("");

  // Refresca el contador de no leidas. Best-effort: ante cualquier fallo mostramos
  // 0 sin romper el layout.
  const refreshUnread = async () => {
    try {
      const count = await notificationService.unreadCount();
      setUnreadCount(count);
    } catch {
      setUnreadCount(0);
    }
  };

  // Carga la lista de notificaciones al abrir la bandeja.
  const loadNotifications = async () => {
    setNotifLoading(true);
    setNotifError("");
    try {
      const items = await notificationService.list();
      setNotifItems(items);
    } catch {
      setNotifError("No se pudieron cargar las notificaciones");
      setNotifItems([]);
    } finally {
      setNotifLoading(false);
    }
  };

  // Al montar, carga el contador y lo refresca cada 60s (limpiando el intervalo).
  useEffect(() => {
    refreshUnread();
    const id = window.setInterval(refreshUnread, 60000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abre/cierra la bandeja; al abrir refresca contador y lista.
  const toggleNotif = () => {
    setNotifOpen((open) => {
      const next = !open;
      if (next) {
        setMenuOpen(false);
        refreshUnread();
        loadNotifications();
      }
      return next;
    });
  };

  // Marca todas como leidas y refresca contador + lista.
  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllRead();
      setNotifItems((items) => items.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      /* best-effort: no rompemos la bandeja si falla */
    }
  };

  // Marca una notificacion concreta como leida y baja el contador.
  const handleMarkOneRead = async (item: NotificationItem) => {
    if (item.read_at) return;
    try {
      await notificationService.markRead(item.id);
      setNotifItems((items) =>
        items.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      /* best-effort */
    }
  };

  // El ASSISTANT (sub-usuario del emprendedor) ve el area de gestion pero sin las
  // secciones de configuracion, que el backend restringe a ADMIN.
  const isAssistant = user?.role === "ASSISTANT";
  const entrepreneurNav = useMemo(
    () => (isAssistant ? managementNav.filter((item) => !CONFIG_ONLY_ROUTES.has(item.to)) : managementNav),
    [isAssistant]
  );
  // Mientras el super admin ESTA impersonando ("Actuar como"), navega el sistema
  // como el negocio objetivo: su token es del tenant (rol ADMIN), no SUPERADMIN.
  // Por eso el chrome (menu, titulo, marca) debe ser el del emprendedor; de lo
  // contrario veria el menu de super admin y los endpoints /admin devolverian 403.
  const effectiveSuperAdmin = isSuperAdmin && !impersonating;
  const navItems = effectiveSuperAdmin ? adminNav : entrepreneurNav;
  const sectionTitle = useMemo(() => sectionTitleFor(location.pathname, effectiveSuperAdmin), [location.pathname, effectiveSuperAdmin]);

  useEffect(() => {
    // El menu del emprendedor/colaborador muestra su marca; el super admin no.
    // Al impersonar tambien cargamos la marca del negocio objetivo.
    if (!effectiveSuperAdmin) loadBranding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSuperAdmin]);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Cierra el sidebar overlay y el menu de usuario al navegar.
  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleStopImpersonation = async () => {
    // Best-effort: auditamos el fin en el backend, limpiamos el estado local y
    // volvemos al panel del super admin (su token normal sigue en localStorage).
    if (impersonatingTenantId) {
      await impersonationService.stop(impersonatingTenantId);
    }
    stopImpersonation();
    // Recarga dura para que todas las pantallas vuelvan al contexto del super admin.
    window.location.href = "/admin";
  };

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();

  const sidebarVisible = !isNarrow || mobileOpen;

  const sidebar = (
    <aside
      style={{
        ...styles.sidebar,
        ...(isNarrow
          ? {
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              zIndex: 60,
              transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
              transition: "transform 0.2s ease",
            }
          : {}),
      }}
    >
      {(() => {
        // Marca del emprendedor si la configuro (no aplica al super admin).
        const bColor = !effectiveSuperAdmin && branding?.brand_color?.trim() ? branding.brand_color : null;
        const bLogo = !effectiveSuperAdmin && branding?.logo_url?.trim() ? branding.logo_url : null;
        const bTitle = !effectiveSuperAdmin && branding?.banner_title?.trim() ? branding.banner_title : null;
        return (
          <div style={styles.brand} onClick={() => navigate(effectiveSuperAdmin ? "/admin" : "/")}>
            {bLogo ? (
              <img src={bLogo} alt={bTitle || "Logo"} style={styles.brandLogo} />
            ) : (
              <img src="/onlyspace.png" alt="onlyspace" style={styles.brandLogo} />
            )}
            <span style={{ ...styles.brandName, ...(bColor ? { color: bColor } : null) }}>
              {bTitle || "onlyspace"}
            </span>
          </div>
        );
      })()}

      <nav style={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => trackEvent("screen_view", { screen_name: item.label })}
            style={({ isActive }) => ({
              ...styles.navLink,
              ...(isActive ? styles.navLinkActive : {}),
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && <span style={styles.activeBar} />}
                <span style={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {!effectiveSuperAdmin && (
        <div style={styles.sidebarFooter}>
          <NavLink
            to="/profile"
            onClick={() => trackEvent("screen_view", { screen_name: "Perfil" })}
            style={({ isActive }) => ({
              ...styles.navLink,
              ...(isActive ? styles.navLinkActive : {}),
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && <span style={styles.activeBar} />}
                <span style={styles.navIcon}><Icon path={ICONS.user} /></span>
                <span>Perfil</span>
              </>
            )}
          </NavLink>
        </div>
      )}
    </aside>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {sidebarVisible && sidebar}

      {isNarrow && mobileOpen && (
        <div style={styles.overlay} onClick={() => setMobileOpen(false)} />
      )}

      <div
        style={{
          ...styles.content,
          marginLeft: isNarrow ? 0 : "var(--sidebar-w)",
        }}
      >
        {impersonating && (
          <div style={styles.impersonationBar} role="alert">
            <div style={styles.impersonationLeft}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span>
                Actuando como: <strong>{impersonatingName || "negocio"}</strong>
              </span>
            </div>
            <button type="button" style={styles.impersonationExitBtn} onClick={handleStopImpersonation}>
              Salir
            </button>
          </div>
        )}

        <header style={styles.topbar}>
          <div style={styles.topbarLeft}>
            {isNarrow && (
              <button type="button" aria-label="Abrir menu" style={styles.iconBtn} onClick={() => setMobileOpen((v) => !v)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 12h18M3 6h18M3 18h18" />
                </svg>
              </button>
            )}
            <img src="/onlyspace.png" alt={sectionTitle ? `onlyspace - ${sectionTitle}` : "onlyspace"} style={styles.topbarLogo} />
          </div>

          <div style={styles.topbarRight}>
            <ThemeToggle />

            <div style={{ position: "relative" }}>
              <button
                type="button"
                aria-label={unreadCount > 0 ? `Notificaciones, ${unreadCount} sin leer` : "Notificaciones"}
                aria-haspopup="true"
                aria-expanded={notifOpen}
                style={styles.iconBtn}
                onClick={toggleNotif}
              >
                <Icon path={ICONS.bell} />
                {unreadCount > 0 && (
                  <span style={styles.notifBadge} aria-hidden="true">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {/* Region viva para anunciar el contador a lectores de pantalla. */}
              <span aria-live="polite" style={styles.srOnly}>
                {unreadCount > 0 ? `${unreadCount} notificaciones sin leer` : "Sin notificaciones nuevas"}
              </span>
              {notifOpen && (
                <>
                  <div style={styles.menuBackdrop} onClick={() => setNotifOpen(false)} />
                  <div style={styles.notifMenu} className="fade-in" role="dialog" aria-label="Notificaciones">
                    <div style={styles.notifHeader}>
                      <span style={styles.notifTitle}>Notificaciones</span>
                      <button
                        type="button"
                        style={styles.notifMarkAllBtn}
                        onClick={handleMarkAllRead}
                        disabled={notifItems.length === 0 || notifItems.every((n) => n.read_at)}
                      >
                        Marcar todas como leidas
                      </button>
                    </div>
                    <div style={styles.notifList}>
                      {notifLoading && <div style={styles.notifEmpty}>Cargando...</div>}
                      {!notifLoading && notifError && (
                        <div style={{ ...styles.notifEmpty, color: "var(--danger)" }} role="alert">
                          {notifError}
                        </div>
                      )}
                      {!notifLoading && !notifError && notifItems.length === 0 && (
                        <div style={styles.notifEmpty}>No tienes notificaciones.</div>
                      )}
                      {!notifLoading &&
                        !notifError &&
                        notifItems.map((item) => {
                          const unread = !item.read_at;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleMarkOneRead(item)}
                              style={{
                                ...styles.notifItem,
                                ...(unread ? styles.notifItemUnread : {}),
                                cursor: unread ? "pointer" : "default",
                              }}
                              aria-label={unread ? `${item.title}, sin leer` : item.title}
                            >
                              <div style={styles.notifItemTop}>
                                {unread && <span style={styles.notifDot} aria-hidden="true" />}
                                <span style={styles.notifItemTitle}>{item.title}</span>
                                <span style={styles.notifItemTime}>{relativeTime(item.created_at)}</span>
                              </div>
                              {item.body && <p style={styles.notifItemBody}>{item.body}</p>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <button
                type="button"
                aria-label="Menu de usuario"
                style={styles.avatar}
                onClick={() => setMenuOpen((v) => !v)}
              >
                {initial}
              </button>
              {menuOpen && (
                <>
                  <div style={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
                  <div style={styles.userMenu} className="fade-in">
                    <div style={styles.userMenuHeader}>
                      <div style={styles.userName}>{user?.name || "Usuario"}</div>
                      <div style={styles.userEmail}>{user?.email}</div>
                    </div>
                    <button type="button" style={styles.logoutBtn} onClick={handleLogout}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="M16 17l5-5-5-5M21 12H9" />
                      </svg>
                      Cerrar sesion
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main style={styles.main}>
          <div style={styles.mainInner} className="fade-in">
            {/* Aviso de prueba/suscripcion premium: solo para el emprendedor (o el super
                admin mientras actua como un negocio). No aparece en el chrome de super admin. */}
            {!effectiveSuperAdmin && <TrialBanner />}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  sidebar: {
    width: "var(--sidebar-w)",
    background: "var(--bg-elevated)",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    padding: "16px 12px",
    gap: 8,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px 16px",
    cursor: "pointer",
  },
  brandBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: 10,
    background: "var(--brand-soft)",
    fontSize: 18,
  },
  brandName: { fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" },
  brandLogo: { width: 30, height: 30, borderRadius: 8, objectFit: "contain", flexShrink: 0, background: "var(--surface)" },
  nav: { display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  navLink: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 14,
    transition: "background-color 0.15s ease, color 0.15s ease",
  },
  navLinkActive: { background: "var(--brand-soft)", color: "var(--brand)" },
  navIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center" },
  activeBar: {
    position: "absolute",
    left: -12,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 3,
    background: "var(--brand)",
  },
  sidebarFooter: { borderTop: "1px solid var(--border)", paddingTop: 8 },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 55,
    animation: "overlayIn 0.15s ease",
  },
  content: { minHeight: "100vh", display: "flex", flexDirection: "column", transition: "margin-left 0.2s ease" },
  impersonationBar: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 20px",
    background: "var(--warning-soft)",
    color: "var(--warning)",
    borderBottom: "2px solid var(--warning)",
    fontSize: 14,
    fontWeight: 600,
  },
  impersonationLeft: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  impersonationExitBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 16px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--warning)",
    background: "var(--warning)",
    color: "var(--brand-contrast)",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
  topbar: {
    position: "sticky",
    top: 0,
    zIndex: 40,
    height: "var(--header-h)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
  },
  topbarLeft: { display: "flex", alignItems: "center", gap: 12 },
  topbarRight: { display: "flex", alignItems: "center", gap: 12 },
  topbarLogo: { height: 32, width: "auto", objectFit: "contain", display: "block" },
  sectionTitle: { fontSize: 17, fontWeight: 700, color: "var(--text)", margin: 0 },
  iconBtn: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  notifBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    background: "var(--danger)",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
  notifMenu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 8px)",
    width: 320,
    maxWidth: "calc(100vw - 32px)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-lg)",
    padding: 8,
    zIndex: 50,
  },
  notifHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 8px 10px",
    borderBottom: "1px solid var(--border)",
    marginBottom: 4,
  },
  notifTitle: { fontSize: 14, fontWeight: 700, color: "var(--text)" },
  notifMarkAllBtn: {
    background: "transparent",
    color: "var(--brand)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    padding: "4px 6px",
    borderRadius: "var(--radius-sm)",
  },
  notifList: { maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 },
  notifEmpty: { padding: "20px 12px", textAlign: "center", fontSize: 13, color: "var(--text-muted)" },
  notifItem: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    padding: "10px 10px",
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    textAlign: "left",
  },
  notifItemUnread: { background: "var(--brand-soft)" },
  notifItemTop: { display: "flex", alignItems: "center", gap: 8 },
  notifDot: { width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", flexShrink: 0 },
  notifItemTitle: { fontSize: 13, fontWeight: 700, color: "var(--text)", flex: 1, minWidth: 0 },
  notifItemTime: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 },
  notifItemBody: { fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 },
  avatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: "50%",
    background: "var(--brand)",
    color: "var(--brand-contrast)",
    fontWeight: 700,
    fontSize: 15,
  },
  menuBackdrop: { position: "fixed", inset: 0, zIndex: 45 },
  userMenu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 8px)",
    width: 240,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-lg)",
    padding: 8,
    zIndex: 50,
  },
  userMenuHeader: { padding: "8px 10px 12px", borderBottom: "1px solid var(--border)", marginBottom: 8 },
  userName: { fontSize: 14, fontWeight: 700, color: "var(--text)" },
  userEmail: { fontSize: 13, color: "var(--text-muted)", marginTop: 2, wordBreak: "break-all" },
  logoutBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 10px",
    borderRadius: "var(--radius-sm)",
    color: "var(--danger)",
    fontWeight: 600,
    fontSize: 14,
    background: "transparent",
    textAlign: "left",
  },
  main: { flex: 1, padding: "28px 24px" },
  mainInner: { maxWidth: 1100, margin: "0 auto", width: "100%" },
};

