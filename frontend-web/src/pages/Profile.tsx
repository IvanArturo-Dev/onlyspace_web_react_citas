import { useEffect, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate } from "react-router-dom";
import { card, pageTitle, subtitle, btn, field } from "../ui/ui";
import {
  cancellationPolicyService,
  type CancellationPolicy,
  type CancellationPolicyInput,
} from "../services/cancellationPolicy.service";
import { dataService, type BusinessSettings, type Modality } from "../services/data.service";

export default function Profile() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login");
    } finally {
      setLoggingOut(false);
    }
  };

  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  const isAdmin = user?.role === "ADMIN";

  return (
    <div>
      <h1 style={pageTitle}>Perfil</h1>
      <div style={{ ...card, padding: 24, maxWidth: 440, marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--brand)",
              color: "var(--brand-contrast)",
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            {initial}
          </div>
          <div>
            <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{user?.name}</p>
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>{user?.email}</p>
          </div>
        </div>
        <button onClick={handleLogout} style={btn("danger")} disabled={loggingOut}>
          {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
        </button>
      </div>

      {isAdmin && <BusinessSettingsCard />}
      {isAdmin && <CancellationPolicyCard />}
      {isAdmin && <BookingSettingsCard />}
    </div>
  );
}

// Tarjeta de configuracion del negocio (solo ADMIN): modalidad ofrecida,
// auto-asignacion de la lista de espera y visibilidad del contacto en el portal
// publico. Carga con getBusinessSettings y guarda con updateBusinessSettings
// (Requirements 2.1, 2.4, 4.1, 6.1).
// Opciones de modalidad ofrecida como seleccion multiple (checkboxes). Cada
// negocio puede habilitar cualquier combinacion de presencial / en linea / a
// domicilio, con al menos una seleccionada (Requirements 1.1, 1.4).
const MODALITY_OPTIONS: { value: Modality; label: string }[] = [
  { value: "in_person", label: "Presencial" },
  { value: "online", label: "En línea" },
  { value: "home", label: "A domicilio" },
];

function BusinessSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [success, setSuccess] = useState("");

  // Lista de modalidades ofrecidas (seleccion multiple). Al menos una debe
  // quedar marcada (Requirements 1.1, 1.4).
  const [offeredModalities, setOfferedModalities] = useState<Modality[]>(["in_person"]);
  const [waitlistAutoAssign, setWaitlistAutoAssign] = useState(false);
  const [showContact, setShowContact] = useState(false);
  // Recargo por servicio a domicilio (>= 0; 0 = sin costo adicional). Solo es
  // relevante cuando el negocio ofrece la modalidad 'home' (Requirements 1.1, 1.2, 1.5).
  const [homeServiceFee, setHomeServiceFee] = useState<number>(0);

  const applySettings = (s: BusinessSettings) => {
    // Preferimos offered_modalities; si viene vacio o ausente, derivamos de la
    // modalidad legacy (in_person->[in_person], online->[online],
    // both->[in_person,online]) y por ultimo caemos a ["in_person"].
    let mods = s.offered_modalities ?? [];
    if (mods.length === 0) {
      if (s.offered_modality === "online") mods = ["online"];
      else if (s.offered_modality === "both") mods = ["in_person", "online"];
      else if (s.offered_modality === "in_person") mods = ["in_person"];
    }
    setOfferedModalities(mods.length > 0 ? mods : ["in_person"]);
    setWaitlistAutoAssign(Boolean(s.waitlist_auto_assign));
    setShowContact(Boolean(s.show_contact));
    // Normaliza el recargo a domicilio a un numero valido (0 por defecto).
    setHomeServiceFee(Number(s.home_service_fee ?? 0));
  };

  // Marca/desmarca una modalidad. Impide dejar la lista vacia: no se puede
  // desmarcar la ultima modalidad seleccionada (Requirements 1.1).
  const toggleModality = (value: Modality, checked: boolean) => {
    setSaveError("");
    setOfferedModalities((prev) => {
      if (checked) {
        return prev.includes(value) ? prev : [...prev, value];
      }
      // Evita quedarse sin ninguna seleccionada.
      if (prev.length <= 1) return prev;
      return prev.filter((m) => m !== value);
    });
  };

  const load = () => {
    setLoading(true);
    setLoadError("");
    dataService
      .getBusinessSettings()
      .then(applySettings)
      .catch((err) => setLoadError(readError(err, "No se pudo cargar la configuración del negocio")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError("");
    setSuccess("");
    // Validacion: al menos una modalidad debe quedar seleccionada.
    if (offeredModalities.length === 0) {
      setSaveError("Selecciona al menos una modalidad.");
      return;
    }
    // Validacion: el recargo a domicilio debe ser un numero >= 0 (0 = sin costo).
    if (!Number.isFinite(homeServiceFee) || homeServiceFee < 0) {
      setSaveError("El recargo a domicilio debe ser un número mayor o igual a 0.");
      return;
    }
    setSaving(true);
    try {
      const updated = await dataService.updateBusinessSettings({
        offered_modalities: offeredModalities,
        waitlist_auto_assign: waitlistAutoAssign,
        show_contact: showContact,
        home_service_fee: homeServiceFee,
      });
      applySettings(updated);
      setSuccess("Configuración guardada correctamente.");
    } catch (err: any) {
      if (err?.response?.data?.error?.code === "VALIDATION_ERROR") {
        setSaveError("Alguno de los valores no es válido. Revisa la configuración.");
      } else if (err?.response?.status === 403) {
        setSaveError("No tienes permisos para editar la configuración del negocio.");
      } else {
        setSaveError(readError(err, "No se pudo guardar la configuración"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, padding: 24, maxWidth: 520, marginTop: 20 }}>
      <h2 style={{ ...pageTitle, fontSize: 18 }}>Configuración del negocio</h2>
      <p style={{ ...subtitle, marginTop: 4, marginBottom: 16 }}>
        Elige la modalidad que ofreces, si asignas la lista de espera automáticamente y si muestras
        tus datos de contacto en el portal.
      </p>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">
          Cargando configuración...
        </p>
      ) : loadError ? (
        <div role="alert">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{loadError}</p>
          <button type="button" style={btn("secondary")} onClick={load}>
            Reintentar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {saveError && (
            <div style={alertStyle} role="alert">
              {saveError}
            </div>
          )}
          {success && (
            <div style={successStyle} role="status" aria-live="polite">
              {success}
            </div>
          )}

          <div style={field}>
            <span id="bset-modality-label" style={{ fontWeight: 600, color: "var(--text)" }}>
              Modalidad ofrecida
            </span>
            {/* Seleccion multiple: puede ofrecer presencial, en linea y/o a
                domicilio. Cada checkbox tiene su label asociado (Requirements 1.1, 1.4). */}
            <div
              role="group"
              aria-labelledby="bset-modality-label"
              aria-describedby="bset-modality-help"
              style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}
            >
              {MODALITY_OPTIONS.map((opt) => {
                const checked = offeredModalities.includes(opt.value);
                // La ultima modalidad marcada no puede desmarcarse (lista no vacia).
                const isLastChecked = checked && offeredModalities.length <= 1;
                return (
                  <label
                    key={opt.value}
                    htmlFor={`bset-modality-${opt.value}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                  >
                    <input
                      id={`bset-modality-${opt.value}`}
                      type="checkbox"
                      checked={checked}
                      disabled={isLastChecked}
                      onChange={(e) => toggleModality(opt.value, e.target.checked)}
                    />
                    <span style={{ color: "var(--text)" }}>{opt.label}</span>
                  </label>
                );
              })}
            </div>
            <p id="bset-modality-help" style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              Marca las modalidades que ofreces: puedes combinar presencial, en línea y/o a domicilio.
              Debes dejar al menos una seleccionada. Si eliges una sola, el selector de modalidad no
              aparece al reservar y se usa esa directamente.
            </p>
          </div>

          {/* Recargo a domicilio: solo se muestra si el negocio ofrece la
              modalidad 'home'. 0 = sin costo adicional (Requirements 1.1, 1.2, 1.5). */}
          {offeredModalities.includes("home") && (
            <div style={field}>
              <label htmlFor="bset-home-fee">Recargo a domicilio</label>
              <input
                id="bset-home-fee"
                type="number"
                min={0}
                step={1}
                value={homeServiceFee}
                onChange={(e) => {
                  setSaveError("");
                  setHomeServiceFee(Number(e.target.value));
                }}
                aria-describedby="bset-home-fee-help"
              />
              <p id="bset-home-fee-help" style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                0 = sin costo adicional. Se muestra al cliente al elegir servicio a domicilio.
              </p>
            </div>
          )}

          <label htmlFor="bset-waitlist" style={toggleRowStyle}>
            <input
              id="bset-waitlist"
              type="checkbox"
              checked={waitlistAutoAssign}
              onChange={(e) => setWaitlistAutoAssign(e.target.checked)}
            />
            <span>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>Auto-asignar lista de espera</span>
              <span style={{ display: "block", fontSize: 13, color: "var(--text-muted)" }}>
                Cuando se libera un espacio (p. ej. una cancelación), se asigna automáticamente al primer
                cliente compatible de la lista de espera (por orden de llegada).
              </span>
            </span>
          </label>

          <label htmlFor="bset-contact" style={toggleRowStyle}>
            <input
              id="bset-contact"
              type="checkbox"
              checked={showContact}
              onChange={(e) => setShowContact(e.target.checked)}
            />
            <span>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>
                Mostrar mis datos de contacto en el portal
              </span>
              <span style={{ display: "block", fontSize: 13, color: "var(--text-muted)" }}>
                Si está activo, tus clientes verán tus datos de contacto (p. ej. WhatsApp) en el portal
                público.
              </span>
            </span>
          </label>

          <button type="submit" style={btn("primary")} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </form>
      )}
    </div>
  );
}

// Tarjeta de configuracion de agendado (solo ADMIN). Controla el horizonte de
// agendado: hasta cuantos dias en el futuro puede reservar un cliente.
function BookingSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [success, setSuccess] = useState("");
  // Se maneja como texto para no forzar 0 mientras el usuario escribe.
  const [horizonDays, setHorizonDays] = useState("");

  const load = () => {
    setLoading(true);
    setLoadError("");
    dataService
      .getBookingSettings()
      .then((s) => setHorizonDays(String(s.booking_horizon_days ?? 0)))
      .catch((err) => setLoadError(readError(err, "No se pudo cargar la configuración de agendado")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError("");
    setSuccess("");

    const n = Number(horizonDays);
    if (horizonDays.trim() === "" || !Number.isInteger(n) || n < 0) {
      setSaveError("Ingresa un número entero mayor o igual a 0.");
      return;
    }

    setSaving(true);
    try {
      const updated = await dataService.updateBookingSettings(n);
      setHorizonDays(String(updated.booking_horizon_days ?? n));
      setSuccess("Configuración guardada correctamente.");
    } catch (err: any) {
      if (err?.response?.data?.error?.code === "VALIDATION_ERROR") {
        setSaveError("El valor no es válido. Debe ser un número entero mayor o igual a 0.");
      } else if (err?.response?.status === 403) {
        setSaveError("No tienes permisos para editar la configuración de agendado.");
      } else {
        setSaveError(readError(err, "No se pudo guardar la configuración"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, padding: 24, maxWidth: 520, marginTop: 20 }}>
      <h2 style={{ ...pageTitle, fontSize: 18 }}>Configuración de agendado</h2>
      <p style={{ ...subtitle, marginTop: 4, marginBottom: 16 }}>
        Define hasta cuántos días en el futuro un cliente puede reservar una cita.
      </p>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">
          Cargando configuración...
        </p>
      ) : loadError ? (
        <div role="alert">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{loadError}</p>
          <button type="button" style={btn("secondary")} onClick={load}>
            Reintentar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {saveError && (
            <div style={alertStyle} role="alert">
              {saveError}
            </div>
          )}
          {success && (
            <div style={successStyle} role="status" aria-live="polite">
              {success}
            </div>
          )}

          <div style={field}>
            <label htmlFor="bs-horizon">Días máximos para agendar por adelantado</label>
            <input
              id="bs-horizon"
              type="number"
              min={0}
              step={1}
              value={horizonDays}
              onChange={(e) => setHorizonDays(e.target.value)}
              aria-describedby="bs-horizon-help"
            />
            <p id="bs-horizon-help" style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              Controla hasta cuántos días en el futuro un cliente puede reservar. Ej: 1 = solo hoy, 7 = una
              semana, 30 = un mes. 0 = sin límite.
            </p>
          </div>

          <button type="submit" style={btn("primary")} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </form>
      )}
    </div>
  );
}

// Tarjeta de configuracion de la politica de cancelacion del negocio (solo ADMIN).
// Carga la politica actual y permite ajustarla con feedback de exito/error.
function CancellationPolicyCard() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [success, setSuccess] = useState("");

  // Los campos se manejan como texto para no forzar 0 mientras el usuario escribe.
  const [graceHours, setGraceHours] = useState("");
  const [allowedCancellations, setAllowedCancellations] = useState("");
  const [penaltyAmount, setPenaltyAmount] = useState("");
  const [resetDays, setResetDays] = useState("");

  const applyPolicy = (p: CancellationPolicy) => {
    setGraceHours(String(p.grace_hours ?? 0));
    setAllowedCancellations(String(p.allowed_cancellations ?? 0));
    setPenaltyAmount(String(p.penalty_amount ?? 0));
    setResetDays(String(p.reset_days ?? 0));
  };

  const load = () => {
    setLoading(true);
    setLoadError("");
    cancellationPolicyService
      .get()
      .then(applyPolicy)
      .catch((err) => setLoadError(readError(err, "No se pudo cargar la política de cancelación")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError("");
    setSuccess("");

    const fields: { value: string; label: string }[] = [
      { value: graceHours, label: "Horas de gracia" },
      { value: allowedCancellations, label: "Cancelaciones permitidas" },
      { value: penaltyAmount, label: "Monto de penalización" },
      { value: resetDays, label: "Reinicio del contador" },
    ];
    for (const f of fields) {
      const n = Number(f.value);
      if (f.value.trim() === "" || !Number.isFinite(n) || n < 0) {
        setSaveError(`"${f.label}" debe ser un número mayor o igual a 0.`);
        return;
      }
    }

    const payload: CancellationPolicyInput = {
      grace_hours: Number(graceHours),
      allowed_cancellations: Number(allowedCancellations),
      penalty_amount: Number(penaltyAmount),
      reset_days: Number(resetDays),
    };

    setSaving(true);
    try {
      const updated = await cancellationPolicyService.update(payload);
      applyPolicy(updated);
      setSuccess("Política guardada correctamente.");
    } catch (err: any) {
      if (err?.response?.data?.error?.code === "VALIDATION_ERROR") {
        setSaveError("Alguno de los valores no es válido. Revisa que sean números mayores o iguales a 0.");
      } else if (err?.response?.status === 403) {
        setSaveError("No tienes permisos para editar la política de cancelación.");
      } else {
        setSaveError(readError(err, "No se pudo guardar la política"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, padding: 24, maxWidth: 520, marginTop: 20 }}>
      <h2 style={{ ...pageTitle, fontSize: 18 }}>Política de cancelación</h2>
      <p style={{ ...subtitle, marginTop: 4, marginBottom: 16 }}>
        Define la ventana de gracia, cuántas cancelaciones permites antes de penalizar y el monto de la
        penalización.
      </p>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">
          Cargando política...
        </p>
      ) : loadError ? (
        <div role="alert">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{loadError}</p>
          <button type="button" style={btn("secondary")} onClick={load}>
            Reintentar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {saveError && (
            <div style={alertStyle} role="alert">
              {saveError}
            </div>
          )}
          {success && (
            <div style={successStyle} role="status" aria-live="polite">
              {success}
            </div>
          )}

          <div style={field}>
            <label htmlFor="cp-grace-hours">Horas de gracia para cancelar</label>
            <input
              id="cp-grace-hours"
              type="number"
              min={0}
              step={1}
              value={graceHours}
              onChange={(e) => setGraceHours(e.target.value)}
            />
          </div>

          <div style={field}>
            <label htmlFor="cp-allowed">Cancelaciones permitidas antes de penalizar</label>
            <input
              id="cp-allowed"
              type="number"
              min={0}
              step={1}
              value={allowedCancellations}
              onChange={(e) => setAllowedCancellations(e.target.value)}
            />
          </div>

          <div style={field}>
            <label htmlFor="cp-penalty">Monto de penalización</label>
            <input
              id="cp-penalty"
              type="number"
              min={0}
              step="0.01"
              value={penaltyAmount}
              onChange={(e) => setPenaltyAmount(e.target.value)}
            />
          </div>

          <div style={field}>
            <label htmlFor="cp-reset">Reinicio del contador (días)</label>
            <input
              id="cp-reset"
              type="number"
              min={0}
              step={1}
              value={resetDays}
              onChange={(e) => setResetDays(e.target.value)}
            />
          </div>

          <button type="submit" style={btn("primary")} disabled={saving}>
            {saving ? "Guardando..." : "Guardar política"}
          </button>
        </form>
      )}
    </div>
  );
}

const alertStyle: React.CSSProperties = {
  background: "var(--danger-soft)",
  color: "var(--danger)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  marginBottom: 14,
  fontSize: 14,
};

const successStyle: React.CSSProperties = {
  background: "var(--success-soft)",
  color: "var(--success)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  marginBottom: 14,
  fontSize: 14,
};

// Fila de toggle con etiqueta + texto explicativo (checkbox alineado arriba).
const toggleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  marginBottom: 16,
  cursor: "pointer",
};

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}
