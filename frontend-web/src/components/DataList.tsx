import { useEffect, useState } from "react";

interface DataListProps<T> {
  title: string;
  fetcher: () => Promise<T[]>;
  renderItem: (item: T) => React.ReactNode;
  emptyText: string;
}

export function DataList<T>({ title, fetcher, renderItem, emptyText }: DataListProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    fetcher()
      .then((data) => setItems(data))
      .catch((err) => setError(err?.response?.data?.error?.message || "Error al cargar datos"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>{title}</h1>
      {loading && <p style={{ color: "#6b7280" }}>Cargando...</p>}
      {error && (
        <div>
          <p style={{ color: "#dc2626", marginBottom: 8 }}>{error}</p>
          <button onClick={load} style={{ padding: "8px 16px", border: "1px solid #d1d5db", borderRadius: 8, background: "#fff" }}>
            Reintentar
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && <p style={{ color: "#6b7280" }}>{emptyText}</p>}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item, i) => (
            <div key={i} style={{ background: "#fff", padding: 16, borderRadius: 8, border: "1px solid #e5e7eb" }}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
