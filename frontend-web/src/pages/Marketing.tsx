import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Modal } from "../components/Modal";
import Spinner from "../components/Spinner";
import PromoCard from "../components/ads/PromoCard";
import { trackEvent } from "../lib/firebase";
import { useBrandingStore } from "../store/useBrandingStore";
import { usePremium } from "../store/usePremium";
import { mapPremiumError } from "../lib/premium";
import {
  brandingService,
  type Ad,
  type AdInput,
  type Branding,
  type BrandingInput,
} from "../services/branding.service";
import { tenantService } from "../services/tenant.service";
import { pageTitle, subtitle, btn, card, badge, table, th, td, emptyState } from "../ui/ui";

const smallBtn = (variant: "primary" | "secondary" | "ghost" | "danger"): CSSProperties => ({
  ...btn(variant),
  padding: "6px 12px",
  fontSize: 13,
});

// Aplica el aspecto "deshabilitado" (atenuado + cursor) cuando el boton no puede usarse.
const disabledBtnStyle = (base: CSSProperties, disabled: boolean): CSSProperties =>
  disabled ? { ...base, opacity: 0.6, cursor: "not-allowed" } : base;

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

function readErrorCode(err: any): string | undefined {
  return err?.response?.data?.error?.code;
}

// #RGB o #RRGGBB. El backend valida y responde 400 VALIDATION_ERROR si no cumple.
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Valida que una URL tenga formato http(s). Se usa antes de enviar los anuncios
// para dar feedback inmediato al usuario (el backend tambien valida).
function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface BrandingFormState {
  logo_url: string;
  brand_color: string;
  banner_title: string;
  banner_text: string;
  banner_link: string;
}

const emptyBrandingForm: BrandingFormState = {
  logo_url: "",
  brand_color: "",
  banner_title: "",
  banner_text: "",
  banner_link: "",
};

function toForm(b: Branding): BrandingFormState {
  return {
    logo_url: b.logo_url ?? "",
    brand_color: b.brand_color ?? "",
    banner_title: b.banner_title ?? "",
    banner_text: b.banner_text ?? "",
    banner_link: b.banner_link ?? "",
  };
}

// Convierte el formulario a payload; strings vacios -> null para limpiar el campo.
function toBrandingInput(f: BrandingFormState): BrandingInput {
  const norm = (v: string) => (v.trim() ? v.trim() : null);
  return {
    logo_url: norm(f.logo_url),
    brand_color: norm(f.brand_color),
    banner_title: norm(f.banner_title),
    banner_text: norm(f.banner_text),
    banner_link: norm(f.banner_link),
  };
}

interface AdFormState {
  title: string;
  body: string;
  image_url: string;
  link_url: string;
  is_active: boolean;
}

const emptyAdForm: AdFormState = {
  title: "",
  body: "",
  image_url: "",
  link_url: "",
  is_active: true,
};

/**
 * Personalizacion del emprendedor (ADMIN). Branding + anuncios propios.
 * La edicion SIEMPRE funciona; el efecto en el portal del cliente depende de que
 * el super admin active la suscripcion premium del tenant (aviso explicito arriba).
 */
