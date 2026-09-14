import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Modal } from "../components/Modal";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { branchService, type Branch } from "../services/branch.service";
import { useBranchStore } from "../store/useBranchStore";
import { usePremium } from "../store/usePremium";
import { mapPremiumError } from "../lib/premium";
import { pageTitle, subtitle, btn, table, th, td, badge, emptyState } from "../ui/ui";

const smallBtn = (variant: "secondary" | "ghost"): CSSProperties => ({
  ...btn(variant),
  padding: "6px 12px",
  fontSize: 13,
});

export default function Sucursales() {
  const { branches, activeBranchId, loading, error, setActiveBranch, loadBranches } = useBranchStore();
  const { isPremium } = usePremium();

  // Los tenants free pueden tener 1 sucursal. Crear una segunda es solo premium.
  const branchLimitReached = !isPremium && branches.length >= 1;

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState("");
  // Campos de ubicacion (strings en el input; se convierten a number|null al enviar).
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Sucursales" });
    loadBranches();
  }, [loadBranches]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setAddress("");
    setCity("");
    setLatitude("");
    setLongitude("");
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (b: Branch) => {
    setEditing(b);
    setName(b.name);
    setAddress(b.address ?? "");
    setCity(b.city ?? "");
    setLatitude(b.latitude != null ? String(b.latitude) : "");
    setLongitude(b.longitude != null ? String(b.longitude) : "");
    setFormError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("El nombre es obligatorio.");
      return;
    }
    // Decision: el backend create() solo acepta `name`, asi que al CREAR enviamos
    // unicamente el nombre (como hoy). Los campos de ubicacion se guardan al EDITAR
    // via update() (que si los acepta). Se mantiene simple y sin romper el gating.
    setSaving(true);
    setFormError("");
    try {
      if (editing) {
        // Validacion ligera en cliente; el backend valida los rangos definitivos.
        const latTrim = latitude.trim();
        const lngTrim = longitude.trim();
        let latValue: number | null = null;
        let lngValue: number | null = null;

        if (latTrim !== "") {
          const parsed = Number(latTrim);
          if (isNaN(parsed) || parsed < -90 || parsed > 90) {
            setFormError("Latitud inválida (-90 a 90)");
            setSaving(false);
            return;
          }
          latValue = parsed;
        }
        if (lngTrim !== "") {
          const parsed = Number(lngTrim);
          if (isNaN(parsed) || parsed < -180 || parsed > 180) {
            setFormError("Longitud inválida (-180 a 180)");
            setSaving(false);
            return;
          }
          lngValue = parsed;
        }

        await branchService.update(editing.id, {
          name: name.trim(),
          address: address.trim() === "" ? null : address.trim(),
          city: city.trim() === "" ? null : city.trim(),
          latitude: latValue,
          longitude: lngValue,
        });
      } else {
        await branchService.create(name.trim());
      }
      setModalOpen(false);
      await loadBranches();
    } catch (err) {
      setFormError(
        mapPremiumError(err, "Agregar más de una sucursal es solo para premium.", "No se pudo guardar la sucursal")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (b: Branch) => {
    const nextStatus = b.status === "active" ? "inactive" : "active";
    if (nextStatus === "inactive" && !window.confirm(`Desactivar la sucursal "${b.name}"?`)) {
      return;
    }
    setBusyId(b.id);
    setActionError("");
    try {
      await branchService.update(b.id, { status: nextStatus });
      await loadBranches();
    } catch (err) {
      setActionError(
        mapPremiumError(err, "Gestionar más de una sucursal es solo para premium.", "No se pudo cambiar el estado")
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={pageTitle}>Sucursales</h1>
          <p style={subtitle}>Administra las sucursales de tu negocio y elige la sucursal activa.</p>
          {!isPremium && (
            <p style={styles.freeNote}>
              En el plan gratuito solo puedes gestionar tu sucursal principal. Al reactivar premium recuperas el resto.
            </p>
          )}
        </div>
        <div style={styles.headerAction}>
          {branchLimitReached && (
            <span style={badge("warning")} title="Agregar más de una sucursal es solo para premium.">
              Solo premium
            </span>
          )}
          <button
            style={branchLimitReached ? { ...btn("primary"), opacity: 0.6, cursor: "not-allowed" } : btn("primary")}
            onClick={openCreate}
            disabled={branchLimitReached}
            title={branchLimitReached ? "Agregar más de una sucursal es solo para premium." : undefined}
          >
            + Nueva sucursal
          </button>
        </div>
      </div>

      {loading && branches.length === 0 && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {error && branches.length === 0 && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={() => loadBranches()} style={btn("secondary")}>
            Reintentar
          </button>
        </div>
      )}

      {actionError && <div style={styles.formError}>{actionError}</div>}

      {!loading && !error && branches.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🏢</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin sucursales</p>
          <p>Crea tu primera sucursal para configurar horarios, categorias y tu codigo.</p>
        </div>
      )}

      {branches.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Nombre</th>
                <th style={th}>Ciudad</th>
                <th style={th}>Estado</th>
                <th style={th}>Codigo</th>
                <th style={{ ...th, textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const isActiveBranch = b.id === activeBranchId;
                return (
                  <tr key={b.id}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontWeight: 600 }}>{b.name}</span>
                        {isActiveBranch && <span style={badge("info")}>Activa</span>}
                      </div>
                    </td>
                    <td style={{ ...td, color: b.city ? undefined : "var(--text-muted)" }}>{b.city || "—"}</td>
                    <td style={td}>
                      {b.status === "active" ? (
                        <span style={badge("success")}>Activa</span>
                      ) : (
                        <span style={badge("muted")}>Inactiva</span>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", letterSpacing: "0.08em" }}>
                      {b.booking_code || "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={styles.actions}>
                        <button
                          style={isActiveBranch ? { ...smallBtn("secondary"), opacity: 0.6 } : smallBtn("secondary")}
                          onClick={() => setActiveBranch(b.id)}
                          disabled={isActiveBranch}
                        >
                          {isActiveBranch ? "En uso" : "Usar"}
                        </button>
                        <button style={smallBtn("secondary")} onClick={() => openEdit(b)}>
                          Editar
                        </button>
                        <button
                          style={smallBtn("ghost")}
                          onClick={() => handleToggleStatus(b)}
                          disabled={busyId === b.id}
                        >
                          {busyId === b.id ? "..." : b.status === "active" ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        title={editing ? "Editar sucursal" : "Nueva sucursal"}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          {formError && <div style={styles.formError}>{formError}</div>}
          <div style={styles.field}>
            <label htmlFor="branch-name">Nombre *</label>
            <input id="branch-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>

          {editing ? (
            <>
              <div style={styles.field}>
                <label htmlFor="branch-address">Dirección</label>
                <input id="branch-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle y número, colonia" />
              </div>
              <div style={styles.field}>
                <label htmlFor="branch-city">Ciudad</label>
                <input id="branch-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ciudad" />
              </div>
              <div style={styles.coordsRow}>
                <div style={{ ...styles.field, flex: 1, marginBottom: 0 }}>
                  <label htmlFor="branch-lat">Latitud</label>
                  <input
                    id="branch-lat"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="19.4326"
                  />
                </div>
                <div style={{ ...styles.field, flex: 1, marginBottom: 0 }}>
                  <label htmlFor="branch-lng">Longitud</label>
                  <input
                    id="branch-lng"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="-99.1332"
                  />
                </div>
              </div>
              <p style={styles.helpText}>
                Pega tu latitud y longitud desde Google Maps (clic derecho sobre tu ubicación &gt; la primera opción copia
                las coordenadas).
              </p>
            </>
          ) : (
            <p style={styles.helpText}>Podrás configurar la dirección y ubicación de la sucursal al editarla.</p>
          )}

          <div style={styles.formActions}>
            <button type="button" style={btn("secondary")} onClick={() => setModalOpen(false)}>
              Cancelar
            </button>
            <button type="submit" style={btn("primary")} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  freeNote: { color: "var(--text-muted)", fontSize: 13, marginTop: 6, maxWidth: 520 },
  headerAction: { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  actions: { display: "inline-flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 },
  coordsRow: { display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  helpText: { color: "var(--text-muted)", fontSize: 12, marginTop: 0, marginBottom: 14, lineHeight: 1.4 },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
};
