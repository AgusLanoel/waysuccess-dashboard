import { createClient } from "@supabase/supabase-js";

// URL y clave publicable del proyecto: son públicas por diseño (los datos los protege RLS + login).
export const supabase = createClient(
  "https://iqiyhlcqnxwtdhmmrlsp.supabase.co",
  "sb_publishable_ksz73Q2yla8YN_n5U2demg_5800pWmg",
);

export type Level = "campaign" | "adset" | "ad";

export interface ReportRow {
  entity_id: string;
  entity_name: string;
  parent_name: string | null;
  status: string | null;
  thumbnail_url: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  meta_schedules: number;
  agendas: number;
  preview_url?: string | null;
  page_id?: string | null;
  calificadas: number;
  calificadas_jessik: number;
  asistencias: number;
  ofertas: number;
  cierres: number;
  vendido: number;
  cobrado: number;
}

export interface DailyRow {
  d: string;
  spend: number;
  agendas: number;
  calificadas: number;
  asistencias: number;
  cierres: number;
  cobrado: number;
  meta_schedules: number;
}

export interface SyncRow {
  source: string;
  last_ok: string | null;
  last_error: string | null;
}

export interface CierreRow {
  fecha: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  closer: string | null;
  modalidad: string | null;
  vendido: number;
  cobrado: number;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  ad_id: string | null;
  preview_url: string | null;
  page_id: string | null;
  cuenta: string;
}
