import { useEffect, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate } from "react-router-dom";
import { card, pageTitle, subtitle, btn, field } from "../ui/ui";
import {
  cancellationPolicyService,
  type CancellationPolicy,
  type CancellationPolicyInput,
} from "../services/cancellationPolicy.service";
import { dataService } from "../services/data.service";

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

      {isAdmin && <CancellationPolicyCard />}
      {isAdmin && <BookingSettingsCard />}
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

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}
