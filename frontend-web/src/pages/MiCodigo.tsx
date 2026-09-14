import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import BranchSelector from "../components/BranchSelector";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { dataService } from "../services/data.service";
import { useAuthStore } from "../store/useAuthStore";
import { useBranchStore } from "../store/useBranchStore";
import { useBrandingStore } from "../store/useBrandingStore";
import { usePremium } from "../store/usePremium";
import { pageTitle, subtitle, card, btn, badge, emptyState, field } from "../ui/ui";

const DEFAULT_TEMPLATE =
  "Hola {cliente}, te recordamos tu cita en {negocio} el {fecha} a las {hora}. Cualquier duda escribenos: {contacto}.";

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

// Carga una imagen (logo) con crossOrigin para permitir exportar el canvas via
// toDataURL. Aplica un timeout para no bloquear la generacion del QR si el logo
// tarda o falla (CORS/red): en ese caso resolvemos null y caemos al QR sin logo.
function loadImageWithTimeout(src: string, timeoutMs = 6000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let done = false;
    const finish = (result: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      finish(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    img.src = src;
  });
}

// Genera el PNG (dataURL) del QR del portal. Si withLogo + logoUrl, dibuja el
// logo del negocio en el centro dentro de un circulo blanco (recortado en
// circulo) usando un canvas con correccion de errores alta (nivel H) para que
// el logo no rompa el escaneo. Si el logo no carga, devuelve el QR sin logo.
async function buildQrDataUrl(
  portalUrl: string,
  opts: { width: number; withLogo: boolean; logoUrl?: string | null }
): Promise<string> {
  const { width, withLogo, logoUrl } = opts;
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, portalUrl, {
    width,
    margin: 2,
    errorCorrectionLevel: "H",
  });

  if (!withLogo || !logoUrl) {
    return canvas.toDataURL("image/png");
  }

  const logo = await loadImageWithTimeout(logoUrl);
  if (!logo) {
    // El logo fallo (CORS/red/timeout): devolvemos el QR limpio sin romper.
    return canvas.toDataURL("image/png");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");

  const size = canvas.width;
  const center = size / 2;
  // Circulo blanco de fondo (~19% del ancho) para aislar el logo del patron.
  const circleRadius = size * 0.19;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, circleRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  // Logo recortado en circulo, centrado y contenido dentro del circulo blanco.
  const logoRadius = circleRadius * 0.82;
  const logoDiameter = logoRadius * 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, logoRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(logo, center - logoRadius, center - logoRadius, logoDiameter, logoDiameter);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

// Convierte un dataURL PNG en un File para compartir con la Web Share API nivel 2.
function dataUrlToFile(dataUrl: string, filename: string): File {
  const [meta, base64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

// Tarjeta compacta para configurar el WhatsApp del negocio (numero + plantilla de recordatorio).
function WhatsappCard() {
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    dataService
      .getBusiness()
      .then((b) => {
        if (cancelled) return;
        setWhatsappNumber(b.whatsapp_number ?? "");
        setTemplate(b.whatsapp_template ?? "");
      })
      .catch((err) => {
        if (!cancelled) setError(readError(err, "No se pudo cargar el WhatsApp del negocio"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const saved = await dataService.updateBusiness({
        whatsapp_number: whatsappNumber.trim() || null,
        whatsapp_template: template.trim() || null,
      });
      setWhatsappNumber(saved.whatsapp_number ?? "");
      setTemplate(saved.whatsapp_template ?? "");
      setSuccess("Datos de WhatsApp guardados.");
    } catch (err) {
      setError(readError(err, "No se pudo guardar. Revisa el numero de WhatsApp."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, padding: 24, marginTop: 16 }}>
      <div style={waStyles.label}>WhatsApp del negocio</div>
      <p style={{ ...subtitle, marginTop: 4, marginBottom: 16 }}>
        Configura tu numero y el mensaje de recordatorio que enviaras a tus clientes.
      </p>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" }}>
          <Spinner /> Cargando...
        </div>
      ) : (
        <form onSubmit={handleSave}>
          {error && <div style={waStyles.error}>{error}</div>}
          {success && <div style={waStyles.success}>{success}</div>}

          <div style={field}>
            <label htmlFor="wa-number">Numero de WhatsApp</label>
            <input
              id="wa-number"
              type="tel"
              placeholder="+52 55 1234 5678"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
            />
            <span style={waStyles.hint}>Formato internacional con codigo de pais (solo digitos y +).</span>
          </div>

          <div style={field}>
            <label htmlFor="wa-template">Plantilla de recordatorio</label>
            <textarea
              id="wa-template"
              style={{ minHeight: 90, resize: "vertical" }}
              placeholder={DEFAULT_TEMPLATE}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
            <span style={waStyles.hint}>
              Variables disponibles: {"{cliente}"} {"{negocio}"} {"{fecha}"} {"{hora}"} {"{contacto}"}. Si lo dejas
              vacio se usara la plantilla por defecto.
            </span>
          </div>

          <button type="submit" style={btn("primary")} disabled={saving}>
            {saving ? "Guardando..." : "Guardar WhatsApp"}
          </button>
        </form>
      )}
    </div>
  );
}

const waStyles: Record<string, CSSProperties> = {
  label: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" },
  hint: { fontSize: 12, color: "var(--text-subtle)" },
  error: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  success: { background: "var(--success-soft)", color: "var(--success)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
};

export default function MiCodigo() {
  const { branches, activeBranchId } = useBranchStore();
  const { user } = useAuthStore();
  // La configuracion del WhatsApp del negocio es solo para ADMIN; el colaborador
  // (ASSISTANT) ve la seccion en modo solo-lectura: unicamente codigo, link y QR.
  const isAssistant = user?.role === "ASSISTANT";
  const { isPremium } = usePremium();
  const branding = useBrandingStore((st) => st.branding);
  const loadBranding = useBrandingStore((st) => st.load);
  const logoUrl = branding?.logo_url ?? null;
  // El QR incluye el logo solo si el tenant es premium Y tiene logo configurado.
  const withLogo = isPremium && !!logoUrl;

  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareMsg, setShareMsg] = useState("");

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Mi Codigo" });
    // Carga la personalizacion (logo) del negocio desde el store compartido.
    loadBranding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const branch = useMemo(
    () => branches.find((b) => b.id === activeBranchId) ?? null,
    [branches, activeBranchId]
  );

  // Link completo del portal publico de la sucursal (ej. http://localhost:5173/reservar/AB3K9P).
  const portalUrl = branch?.portal_path ? window.location.origin + branch.portal_path : "";

  // Genera el QR (a 512px, se muestra escalado) cada vez que cambia el link, el
  // estado premium o el logo. Si es premium y hay logo, lo incrusta en el centro;
  // si no, genera el QR normal. La carga del logo es asincrona: usamos el flag
  // `cancelled` para descartar resultados obsoletos y evitar loops.
  useEffect(() => {
    if (!portalUrl) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    setQrLoading(true);
    buildQrDataUrl(portalUrl, { width: 512, withLogo, logoUrl })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      })
      .finally(() => {
        if (!cancelled) setQrLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portalUrl, withLogo, logoUrl]);

  const handleCopy = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible */
    }
  };

  const qrFileName = () => {
    const safeName = (branch?.name || "sucursal").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return `qr-${safeName}-${branch?.booking_code || "codigo"}.png`;
  };

  // Descarga el QR ya generado (incluye el logo si es premium). Si aun no esta
  // listo lo genera al vuelo antes de disparar la descarga via <a download>.
  const handleDownload = async () => {
    if (!portalUrl) return;
    try {
      const url = qrDataUrl || (await buildQrDataUrl(portalUrl, { width: 512, withLogo, logoUrl }));
      const link = document.createElement("a");
      link.href = url;
      link.download = qrFileName();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      /* no-op */
    }
  };

  // Comparte el QR usando la Web Share API. Preferimos compartir el archivo PNG
  // (nivel 2); si no se puede, compartimos el link; y en desktop sin Web Share
  // caemos a copiar el enlace al portapapeles con feedback.
  const handleShare = async () => {
    if (!portalUrl) return;
    setShareMsg("");
    const title = branch?.name ? `Reserva en ${branch.name}` : "Reserva tu cita";
    const text = "Escanea el QR o abre el link para agendar tu cita.";

    try {
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      const dataUrl = qrDataUrl || (await buildQrDataUrl(portalUrl, { width: 512, withLogo, logoUrl }));

      if (typeof nav.share === "function") {
        // Intento 1: compartir el archivo PNG del QR (Web Share API nivel 2).
        if (dataUrl) {
          const file = dataUrlToFile(dataUrl, qrFileName());
          if (nav.canShare?.({ files: [file] })) {
            await nav.share({ files: [file], title, text, url: portalUrl });
            setShareMsg("QR compartido");
            setTimeout(() => setShareMsg(""), 2500);
            return;
          }
        }
        // Intento 2: compartir solo el enlace/texto.
        await nav.share({ title, text, url: portalUrl });
        setShareMsg("Contenido compartido");
        setTimeout(() => setShareMsg(""), 2500);
        return;
      }

      // Fallback (desktop): copiar el link al portapapeles.
      await navigator.clipboard.writeText(portalUrl);
      setShareMsg("Enlace copiado");
      setTimeout(() => setShareMsg(""), 2500);
    } catch (err: any) {
      // AbortError = el usuario cancelo el dialogo; no mostramos error.
      if (err?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(portalUrl);
        setShareMsg("Enlace copiado");
        setTimeout(() => setShareMsg(""), 2500);
      } catch {
        setShareMsg("No se pudo compartir");
        setTimeout(() => setShareMsg(""), 2500);
      }
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <h1 style={pageTitle}>Mi Codigo</h1>
        <p style={subtitle}>Comparte el codigo o QR de la sucursal para que tus clientes agenden.</p>
      </div>

      <BranchSelector />

      {!branch ? (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🏢</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Selecciona una sucursal</p>
          <p>Elige una sucursal activa para ver su codigo y QR.</p>
        </div>
      ) : !branch.booking_code ? (
        <div style={{ ...card, padding: 32, textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🔗</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>El codigo se generara pronto</p>
          <p>Cuando este listo podras compartirlo con tus clientes.</p>
        </div>
      ) : (
        <div style={styles.grid}>
          <div style={{ ...card, padding: 24 }}>
            <div style={styles.label}>Codigo de acceso — {branch.name}</div>
            <div style={styles.code}>{branch.booking_code}</div>

            <div style={{ ...styles.label, marginTop: 20 }}>Link del portal</div>
            <div style={styles.linkBox}>{portalUrl}</div>

            <button style={{ ...btn("primary"), marginTop: 14 }} onClick={handleCopy}>
              {copied ? "Copiado!" : "Copiar link"}
            </button>
          </div>

          <div style={{ ...card, padding: 24, textAlign: "center" }}>
            <div style={styles.label}>Codigo QR</div>
            {qrDataUrl && !qrLoading ? (
              <img
                src={qrDataUrl}
                alt={
                  withLogo
                    ? "QR del portal de reservas con el logo del negocio"
                    : "QR del portal de reservas"
                }
                style={styles.qr}
              />
            ) : (
              <div style={{ ...styles.qr, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Spinner />
              </div>
            )}
            <p style={{ ...subtitle, marginTop: 8 }}>Escanea para abrir el portal</p>

            {withLogo ? (
              <div style={{ ...badge("info"), marginTop: 8 }}>QR personalizado con tu logo</div>
            ) : (
              <div style={styles.premiumHint}>
                <span style={badge("muted")}>Solo premium</span>
                <span style={{ ...subtitle, fontSize: 12 }}>Personaliza tu QR con tu logo.</span>
              </div>
            )}

            <div style={styles.qrActions}>
              <button
                style={btn("secondary")}
                onClick={handleDownload}
                disabled={!qrDataUrl || qrLoading}
                aria-label="Descargar el codigo QR como imagen PNG"
              >
                Descargar QR
              </button>
              <button
                style={btn("primary")}
                onClick={handleShare}
                disabled={!portalUrl}
                aria-label="Compartir el codigo QR o el enlace del portal"
              >
                Compartir
              </button>
            </div>

            {shareMsg && (
              <p role="status" aria-live="polite" style={{ ...subtitle, marginTop: 10, color: "var(--success)" }}>
                {shareMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {!isAssistant && <WhatsappCard />}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: { marginBottom: 20 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 },
  label: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 8 },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 40,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "var(--text)",
  },
  linkBox: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 14,
    color: "var(--text)",
    background: "var(--surface-hover)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 12px",
    wordBreak: "break-all",
  },
  qr: { width: 220, height: 220, maxWidth: "100%", borderRadius: "var(--radius-sm)", background: "#fff", padding: 8 },
  qrActions: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  premiumHint: {
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
};
