import api from "./api";

export interface RealtimeActiveUser {
  id: string;
  name: string;
  email: string;
  role: string;
  last_seen: string;
}

export type RealtimeRange = "24h" | "7d" | "30d";

export interface TimeseriesBucket {
  bucket: string; // ISO
  count: number;
}

export interface RealtimeSnapshot {
  range: RealtimeRange;
  active_sessions: {
    count: number;
    users: RealtimeActiveUser[];
  };
  totals: {
    entrepreneurs: number;
    branches: number;
    customers: number;
    services: number;
    appointments: number;
    users: number;
  };
  appointments_by_status: Record<string, number>;
  recent: {
    bookings_24h: number;
    cancellations_24h: number;
  };
  timeseries: {
    bookings: TimeseriesBucket[];
    cancellations: TimeseriesBucket[];
  };
  timestamp: string;
}

export const realtimeAdminService = {
  async getSnapshot(range?: RealtimeRange): Promise<RealtimeSnapshot> {
    const res = await api.get("/admin/realtime", {
      params: range ? { range } : undefined,
    });
    return res.data.data as RealtimeSnapshot;
  },
};
