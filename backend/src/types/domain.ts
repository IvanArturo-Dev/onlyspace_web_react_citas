// Domain models

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  domain?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  tenant_id: string;
  role_id?: string;
  name: string;
  email: string;
  phone?: string;
  password_hash: string;
  avatar?: string;
  is_active: boolean;
  last_login?: string;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_id: string;
  professional_id?: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  notes?: string;
  location?: string;
  video_call_url?: string;
  created_at: string;
  updated_at: string;
}

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Notification {
  id: string;
  tenant_id: string;
  customer_id?: string;
  professional_id?: string;
  appointment_id?: string;
  template_id?: string;
  channel: 'PUSH' | 'EMAIL' | 'SMS';
  status: 'PENDING' | 'SENT' | 'FAILED';
  title: string;
  body: string;
  sent_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
