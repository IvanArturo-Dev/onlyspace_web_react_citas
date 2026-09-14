import { useCallback, useEffect, useRef, useState } from "react";

export interface PollingState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  lastUpdated: Date | null;
  reconnecting: boolean;
}

// Hook de polling: hace un fetch inicial y repite cada intervalMs.
// - Pausa el polling cuando la pestana esta oculta (document.hidden) y refresca al volver visible.
// - Ante error conserva el ultimo data y marca reconnecting=true; al siguiente exito lo limpia.
export function usePolling<T>(fetchFn: () => Promise<T>, intervalMs: number): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  // Mantiene la referencia mas reciente de fetchFn sin reiniciar el efecto.
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const hasDataRef = useRef(false);

  const run = useCallback(async () => {
    try {
      const result = await fetchRef.current();
      setData(result);
      hasDataRef.current = true;
      setError(null);
      setReconnecting(false);
      setLastUpdated(new Date());
    } catch (err) {
      // Conserva el ultimo data; si ya habia datos, entra en modo reconexion.
      setError(err);
      if (hasDataRef.current) {
        setReconnecting(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        if (!document.hidden) {
          void run();
        }
      }, intervalMs);
    };

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        // Pausa: al ocultar la pestana no consultamos.
        stop();
      } else {
        // Al volver visible: refresca de inmediato y reanuda.
        void run();
        start();
      }
    };

    // Fetch inicial + arranque del polling (si la pestana esta visible).
    void run();
    if (!document.hidden) {
      start();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [run, intervalMs]);

  return { data, error, loading, lastUpdated, reconnecting };
}
