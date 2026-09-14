import api from "./api";

// Notificacion in-app entregada al usuario autenticado.
export interface NotificationItem {
  id: string;
  tenant_id: string;
  event_type: string;
  title: string;
  body: string;
  appointment_id: string | null;
  customer_id: string | null;
  read_at: string | null;
  created_at: string;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const notificationService = {
  // Lista notificaciones; con unreadOnly=true solo trae las no leidas.
  async list(unreadOnly = false): Promise<NotificationItem[]> {
    const res = await api.get("/me/notifications", {
      params: unreadOnly ? { unread: 1 } : undefined,
    });
    return unwrap<NotificationItem[]>(res.data) ?? [];
  },

  // Numero de notificaciones no leidas (para badges).
  async unreadCount(): Promise<number> {
    const res = await api.get("/me/notifications/unread-count");
    const data = unwrap<{ count?: number }>(res.data);
    return data?.count ?? 0;
  },

  // Marca una notificacion como leida.
  async markRead(id: string): Promise<void> {
    await api.patch(`/me/notifications/${encodeURIComponent(id)}/read`);
  },

  // Marca todas las notificaciones como leidas.
  async markAllRead(): Promise<void> {
    await api.patch("/me/notifications/read-all");
  },
};
