import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import ThemeToggle from "../../components/ThemeToggle";
import Spinner from "../../components/Spinner";
import { useAuthStore } from "../../store/useAuthStore";
import { trackEvent } from "../../lib/firebase";
import {
  publicBookingService,
  type BranchSearchResult,
} from "../../services/public.service";
import { card, btn, subtitle, pageTitle } from "../../ui/ui";

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

/**
 * Panel publico de busqueda de sucursal (Req 5.1-5.4).
 * Accesible por cualquier usuario que no sea emprendedor (clientes / no logueados).
 * Ofrece dos caminos para abrir el portal de reservas de una sucursal:
 *  - Ingresar el codigo de acceso de 6 caracteres -> navega a /reservar/:code
 *  - Buscar por nombre de negocio o sucursal -> lista resultados y abre el portal al elegir uno
 */
export default function BuscarSucursal() {
  const navigate = useNavigate();
  const { isAuthenticated, user, logout } = useAuthStore();

  // --- Camino por codigo ---
  const [code, setCode] = useState("");
  const normalized = code.trim().toUpperCase();
  const codeValid = normalized.length === 6;

  // --- Camino por busqueda ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BranchSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Buscar Sucursal" });
  }, []);

  // Busqueda por nombre con debounce; requiere >= 2 caracteres (igual que el backend).
  useEffect(() => {
    const term = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (term.length < 2) {
      setResults([]);
      setSearchError("");
      setSearched(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      publicBookingService
        .searchBranches(term)
        .then((data) => {
          setResults(data);
          setSearchError("");
          setSearched(true);
        })
        .catch((err) =>
          setSearchError(readError(err, "No pudimos buscar sucursales. Revisa tu conexion e intentalo de nuevo."))
        )
        .finally(() => setSearching(false));
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleCodeSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!codeValid) return;
    trackEvent("code_entry_submit", { code: normalized });
    navigate(`/reservar/${normalized}`);
  };

  const openBranch = (branch: BranchSearchResult) => {
    trackEvent("branch_search_select", { code: branch.code });
    navigate(`/reservar/${branch.code}`);
  };

  // Vuelve a la pantalla anterior dentro de la app; si se entro directo (link/QR),
  // cae a la pantalla de descubrimiento.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/inicio");
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div style={styles.page}>
      <button type="button" style={styles.backBtn} onClick={goBack} aria-label="Volver">
        ← Volver
      </button>

      <div style={styles.header} className="reveal">
        <div>
          <h1 style={pageTitle}>Buscar sucursal</h1>
          <p style={subtitle}>Busca un negocio por nombre, o ingresa su codigo de 6 caracteres para agendar.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ThemeToggle />
          {isAuthenticated && (
            <>
              {user?.role === "CLIENT" && (
                <button style={btn("secondary")} onClick={() => navigate("/mis-citas")}>
                  Mis citas
                </button>
              )}
              <button style={btn("ghost")} onClick={handleLogout}>
                Cerrar sesion
              </button>
            </>
          )}
        </div>
      </div>

      {/* Camino 1: por nombre (principal) */}
      <section style={styles.section} className="reveal" >
        <div style={styles.stepTitle}>Buscar por nombre</div>
        <div style={styles.searchWrap}>
          <span aria-hidden="true" style={styles.searchIcon}>🔍</span>
          <input
            style={styles.searchInput}
            type="search"
            placeholder="Nombre del negocio o de la sucursal"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar sucursal por nombre"
          />
        </div>

        <div style={{ marginTop: 16 }}>
          {searching && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
              <Spinner /> Buscando...
            </div>
          )}

          {searchError && !searching && (
            <p style={{ color: "var(--danger)" }} role="alert">
              {searchError}
            </p>
          )}

          {!searching && !searchError && query.trim().length >= 2 && searched && results.length === 0 && (
            <p style={subtitle}>No se encontraron sucursales para "{query.trim()}".</p>
          )}

          {!searching && results.length > 0 && (
            <div style={styles.resultList}>
              {results.map((r, i) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => openBranch(r)}
                  style={{ ...card, ...styles.resultItem, ["--reveal-delay" as any]: `${Math.min(i, 8) * 45}ms` }}
                  className="reveal lift focusable"
                >
                  <div style={{ textAlign: "left" }}>
                    <div style={styles.resultBusiness}>{r.business_name}</div>
                    <div style={styles.resultBranch}>{r.branch_name}</div>
                  </div>
                  <span style={styles.resultArrow} aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Camino 2: por codigo */}
      <section style={styles.section} className="reveal">
        <div style={styles.stepTitle}>Tengo un codigo</div>
        <form style={{ ...card, ...styles.codeCard }} onSubmit={handleCodeSubmit}>
          <input
            style={styles.codeInput}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            maxLength={6}
            placeholder="AB3K9P"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Codigo de la sucursal"
          />
          {code.length > 0 && !codeValid && (
            <p style={{ ...subtitle, marginTop: 10, textAlign: "center" }} role="status">
              El codigo debe tener 6 caracteres.
            </p>
          )}
          <button
            type="submit"
            style={{ ...btn("primary"), width: "100%", marginTop: 14, opacity: codeValid ? 1 : 0.6 }}
            disabled={!codeValid}
          >
            Abrir portal
          </button>
          <p style={{ ...subtitle, marginTop: 12, textAlign: "center" }}>
            Tambien puedes escanear el codigo QR de la sucursal para abrir el portal directamente.
          </p>
        </form>
      </section>

    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 560, margin: "0 auto", padding: "28px 20px 60px" },
  backBtn: { ...btn("ghost"), padding: "6px 12px", marginBottom: 16 },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 24,
  },
  section: { marginBottom: 28 },
  stepTitle: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    marginBottom: 12,
  },
  codeCard: { padding: 24 },
  codeInput: {
    width: "100%",
    padding: "14px 16px",
    fontSize: 24,
    fontWeight: 700,
    textAlign: "center",
    letterSpacing: "0.24em",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    textTransform: "uppercase",
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 16px",
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: 999,
    boxShadow: "var(--shadow-sm)",
  },
  searchIcon: { fontSize: 18, opacity: 0.75, flexShrink: 0 },
  searchInput: {
    width: "100%",
    padding: "13px 0",
    fontSize: 15,
    color: "var(--text)",
    background: "transparent",
    border: "none",
    outline: "none",
    boxShadow: "none",
  },
  resultList: { display: "flex", flexDirection: "column", gap: 10 },
  resultItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    cursor: "pointer",
    width: "100%",
  },
  resultBusiness: { fontSize: 15, fontWeight: 700, color: "var(--text)" },
  resultBranch: { fontSize: 13, color: "var(--text-muted)", marginTop: 2 },
  resultArrow: { fontSize: 18, color: "var(--brand)", fontWeight: 700 },
};
