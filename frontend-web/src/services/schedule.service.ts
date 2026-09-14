import api from "./api";

// Un dia del horario semanal. day_of_week: 0=domingo .. 6=sabado.
export interface ScheduleDay {
  day_of_week: number;
  open_time: string; // "HH:MM"
  close_time: string; // "HH:MM"
  is_active: boolean;
}

export interface Schedule {
  id: string | null;
  timezone: string | null;
  days: ScheduleDay[];
}

export interface SchedulePayload {
  timezone?: string;
  days: Array<{
    day_of_week: number;
    open_time: string;
    close_time: string;
    is_active?: boolean;
  }>;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const scheduleService = {
  async get(): Promise<Schedule> {
    const res = await api.get("/availability/schedule");
    const payload = unwrap<Schedule>(res.data);
    return {
      id: payload?.id ?? null,
      timezone: payload?.timezone ?? null,
      days: payload?.days ?? [],
    };
  },

  async update(payload: SchedulePayload): Promise<Schedule> {
    const res = await api.post("/availability/schedule", payload);
    const data = unwrap<Schedule>(res.data);
    return {
      id: data?.id ?? null,
      timezone: data?.timezone ?? null,
      days: data?.days ?? [],
    };
  },
};
