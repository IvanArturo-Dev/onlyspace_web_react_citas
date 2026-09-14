import { useState } from "react";
import { Modal } from "./Modal";
import { btn, badge } from "../ui/ui";
import { waitlistService, type WaitlistEntry } from "../services/waitlist.service";

interface WaitlistReassignModalProps {
  open: boolean;
  onClose: () => void;
  // Entrada de la lista de espera sugerida por el backend tras liberar el hueco.
  entry: WaitlistEntry;
  // Inicio/fin (ISO) del hueco liberado por la cita cancelada.
  slotStart: string;
  slotEnd: string;
  // branch_id del hueco liberado (opcional).
  branchId?: string | null;
  // Nombre del cliente en espera, si se conoce (para el mensaje).
  customerName?: string | null;
}

// Modal "Se liberó un espacio": al cancelar una cita, si hay un cliente en espera
// (FIFO), permite ofrecerle el hueco, generar el mensaje de WhatsApp y marcar la
// oferta como confirmada. La reasignación NO es automática: el emprendedor decide.
export function WaitlistReassignModal({
  open,
  onClose,
  entry,
  slotStart,
  slotEnd,
  branchId,
  customerName,
}: WaitlistReassignModalProps) {
  // Fase del flujo: idle -> offered (ya se ofreció y abrió WhatsApp) -> confirmed.
  const [phase, setPhase] = useState<"idle" | "offered" | "confirmed">("idle");
  const [offering, setOffering] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const resetAndClose = () => {
    setPhase("idle");
    setOffering(false);
    setConfirming(false);
    setError("");
    setInfo("");
    onClose();
  };

  // Ofrece el hueco a la entrada y abre WhatsApp con el mensaje "espacio abierto".
  const handleOffer = async () => {
    setOffering(true);
    setError("");
    setInfo("");
    try {
      await waitlistService.offer(entry.id, {
        start: slotStart,
        end: slotEnd,
        branch_id: branchId ?? undefined,
      });
      const wa = await waitlistService.whatsapp(entry.id);
      window.open(wa.url, "_blank", "noopener,noreferrer");
      setPhase("offered");
      setInfo("Abrimos WhatsApp con el mensaje listo para enviar.");
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (code === "SLOT_TAKEN") {
        setError("El horario ya no está disponible (fue tomado). No se pudo ofrecer.");
      } else if (code === "CUSTOMER_HAS_DEBT") {
        setError("El cliente en espera tiene una deuda pendiente y no puede recibir la oferta.");
      } else {
        setError(readError(err, "No se pudo ofrecer el espacio"));
      }
    } finally {
      setOffering(false);
    }
  };

  // Marca la oferta como confirmada (el cliente aceptó).
  const handleConfirm = async () => {
    setConfirming(true);
    setError("");
    setInfo("");
    try {
      await waitlistService.confirm(entry.id);
      setPhase("confirmed");
      setInfo("Oferta confirmada. La cita quedó reasignada.");
    } catch (err) {
      setError(readError(err, "No se pudo confirmar la oferta"));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Se liberó un espacio"
      onClose={resetAndClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={btn("secondary")} onClick={resetAndClose}>
            Cerrar
          </button>
        </div>
      }
    >
      <div>
        <p style={{ marginTop: 0, color: "var(--text)" }}>
          Hay un cliente en la lista de espera para este servicio. Puedes ofrecerle el horario que
          acaba de quedar libre y avisarle por WhatsApp.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={badge("info")}>En espera</span>
            <strong style={{ color: "var(--text)" }}>{customerName || "Cliente en espera"}</strong>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
            Horario liberado: {formatRange(slotStart, slotEnd)}
          </div>
        </div>

        {error && (
          <div style={alertStyle} role="alert">
            {error}
          </div>
        )}
        {info && (
          <div style={infoStyle} role="status" aria-live="polite">
            {info}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {phase !== "confirmed" && (
            <button type="button" style={btn("primary")} onClick={handleOffer} disabled={offering}>
              {offering ? "Ofreciendo..." : phase === "offered" ? "Reenviar WhatsApp" : "Ofrecer y generar WhatsApp"}
            </button>
          )}
          {phase === "offered" && (
            <button type="button" style={btn("secondary")} onClick={handleConfirm} disabled={confirming}>
              {confirming ? "Confirmando..." : "Marcar confirmada"}
            </button>
          )}
        </div>
      </div>
    </Modal>
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

const infoStyle: React.CSSProperties = {
  background: "var(--success-soft)",
  color: "var(--success)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
  marginBottom: 14,
  fontSize: 14,
};

function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (isNaN(s.getTime())) return "";
  const day = s.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  const hs = s.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const he = isNaN(e.getTime())
    ? ""
    : e.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return he ? `${day}, ${hs} - ${he}` : `${day}, ${hs}`;
}

function readError(err: any, fallback: string): string {
  return err?.response?.data?.error?.message || err?.message || fallback;
}
