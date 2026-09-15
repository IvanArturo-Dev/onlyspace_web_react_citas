import api from "./api";
import type { Service } from "../types";
import type { ServicePayload } from "./data.service";

// Sucursal del emprendedor. portal_path es el enlace relativo del portal publico.
export interface Branch {
  id: string;
  name: string;
  status: string; // active | inactive
  booking_code: string | null;
  timezone: string | null;
  portal_path: string;
  // Ubicacion de la sucursal (coincide con BranchView del backend).
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  // Enlace de Google Maps de la sucursal (Compartir > Copiar vinculo).
  // Reemplaza el enfoque de coordenadas manuales como flujo principal.
  maps_url: string | null;
}

// Dia de asueto de una sucursal.
export interface Holiday {
  id: string;
  date: string; // "YYYY-MM-DD"
  label: string | null;
}

// Un dia del horario semanal de la sucursal. day_of_week: 0=domingo .. 6=sabado.
export interface BranchScheduleDay {
  day_of_week: number;
  open_time: string; // "HH:MM"
  close_time: string; // "HH:MM"
  is_active: boolean;
}

export interface BranchSchedule {
  id: string | null;
  timezone: string | null;
  days: BranchScheduleDay[];
}

export interface BranchSchedulePayload {
  timezone?: string;
  days: Array<{
    day_of_week: number;
    open_time: string;
    close_time: string;
    is_active?: boolean;
  }>;
}

export interface BranchUpdatePayload {
  name?: string;
  status?: string;
  // Ubicacion opcional; null limpia el valor en el backend.
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  // Enlace de Google Maps (URL http/https) o null para limpiarlo.
  maps_url?: string | null;
}

export interface HolidayPayload {
  date: string; // "YYYY-MM-DD"
  label?: string;
}

// Desenvuelve respuestas del backend con forma { success, data }.
function unwrap<T>(data: any): T {
  if (data && typeof data === "object" && "data" in data) return data.data as T;
  return data as T;
}

export const branchService = {
  // ------- SUCURSALES -------
  async list(): Promise<Branch[]> {
    const res = await api.get("/branches");
    return unwrap<Branch[]>(res.data) ?? [];
  },

  async create(name: string): Promise<Branch> {
    const res = await api.post("/branches", { name });
    return unwrap<Branch>(res.data);
  },

  async update(id: string, payload: BranchUpdatePayload): Promise<Branch> {
    const res = await api.patch(`/branches/${id}`, payload);
    return unwrap<Branch>(res.data);
  },

  async get(id: string): Promise<Branch> {
    const res = await api.get(`/branches/${id}`);
    return unwrap<Branch>(res.data);
  },

  // ------- HORARIO -------
  async getSchedule(branchId: string): Promise<BranchSchedule> {
    const res = await api.get(`/branches/${branchId}/schedule`);
    const payload = unwrap<BranchSchedule>(res.data);
    return {
      id: payload?.id ?? null,
      timezone: payload?.timezone ?? null,
      days: payload?.days ?? [],
    };
  },

  async updateSchedule(branchId: string, payload: BranchSchedulePayload): Promise<BranchSchedule> {
    const res = await api.post(`/branches/${branchId}/schedule`, payload);
    const data = unwrap<BranchSchedule>(res.data);
    return {
      id: data?.id ?? null,
      timezone: data?.timezone ?? null,
      days: data?.days ?? [],
    };
  },

  // ------- DIAS DE ASUETO -------
  async listHolidays(branchId: string): Promise<Holiday[]> {
    const res = await api.get(`/branches/${branchId}/holidays`);
    return unwrap<Holiday[]>(res.data) ?? [];
  },

  async addHoliday(branchId: string, payload: HolidayPayload): Promise<Holiday> {
    const res = await api.post(`/branches/${branchId}/holidays`, payload);
    return unwrap<Holiday>(res.data);
  },

  async removeHoliday(branchId: string, holidayId: string): Promise<void> {
    await api.delete(`/branches/${branchId}/holidays/${holidayId}`);
  },

  // ------- CATEGORIAS POR SUCURSAL -------
  async listServices(branchId: string): Promise<Service[]> {
    const res = await api.get(`/branches/${branchId}/services`);
    return unwrap<Service[]>(res.data) ?? [];
  },

  async createService(branchId: string, payload: ServicePayload): Promise<Service> {
    const res = await api.post(`/branches/${branchId}/services`, payload);
    return unwrap<Service>(res.data);
  },
};
