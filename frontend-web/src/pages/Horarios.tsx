import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import BranchSelector from "../components/BranchSelector";
import Spinner from "../components/Spinner";
import { trackEvent } from "../lib/firebase";
import { branchService, type BranchScheduleDay as ScheduleDay } from "../services/branch.service";
import { useBranchStore } from "../store/useBranchStore";
import { pageTitle, subtitle, card, btn, emptyState } from "../ui/ui";

// Nombres de los dias indexados por day_of_week (0=domingo .. 6=sabado).
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

// Horario por defecto: Lun-Vie 09:00-18:00 activos, Sab/Dom cerrados.
function defaultDays(): ScheduleDay[] {
  return DAY_NAMES.map((_, day) => {
    const isWeekday = day >= 1 && day <= 5;
    return {
      day_of_week: day,
      open_time: "09:00",
      close_time: "18:00",
      is_active: isWeekday,
    };
  });
}

// Normaliza a 7 dias ordenados por day_of_week, rellenando con los valores por defecto.
function normalizeDays(days: ScheduleDay[]): ScheduleDay[] {
  const defaults = defaultDays();
  return defaults.map((def) => {
    const found = days.find((d) => d.day_of_week === def.day_of_week);
    if (!found) return def;
    return {
      day_of_week: def.day_of_week,
      open_time: found.open_time || def.open_time,
      close_time: found.close_time || def.close_time,
      is_active: Boolean(found.is_active),
    };
  });
}

export default function Horarios() {
  const { activeBranchId } = useBranchStore();
  const [days, setDays] = useState<ScheduleDay[]>(defaultDays());
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    trackEvent("screen_view", { screen_name: "Horarios" });
  }, []);

  useEffect(() => {
    if (!activeBranchId) {
      setDays(defaultDays());
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId]);

  const load = () => {
    if (!activeBranchId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setFormError("");
    branchService
      .getSchedule(activeBranchId)
      .then((schedule) => {
        setTimezone(schedule.timezone);
        setDays(normalizeDays(schedule.days));
      })
      .catch((err) => setError(readError(err, "Error al cargar el horario")))
      .finally(() => setLoading(false));
  };

  const updateDay = (dayOfWeek: number, patch: Partial<ScheduleDay>) => {
    setSuccess("");
    setFormError("");
    setDays((prev) => prev.map((d) => (d.day_of_week === dayOfWeek ? { ...d, ...patch } : d)));
  };

  const handleSave = async () => {
    if (!activeBranchId) return;
    setFormError("");
    setSuccess("");

    const activeDays = days.filter((d) => d.is_active);
    // Valida que en los dias activos la hora de apertura sea menor a la de cierre.
    const invalid = activeDays.find((d) => d.open_time >= d.close_time);
    if (invalid) {
      setFormError(
        `En ${DAY_NAMES[invalid.day_of_week]}, la hora de apertura debe ser menor a la de cierre.`
      );
      return;
    }

    setSaving(true);
    try {
      const payload = {
        timezone: timezone || undefined,
        days: activeDays.map((d) => ({
          day_of_week: d.day_of_week,
          open_time: d.open_time,
          close_time: d.close_time,
          is_active: true,
        })),
      };
      const updated = await branchService.updateSchedule(activeBranchId, payload);
      setTimezone(updated.timezone);
      setDays(normalizeDays(updated.days.length ? updated.days : days));
      setSuccess("Horario guardado");
    } catch (err) {
      setFormError(readError(err, "No se pudo guardar el horario"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={styles.headerRow}>
        <div>
          <h1 style={pageTitle}>Horarios</h1>
          <p style={subtitle}>Define los dias y rangos en los que atiendes.</p>
        </div>
        <button style={btn("primary")} onClick={handleSave} disabled={saving || loading || !activeBranchId}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </div>

      <BranchSelector />

      {!activeBranchId && (
        <div style={emptyState}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🏢</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Selecciona una sucursal</p>
          <p>Elige una sucursal activa para configurar su horario.</p>
        </div>
      )}

      {activeBranchId && loading && (
        <div style={styles.loading}>
          <Spinner /> Cargando...
        </div>
      )}

      {activeBranchId && error && !loading && (
        <div>
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button onClick={load} style={btn("secondary")}>
            Reintentar
          </button>
        </div>
      )}

      {activeBranchId && !loading && !error && (
        <>
          {formError && <div style={styles.formError}>{formError}</div>}
          {success && <div style={styles.success}>{success}</div>}

          <div style={{ ...card, padding: 8 }}>
            {days.map((d) => (
              <div key={d.day_of_week} style={styles.dayRow}>
                <label style={styles.dayToggle}>
                  <input
                    type="checkbox"
                    checked={d.is_active}
                    onChange={(e) => updateDay(d.day_of_week, { is_active: e.target.checked })}
                  />
                  <span style={styles.dayName}>{DAY_NAMES[d.day_of_week]}</span>
                </label>

                <div style={styles.timeGroup}>
                  <input
                    type="time"
                    aria-label={`Hora de apertura ${DAY_NAMES[d.day_of_week]}`}
                    value={d.open_time}
                    disabled={!d.is_active}
                    onChange={(e) => updateDay(d.day_of_week, { open_time: e.target.value })}
                    style={{ ...styles.timeInput, ...(d.is_active ? {} : styles.timeDisabled) }}
                  />
                  <span style={styles.timeSep}>a</span>
                  <input
                    type="time"
                    aria-label={`Hora de cierre ${DAY_NAMES[d.day_of_week]}`}
                    value={d.close_time}
                    disabled={!d.is_active}
                    onChange={(e) => updateDay(d.day_of_week, { close_time: e.target.value })}
                    style={{ ...styles.timeInput, ...(d.is_active ? {} : styles.timeDisabled) }}
                  />
                  {!d.is_active && <span style={styles.closedTag}>Cerrado</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

const styles: Record<string, CSSProperties> = {
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 },
  loading: { display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)" },
  formError: { background: "var(--danger-soft)", color: "var(--danger)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  success: { background: "var(--success-soft)", color: "var(--success)", padding: 10, borderRadius: "var(--radius-sm)", marginBottom: 14, fontSize: 14 },
  dayRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 12px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  },
  dayToggle: { display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", minWidth: 140 },
  dayName: { fontWeight: 600, color: "var(--text)", fontSize: 14 },
  timeGroup: { display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  timeInput: { width: 130 },
  timeDisabled: { opacity: 0.5 },
  timeSep: { color: "var(--text-muted)", fontSize: 14 },
  closedTag: { color: "var(--text-subtle)", fontSize: 13, fontStyle: "italic" },
};