export default function Marketing() {
  // Plan premium del tenant (best-effort). Solo cambia el aviso informativo:
  // la edicion y el guardado SIEMPRE funcionan, sin borrar datos.
  const { isPremium } = usePremium();

  // ------- DATOS DEL NEGOCIO (nombre editable, NO premium) -------
  const [nameValue, setNameValue] = useState("");
  const [nameLoading, setNameLoading] = useState(true);
  const [nameError, setNameError] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState("");

  const loadTenantName = useCallback(() => {
    setNameLoading(true);
    setNameError("");
    tenantService
      .getMine()
      .then((t) => setNameValue(t.name ?? ""))
      .catch((err) => setNameError(readError(err, "No se pudo cargar el nombre del negocio.")))
      .finally(() => setNameLoading(false));
  }, []);

  // ------- BRANDING -------
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingForm, setBrandingForm] = useState<BrandingFormState>(emptyBrandingForm);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingError, setBrandingError] = useState("");
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState("");

  const loadBranding = useCallback(() => {
    setBrandingLoading(true);
    setBrandingError("");
    brandingService
      .getBranding()
      .then((b) => {
        setBranding(b);
        setBrandingForm(toForm(b));
      })
      .catch((err) => setBrandingError(readError(err, "No se pudo cargar la personalizacion.")))
      .finally(() => setBrandingLoading(false));
  }, []);

  // ------- ANUNCIOS -------
  const [ads, setAds] = useState<Ad[]>([]);
  const [adsLoading, setAdsLoading] = useState(true);
  const [adsError, setAdsError] = useState("");

  const loadAds = useCallback(() => {
    setAdsLoading(true);
    setAdsError("");
    brandingService
      .listAds()
      .then((list) => setAds(list))
      .catch((err) => setAdsError(readError(err, "No se pudieron cargar los anuncios.")))
      .finally(() => setAdsLoading(false));
  }, []);

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Marketing" });
    loadTenantName();
    loadBranding();
    loadAds();
  }, [loadTenantName, loadBranding, loadAds]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameValue.trim();
    if (!name) {
      setNameError("El nombre del negocio es obligatorio.");
      setNameMsg("");
      return;
    }
    setNameSaving(true);
    setNameError("");
    setNameMsg("");
    try {
      const updated = await tenantService.updateName(name);
      setNameValue(updated.name);
      setNameMsg("Nombre actualizado.");
    } catch (err: any) {
      if (readErrorCode(err) === "VALIDATION_ERROR") {
        setNameError("El nombre del negocio es obligatorio y no puede superar los 100 caracteres.");
      } else {
        setNameError(readError(err, "No se pudo guardar el nombre del negocio."));
      }
    } finally {
      setNameSaving(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    // Free: la personalizacion es solo lectura. No intentamos guardar.
    if (!isPremium) {
      setBrandingError("La personalizacion es solo para premium.");
      setBrandingMsg("");
      return;
    }
    // Validacion local del color para dar feedback inmediato (el backend tambien valida).
    if (brandingForm.brand_color.trim() && !HEX_RE.test(brandingForm.brand_color.trim())) {
      setBrandingError("El color de marca debe ser un hexadecimal valido (#RGB o #RRGGBB).");
      setBrandingMsg("");
      return;
    }
    setBrandingSaving(true);
    setBrandingError("");
    setBrandingMsg("");
    try {
      // Guardar via el store compartido: actualiza al instante el menu (Layout)
      // y el Dashboard del emprendedor sin recargar la pagina.
      const updated = await useBrandingStore.getState().save(toBrandingInput(brandingForm));
      setBranding(updated);
      setBrandingForm(toForm(updated));
      setBrandingMsg("Personalizacion guardada.");
    } catch (err: any) {
      if (readErrorCode(err) === "VALIDATION_ERROR") {
        setBrandingError("El color de marca debe ser un hexadecimal valido (#RGB o #RRGGBB).");
      } else {
        // Si el backend rechaza por premium (403 PREMIUM_REQUIRED) mostramos el
        // mensaje especifico; de lo contrario, el error generico.
        setBrandingError(
          mapPremiumError(err, "La personalizacion es solo para premium.", "No se pudo guardar la personalizacion.")
        );
      }
    } finally {
      setBrandingSaving(false);
    }
  };

  // ------- MODAL DE ANUNCIO -------
  const [adModalOpen, setAdModalOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<Ad | null>(null);
  const [adForm, setAdForm] = useState<AdFormState>(emptyAdForm);
  const [adError, setAdError] = useState("");
  const [adSaving, setAdSaving] = useState(false);
  const [adBusyId, setAdBusyId] = useState<string | null>(null);

  const openCreateAd = () => {
    if (!isPremium) return; // Free: la creacion esta bloqueada (boton ya deshabilitado).
    setEditingAd(null);
    setAdForm(emptyAdForm);
    setAdError("");
    setAdModalOpen(true);
  };

  const openEditAd = (ad: Ad) => {
    if (!isPremium) return; // Free: la edicion esta bloqueada (boton ya deshabilitado).
    setEditingAd(ad);
    setAdForm({
      title: ad.title,
      body: ad.body ?? "",
      image_url: ad.image_url ?? "",
      link_url: ad.link_url ?? "",
      is_active: ad.is_active,
    });
    setAdError("");
    setAdModalOpen(true);
  };

  const handleSaveAd = async (e: React.FormEvent) => {
    e.preventDefault();
    // Free: los anuncios son solo lectura. No intentamos guardar.
    if (!isPremium) {
      setAdError("Los anuncios son solo para premium. Activalo para publicarlos.");
      return;
    }
    const title = adForm.title.trim();
    if (!title) {
      setAdError("El titulo es obligatorio.");
      return;
    }
    // Validacion de formato de URLs en cliente (feedback inmediato).
    if (adForm.image_url.trim() && !isValidHttpUrl(adForm.image_url)) {
      setAdError("La URL de imagen debe empezar por http:// o https://.");
      return;
    }
    if (adForm.link_url.trim() && !isValidHttpUrl(adForm.link_url)) {
      setAdError("La URL de enlace debe empezar por http:// o https://.");
      return;
    }
    const norm = (v: string) => (v.trim() ? v.trim() : null);
    const input: AdInput = {
      title,
      body: norm(adForm.body),
      image_url: norm(adForm.image_url),
      link_url: norm(adForm.link_url),
      is_active: adForm.is_active,
    };
    setAdSaving(true);
    setAdError("");
    try {
      if (editingAd) {
        await brandingService.updateAd(editingAd.id, input);
      } else {
        await brandingService.createAd(input);
      }
      setAdModalOpen(false);
      loadAds();
    } catch (err: any) {
      if (readErrorCode(err) === "VALIDATION_ERROR") {
        setAdError("Revisa los datos: el titulo es obligatorio y las URLs deben ser validas.");
      } else {
        // Si el backend rechaza por premium (403 PREMIUM_REQUIRED) mostramos el
        // mensaje especifico; de lo contrario, el error generico.
        setAdError(
          mapPremiumError(
            err,
            "Los anuncios son solo para premium. Activalo para publicarlos.",
            "No se pudo guardar el anuncio."
          )
        );
      }
    } finally {
      setAdSaving(false);
    }
  };

  // Accion en curso por fila: distingue activar/desactivar de eliminar para el texto de progreso.
  const [adBusyAction, setAdBusyAction] = useState<"toggle" | "delete" | null>(null);

  const handleToggleAd = async (ad: Ad) => {
    if (!isPremium) {
      setAdsError("Los anuncios son solo para premium. Activalo para publicarlos.");
      return;
    }
    setAdBusyId(ad.id);
    setAdBusyAction("toggle");
    setAdsError("");
    try {
      await brandingService.updateAd(ad.id, { is_active: !ad.is_active });
      loadAds();
    } catch (err: any) {
      setAdsError(
        mapPremiumError(
          err,
          "Los anuncios son solo para premium. Activalo para publicarlos.",
          "No se pudo actualizar el anuncio."
        )
      );
    } finally {
      setAdBusyId(null);
      setAdBusyAction(null);
    }
  };

  const handleDeleteAd = async (ad: Ad) => {
    if (!isPremium) {
      setAdsError("Los anuncios son solo para premium. Activalo para publicarlos.");
      return;
    }
    if (!window.confirm(`Eliminar el anuncio "${ad.title}"?`)) return;
    setAdBusyId(ad.id);
    setAdBusyAction("delete");
    setAdsError("");
    try {
      await brandingService.deleteAd(ad.id);
      loadAds();
    } catch (err: any) {
      setAdsError(
        mapPremiumError(
          err,
          "Los anuncios son solo para premium. Activalo para publicarlos.",
          "No se pudo eliminar el anuncio."
        )
      );
    } finally {
      setAdBusyId(null);
      setAdBusyAction(null);
    }
  };

  const previewColor = brandingForm.brand_color.trim() && HEX_RE.test(brandingForm.brand_color.trim())
    ? brandingForm.brand_color.trim()
    : "var(--brand)";

  // Color de marca guardado (branding), para la vista previa en vivo del modal.
  const brandingPreviewColor =
    branding?.brand_color && HEX_RE.test(branding.brand_color.trim())
      ? branding.brand_color.trim()
      : "var(--brand)";

  const activeAdCount = ads.filter((a) => a.is_active).length;

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={pageTitle}>Personalizacion</h1>
          <p style={{ ...subtitle, marginTop: 4 }}>
            Configura tu marca y tus anuncios para el portal que ven tus clientes al escanear el QR.
          </p>
        </div>
      </div>

      {/* Aviso honesto: la edicion siempre funciona (no se bloquea ni se borra nada),
          pero el branding solo aparece en el portal del cliente cuando la suscripcion
          premium esta ACTIVA. Para tenants free mostramos el aviso "Solo premium". */}
      <div
        style={{
          ...styles.notice,
          borderLeft: isPremium ? "3px solid var(--info)" : "3px solid var(--warning)",
        }}
      >
        <span style={badge(isPremium ? "info" : "warning")}>{isPremium ? "Suscripcion" : "Solo premium"}</span>
        <div>
          <div style={styles.noticeTitle}>Tu personalizacion se guarda siempre</div>
          <p style={styles.noticeText}>
            {isPremium
              ? "El logo, color, banner y anuncios ya se muestran en el portal de tus clientes con tu suscripcion premium activa."
              : "Solo premium: tu personalizacion se mostrara a los clientes cuando actives premium. Puedes prepararla y guardarla aqui desde ya."}
          </p>
        </div>
      </div>

      {/* ------- DATOS DEL NEGOCIO -------
          El nombre del negocio es un dato BASICO: cualquier ADMIN puede editarlo,
          sea premium o NO. Por eso NO se bloquea con la leyenda "Solo premium". */}
      <section style={{ ...card, ...styles.section }}>
        <h2 style={styles.sectionTitle}>Datos del negocio</h2>
        {nameLoading ? (
          <div style={styles.loading}><Spinner /> Cargando...</div>
        ) : (
          <form onSubmit={handleSaveName}>
            <div style={styles.field}>
              <label htmlFor="business-name">Nombre del negocio</label>
              <input
                id="business-name"
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                placeholder="Nombre de tu negocio"
                maxLength={100}
              />
            </div>

            {nameError && (
              <div style={styles.formError} role="alert">
                {nameError}
              </div>
            )}
            {nameMsg && <div style={styles.formOk}>{nameMsg}</div>}

            <div style={styles.formActions}>
              <button type="submit" style={btn("primary")} disabled={nameSaving}>
                {nameSaving ? "Guardando..." : "Guardar nombre"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ------- BRANDING ------- */}
      <section style={{ ...card, ...styles.section }}>
        <h2 style={styles.sectionTitle}>Marca</h2>
        {brandingLoading ? (
          <div style={styles.loading}><Spinner /> Cargando...</div>
        ) : (
          <form onSubmit={handleSaveBranding}>
            <div style={styles.grid}>
              <div style={styles.field}>
                <label htmlFor="branding-logo">Logo (URL)</label>
                <input
                  id="branding-logo"
                  type="url"
                  value={brandingForm.logo_url}
                  onChange={(e) => setBrandingForm({ ...brandingForm, logo_url: e.target.value })}
                  placeholder="https://..."
                  disabled={!isPremium}
                />
              </div>

              <div style={styles.field}>
                <label htmlFor="branding-color-text">Color de marca</label>
                <div style={styles.colorRow}>
                  <input
                    type="color"
                    value={HEX_RE.test(brandingForm.brand_color.trim()) ? brandingForm.brand_color.trim() : "#4f46e5"}
                    onChange={(e) => setBrandingForm({ ...brandingForm, brand_color: e.target.value })}
                    style={styles.colorInput}
                    aria-label="Selector de color de marca"
                    disabled={!isPremium}
                  />
                  <input
                    id="branding-color-text"
                    type="text"
                    value={brandingForm.brand_color}
                    onChange={(e) => setBrandingForm({ ...brandingForm, brand_color: e.target.value })}
                    placeholder="#4f46e5"
                    style={{ flex: 1 }}
                    disabled={!isPremium}
                  />
                  <span style={{ ...styles.swatch, background: previewColor }} aria-hidden="true" />
                </div>
              </div>
            </div>

            <div style={styles.field}>
              <label htmlFor="branding-banner-title">Titulo del banner</label>
              <input
                id="branding-banner-title"
                value={brandingForm.banner_title}
                onChange={(e) => setBrandingForm({ ...brandingForm, banner_title: e.target.value })}
                placeholder="Promocion de temporada"
                disabled={!isPremium}
              />
            </div>

            <div style={styles.field}>
              <label htmlFor="branding-banner-text">Texto del banner</label>
              <textarea
                id="branding-banner-text"
                value={brandingForm.banner_text}
                onChange={(e) => setBrandingForm({ ...brandingForm, banner_text: e.target.value })}
                rows={3}
                placeholder="Cuentale a tus clientes lo que ofreces."
                disabled={!isPremium}
              />
            </div>

            <div style={styles.field}>
              <label htmlFor="branding-banner-link">Enlace del banner (URL)</label>
              <input
                id="branding-banner-link"
                type="url"
                value={brandingForm.banner_link}
                onChange={(e) => setBrandingForm({ ...brandingForm, banner_link: e.target.value })}
                placeholder="https://..."
                disabled={!isPremium}
              />
            </div>

            {brandingError && <div style={styles.formError}>{brandingError}</div>}
            {brandingMsg && <div style={styles.formOk}>{brandingMsg}</div>}

            <div style={styles.formActions}>
              {!isPremium && (
                <span style={styles.readonlyHint}>
                  Solo premium: tu personalizacion se mostrara al activar premium.
                </span>
              )}
              <button
                type="submit"
                style={!isPremium ? { ...btn("primary"), opacity: 0.6, cursor: "not-allowed" } : btn("primary")}
                disabled={brandingSaving || !isPremium}
                title={!isPremium ? "La personalizacion es solo para premium." : undefined}
              >
                {brandingSaving ? "Guardando..." : "Guardar marca"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ------- ANUNCIOS ------- */}
      <section style={{ ...card, ...styles.section }}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitleRow}>
            <h2 style={{ ...styles.sectionTitle, margin: 0 }}>Anuncios</h2>
            {!isPremium && (
              <span style={badge("warning")} title="Los anuncios son solo para premium.">
                Solo premium
              </span>
            )}
          </div>
          <button
            type="button"
            style={!isPremium ? { ...btn("primary"), opacity: 0.6, cursor: "not-allowed" } : btn("primary")}
            onClick={openCreateAd}
            disabled={!isPremium}
            title={!isPremium ? "Los anuncios son solo para premium." : undefined}
            aria-label={!isPremium ? "Nuevo anuncio (solo premium)" : "Nuevo anuncio"}
          >
            Nuevo anuncio
          </button>
        </div>

        {!isPremium && (
          <p style={styles.sectionHint}>
            Solo premium: puedes ver la lista y la vista previa, pero para crear, editar o eliminar anuncios necesitas
            activar premium.
          </p>
        )}

        {adsError && (
          <div style={styles.formError} role="alert">
            {adsError}
          </div>
        )}

        {!adsLoading && ads.length > 0 && activeAdCount === 0 && (
          <div style={styles.warnNote} role="status">
            <span style={badge("warning")}>Sin anuncios activos</span>
            <span>Ningun anuncio esta activo ahora mismo, asi que no se mostrara ninguno en tu portal.</span>
          </div>
        )}

        {adsLoading ? (
          <div style={styles.loading}><Spinner /> Cargando...</div>
        ) : ads.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>📣</div>
            <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin anuncios</p>
            <p>Crea tu primer anuncio para promocionarlo en tu portal.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Imagen</th>
                  <th style={th}>Titulo</th>
                  <th style={th}>Estado</th>
                  <th style={{ ...th, minWidth: 260 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => {
                  const busy = adBusyId === ad.id;
                  return (
                    <tr key={ad.id}>
                      <td style={td}>
                        {ad.image_url ? (
                          <img src={ad.image_url} alt={`Imagen del anuncio ${ad.title}`} style={styles.thumb} loading="lazy" />
                        ) : (
                          <span style={{ ...subtitle, fontSize: 13 }}>—</span>
                        )}
                      </td>
                      <td style={td}>{ad.title}</td>
                      <td style={td}>
                        {ad.is_active ? (
                          <span style={badge("success")}>Activo</span>
                        ) : (
                          <span style={badge("muted")}>Inactivo</span>
                        )}
                      </td>
                      <td style={td}>
                        <div style={styles.actions}>
                          <button
                            type="button"
                            style={disabledBtnStyle(smallBtn("secondary"), !isPremium)}
                            onClick={() => handleToggleAd(ad)}
                            disabled={busy || !isPremium}
                            title={!isPremium ? "Los anuncios son solo para premium." : undefined}
                            aria-label={
                              ad.is_active ? `Desactivar anuncio ${ad.title}` : `Activar anuncio ${ad.title}`
                            }
                          >
                            {busy && adBusyAction === "toggle"
                              ? "Guardando..."
                              : ad.is_active
                                ? "Desactivar"
                                : "Activar"}
                          </button>
                          <button
                            type="button"
                            style={disabledBtnStyle(smallBtn("secondary"), !isPremium)}
                            onClick={() => openEditAd(ad)}
                            disabled={busy || !isPremium}
                            title={!isPremium ? "Los anuncios son solo para premium." : undefined}
                            aria-label={`Editar anuncio ${ad.title}`}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            style={disabledBtnStyle({ ...smallBtn("ghost"), color: "var(--danger)" }, !isPremium)}
                            onClick={() => handleDeleteAd(ad)}
                            disabled={busy || !isPremium}
                            title={!isPremium ? "Los anuncios son solo para premium." : undefined}
                            aria-label={`Eliminar anuncio ${ad.title}`}
                          >
                            {busy && adBusyAction === "delete" ? "Eliminando..." : "Eliminar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Vista previa de cada anuncio con la misma tarjeta que ve el cliente. */}
            <div style={styles.previewGrid}>
              {ads.map((ad) => (
                <PromoCard
                  key={ad.id}
                  title={ad.title}
                  body={ad.body ?? undefined}
                  imageUrl={ad.image_url ?? undefined}
                  linkUrl={ad.link_url ?? undefined}
                  brandColor={previewColor}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <Modal
        open={adModalOpen}
        title={editingAd ? "Editar anuncio" : "Nuevo anuncio"}
        onClose={() => setAdModalOpen(false)}
        footer={
          <div style={styles.formActions}>
            <button type="button" style={btn("secondary")} onClick={() => setAdModalOpen(false)}>
              Cancelar
            </button>
            <button
              type="submit"
              form="ad-form"
              style={disabledBtnStyle(btn("primary"), !isPremium)}
              disabled={adSaving || !isPremium}
              title={!isPremium ? "Los anuncios son solo para premium." : undefined}
            >
              {adSaving ? "Guardando..." : editingAd ? "Guardar" : "Crear"}
            </button>
          </div>
        }
      >
        <form id="ad-form" onSubmit={handleSaveAd}>
          <div style={styles.field}>
            <label htmlFor="ad-title">Titulo *</label>
            <input
              id="ad-title"
              value={adForm.title}
              onChange={(e) => setAdForm({ ...adForm, title: e.target.value })}
              required
              autoFocus
              disabled={!isPremium}
            />
          </div>
          <div style={styles.field}>
            <label htmlFor="ad-body">Texto</label>
            <textarea
              id="ad-body"
              value={adForm.body}
              onChange={(e) => setAdForm({ ...adForm, body: e.target.value })}
              rows={3}
              disabled={!isPremium}
            />
          </div>
          <div style={styles.field}>
            <label htmlFor="ad-image">Imagen (URL)</label>
            <input
              id="ad-image"
              type="url"
              value={adForm.image_url}
              onChange={(e) => setAdForm({ ...adForm, image_url: e.target.value })}
              placeholder="https://..."
              disabled={!isPremium}
            />
          </div>
          <div style={styles.field}>
            <label htmlFor="ad-link">Enlace (URL)</label>
            <input
              id="ad-link"
              type="url"
              value={adForm.link_url}
              onChange={(e) => setAdForm({ ...adForm, link_url: e.target.value })}
              placeholder="https://..."
              disabled={!isPremium}
            />
          </div>
          <label htmlFor="ad-active" style={styles.checkRow}>
            <input
              id="ad-active"
              type="checkbox"
              checked={adForm.is_active}
              onChange={(e) => setAdForm({ ...adForm, is_active: e.target.checked })}
              disabled={!isPremium}
            />
            <span>Activo</span>
          </label>

          {!isPremium && (
            <div style={styles.formError} role="alert">
              Los anuncios son solo para premium. Activalo para publicarlos.
            </div>
          )}
          {adError && (
            <div style={styles.formError} role="alert">
              {adError}
            </div>
          )}

          {/* Vista previa EN VIVO: se actualiza mientras el usuario edita. */}
          <div style={styles.previewBlock}>
            <div style={styles.previewLabel}>Vista previa</div>
            <PromoCard
              title={adForm.title.trim() || "Titulo del anuncio"}
              body={adForm.body.trim() || undefined}
              imageUrl={adForm.image_url.trim() && isValidHttpUrl(adForm.image_url) ? adForm.image_url.trim() : undefined}
              linkUrl={adForm.link_url.trim() && isValidHttpUrl(adForm.link_url) ? adForm.link_url.trim() : undefined}
              brandColor={brandingPreviewColor}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20, flexWrap: "wrap" },
  notice: {
    ...card,
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    padding: 16,
    marginBottom: 20,
    borderLeft: "3px solid var(--info)",
  },
  noticeTitle: { fontSize: 15, fontWeight: 700, color: "var(--text)" },
  noticeText: { fontSize: 14, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 },
  section: { padding: 20, marginBottom: 20 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  sectionTitle: { fontSize: 17, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" },
  sectionTitleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  sectionHint: { fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.5 },
  warnNote: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    fontSize: 13,
    color: "var(--text-muted)",
    background: "var(--warning-soft)",
    padding: "10px 12px",
    borderRadius: "var(--radius-sm)",
    marginBottom: 14,
  },
  previewBlock: { marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" },
  previewLabel: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 10 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
  colorRow: { display: "flex", alignItems: "center", gap: 10 },
  colorInput: { width: 44, height: 38, padding: 2, borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)", background: "var(--surface)", cursor: "pointer" },
  swatch: { width: 38, height: 38, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", flexShrink: 0 },
  checkRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 14, color: "var(--text)" },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formOk: { background: "var(--success-soft)", color: "var(--success)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" },
  readonlyHint: { fontSize: 13, color: "var(--text-muted)", marginRight: "auto" },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  thumb: { width: 56, height: 40, objectFit: "cover", borderRadius: "var(--radius-sm)", display: "block" },
  actions: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  previewGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16, marginTop: 20 },
};
