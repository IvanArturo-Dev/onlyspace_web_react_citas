import { useEffect, useState } from "react";
import { card, subtitle, btn, badge, table, th, td, emptyState } from "../ui/ui";
import {
  waitlistService,
  type AtRiskAppointment,
  type WaitlistEntry,
} from "../services/waitlist.service";
import type { Service } from "../types";

interface WaitlistPanelProps {
  // Servicios del negocio, para poder consultar la cola por servicio. Opcional:
  // si no llegan, se ofrece un selector vacío y se muestra el aviso.
  services?: Service[];
}

// Panel del emprendedor: lista "Espacios en riesgo (próximas 12h)" y permite ver la
// cola de espera (FIFO) de un servicio en una fecha concreta.
export function WaitlistPanel({ services = [] }: WaitlistPanelProps) {
  const [atRisk, setAtRisk] = useState<AtRiskAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    waitlistService
      .atRisk()
      .then(setAtRisk)
      .catch((err) => setError(readError(err, "No se pudieron cargar los espacios en riesgo")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            Espacios en riesgo (próximas 12h)
          </h2>
          <p style={{ ...subtitle, marginTop: 4 }}>
            Citas pendientes de confirmar. Si se caen, puedes ofrecer el hueco a la lista de espera.
          </p>
        </div>
        <button type="button" style={btn("secondary")} onClick={load} disabled={loading}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">
          Cargando espacios en riesgo...
        </p>
      ) : error ? (
        <div role="alert">
          <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
          <button type="button" style={btn("secondary")} onClick={load}>
            Reintentar
          </button>
        </div>
      ) : atRisk.length === 0 ? (
        <div style={emptyState}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✅</div>
          <p style={{ fontWeight: 600, color: "var(--text)" }}>Sin espacios en riesgo</p>
          <p>No hay citas pendientes de confirmar en las próximas 12 horas.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Cliente</th>
                <th style={th}>Servicio</th>
                <th style={th}>Hora</th>
                <th style={th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {atRisk.map((a) => (
                <tr key={a.id}>
                  <td style={td}>{a.customer?.name || "—"}</td>
                  <td style={td}>{a.service?.name || "—"}</td>
                  <td style={td}>{formatDateTime(a.start_time)}</td>
                  <td style={td}>
                    <span style={badge("warning")}>{a.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QueueViewer services={services} />
    </div>
  );
}

// Visor de la cola de espera (FIFO) por servicio + fecha.
function QueueViewer({ services }: { services: Service[] }) {
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [queue, setQueue] = useState<WaitlistEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const view = async () => {
    if (!serviceId || !date) {
      setError("Selecciona un servicio y una fecha.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const list = await waitlistService.listQueue(serviceId, date);
      setQueue(list);
    } catch (err) {
      setError(readError(err, "No se pudo cargar la cola de espera"));
      setQueue(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...card, padding: 18, marginTop: 20 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>
        Lista de espera
      </h3>
      <p style={{ ...subtitle, marginBottom: 14 }}>
        Consulta quién está en espera (orden de llegada) para un servicio y fecha.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="wl-service" style={labelStyle}>
            Servicio
          </label>
          <select
            id="wl-service"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            style={{ minWidth: 200 }}
          >
            <option value="">Selecciona un servicio</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="wl-date" style={labelStyle}>
            Fecha
          </label>
          <input id="wl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button type="button" style={btn("primary")} onClick={view} disabled={loading}>
          {loading ? "Cargando..." : "Ver cola"}
        </button>
      </div>

      {error && (
        <div style={alertStyle} role="alert">
          {error}
        </div>
      )}

      {queue !== null &&
        (queue.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No hay clientes en espera para ese servicio y fecha.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Cliente</th>
                  <th style={th}>Hora deseada</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Desde</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((e, i) => (
                  <tr key={e.id}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}>{e.customer_id}</td>
                    <td style={td}>{e.desired_start ? formatDateTime(e.desired_start) : "—"}</td>
                    <td style={td}>
                      <span style={badge("info")}>{e.status}</span>
                    </td>
                    <td style={td}>{formatDateTime(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  fontWeight: 600,
};

const alertStyle: React.CSSProperties = {
  background: "var(--danger-soft)",
  color: "var(--danger)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  marginBottom: 14,
  fontSize: 14,
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}
