import { useEffect } from "react";
import type { CSSProperties } from "react";

// Tipado minimo del array global que usa AdSense. Defensivo: si no existe, no hacemos nada.
declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const ADSENSE_CLIENT: string | undefined = import.meta.env.VITE_ADSENSE_CLIENT;
const ADSENSE_SCRIPT_ID = "adsbygoogle-script";

// Inyecta el script de AdSense una sola vez en toda la app.
function ensureAdSenseScript(client: string) {
  if (typeof document === "undefined") return;
  if (document.getElementById(ADSENSE_SCRIPT_ID)) return;
  const s = document.createElement("script");
  s.id = ADSENSE_SCRIPT_ID;
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
    client,
  )}`;
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
}

interface AdSlotProps {
  /** data-ad-slot de la unidad publicitaria de AdSense. */
  slot?: string;
  /** Estilos del contenedor externo. */
  style?: CSSProperties;
  /** Etiqueta visible encima del anuncio (por defecto "Publicidad"). */
  label?: string;
}

/**
 * Unidad publicitaria de AdSense.
 *
 * REGLA (Req del usuario): un espacio publicitario NUNCA se muestra vacio ni con
 * placeholder. AdSlot SOLO renderiza cuando AdSense esta configurado
 * (VITE_ADSENSE_CLIENT presente). Si no lo esta, no renderiza NADA (ni en
 * desarrollo). Los anuncios propios del emprendedor se muestran aparte con
 * PromoCard; AdSlot es exclusivamente para AdSense.
 */
export default function AdSlot({ slot, style, label = "Publicidad" }: AdSlotProps) {
  const enabled = Boolean(ADSENSE_CLIENT);

  useEffect(() => {
    if (!enabled || !ADSENSE_CLIENT) return;
    ensureAdSenseScript(ADSENSE_CLIENT);
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSense no disponible todavia; ignoramos silenciosamente.
    }
  }, [enabled]);

  // Sin AdSense configurado -> no se muestra absolutamente nada.
  if (!enabled) return null;

  return (
    <div style={style}>
      <div style={styles.label}>{label}</div>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  label: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-subtle)",
    marginBottom: 6,
  },
};
