// Frontend types

export interface User {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  permissions: string[];
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  email?: string;
  phone: string;
  birth_date?: string;
  notes?: string;
  tags: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  duration_mins: number;
  price: number;
  category_id?: string;
  image_url?: string;
  color: string;
  is_active: boolean;
  prep_time_mins: number;
  post_time_mins: number;
  capacity?: number;
}

export interface Appointment {
  id: string;
  tenant_id: string;
  branch_id?: string | null;
  customer_id: string;
  customer_name?: string;
  service_id: string;
  service_name?: string;
  professional_id?: string;
  professional_name?: string;
  // Objetos anidados que el backend incluye en los listados
  customer?: Customer;
  service?: Service;
  // Quien agendo desde el portal de reservas (si aplica)
  booked_by_email?: string | null;
  booked_by_name?: string | null;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  notes?: string;
  location?: string;
  video_call_url?: string;
  // Modalidad de la cita: "in_person" (presencial) o "online" (en linea).
  modality?: string | null;
  // Pago manual (total/parcial/pagado) registrado por el negocio
  payment_status?: PaymentStatus;
  amount_total?: number;
  amount_paid?: number;
  currency?: string;
  created_at: string;
  updated_at: string;
}

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface Notification {
  id: string;
  tenant_id: string;
  customer_id?: string;
  professional_id?: string;
  appointment_id?: string;
  channel: 'PUSH' | 'EMAIL' | 'SMS';
  status: 'PENDING' | 'SENT' | 'FAILED';
  title: string;
  body: string;
  sent_at?: string;
}
