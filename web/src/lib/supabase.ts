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

export interface FunnelRow {
  producto: string;
  periodo: "actual" | "anterior";
  agendas: number;
  llamadas: number;
  llamadas_pasadas: number;
  canceladas: number;
  asistencias: number;
  asistencias_calificadas: number;
  ofertas: number;
  cierres: number;
  cierres_nuevos: number;
  cierres_seguimiento: number;
  vendido: number;
  cobrado: number;
  vendido_ads: number;
}

export interface ComercialData {
  funnel: FunnelRow[];
  closers: { closer: string; active: boolean; llamadas: number; llamadas_pasadas: number; asistencias: number; ofertas: number; cierres: number; vendido: number; cobrado: number; comision: number; en_seguimiento: number }[];
  objeciones: { motivo: string; producto: string; n: number }[];
  seguimientos: { id: string; nombre: string | null; closer: string | null; producto: string; etapa: string; motivo: string | null; proximo_seguimiento: string | null; primera_llamada: string | null; historico: boolean; dias_en_etapa: number | null }[];
  calidad: { id: string; nombre: string | null; closer: string | null; etapa: string; historico: boolean; problema: string }[];
  cierres: { fecha_cierre: string; nombre: string | null; closer: string | null; producto: string; valor: number; cobrado: number; plan_pago: string | null; metodo_cobro: string | null; saldo_pendiente: number | null; primera_llamada: string | null; dias_a_cierre: number | null; de_ads: boolean; historico: boolean; fuente: string | null }[];
}

export interface EmpresaRow {
  grupo: string;
  orden: number;
  periodo: "actual" | "anterior";
  agendas: number;
  asistencias: number;
  asistencias_calificadas: number;
  ofertas: number;
  cierres: number;
  cierres_seguimiento: number;
  cierres_totales: number;
  clientes_nuevos: number;
  vendido: number;
  cobrado: number;
  comisiones: number;
}

export interface MiDiaData {
  closer: string | null;
  hoy: string;
  llamadas: { id: string; contact_id: string | null; closer: string; hora: string; dia: string; nombre: string | null; telefono: string | null; email: string | null; etapa: string | null; producto: string; fuente: string | null; ingresos: string | null; negocio: string | null; status: string }[];
  seguimientos: { id: string; contact_id: string | null; nombre: string | null; telefono: string | null; closer: string | null; etapa: string; producto: string; motivo: string | null; proximo_seguimiento: string | null; historico: boolean }[];
  pendientes: { id: string; contact_id: string | null; nombre: string | null; closer: string | null; etapa: string; historico: boolean; problema: string }[];
}
