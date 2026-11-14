// Paleta del dashboard (14-11-2026): un color por pestaña y una escala de 6 tonos derivada de ese color.
// Se define UNA sola vez acá; el CSS la recibe como variables (--acc-0 … --acc-5) y los gráficos la leen de PaletaContext.
// Fondo siempre oscuro. Los únicos colores que se repiten entre pestañas son los de estado (rojo/ámbar/verde).
import { createContext, useContext } from "react";

export type TabId = "resumen" | "equipo" | "seguimientos" | "metas" | "tendencias" | "ciclo" | "cobranza" | "clientes" | "numeros" | "graficos" | "hoy" | "ads" | "centro";

// Color base de cada pestaña: 13 tonos claramente distintos, legibles sobre fondo oscuro
export const BASE: Record<TabId, string> = {
  resumen: "#3B82F6", // azul
  equipo: "#8B5CF6", // violeta
  seguimientos: "#F97316", // naranja
  metas: "#84CC16", // verde (lima)
  tendencias: "#38BDF8", // celeste
  ciclo: "#FACC15", // amarillo
  cobranza: "#10B981", // esmeralda
  // 15-11: pestañas del Tracker. Dorado/ámbar e índigo pedidos; "lima" choca con Metas (#84CC16) → verde claro libre más cercano
  clientes: "#D9A23A", // dorado / ámbar
  numeros: "#6366F1", // índigo
  graficos: "#4ADE80", // verde claro
  hoy: "#D946EF", // magenta
  ads: "#FB7185", // coral
  centro: "#2DD4BF", // turquesa
};

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const aHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mezclar = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return aHex(x.map((v, i) => v + (y[i] - v) * t)); };

// Escala de 6 pasos, de más oscuro a más claro: 0 muy oscuro · 1 oscuro · 2 base · 3 claro · 4 más claro · 5 muy claro
export function escala(base: string): string[] {
  return [mezclar(base, "#000000", 0.45), mezclar(base, "#000000", 0.22), base, mezclar(base, "#ffffff", 0.3), mezclar(base, "#ffffff", 0.52), mezclar(base, "#ffffff", 0.72)];
}

export const PaletaContext = createContext<string[]>(escala(BASE.resumen));
export const usePaleta = () => useContext(PaletaContext);

// Series de gráficos por papel, siempre en tonos de la pestaña (nunca colores de otra)
export const TONO = { fuerte: 2, oscuro: 1, claro: 4, medio: 3, muyOscuro: 0, muyClaro: 5 } as const;
// Producto y closer: cada uno con su tono fijo dentro del color de la pestaña
export const TONO_PRODUCTO: Record<string, number> = { DFY: 1, JessiK: 4 };
export const TONO_CLOSER: Record<string, number> = { Luca: 1, Jenny: 2, Mileces: 4, Ale: 5 };

// Variables CSS de la pestaña activa
export const varsPestana = (tab: TabId) => {
  const e = escala(BASE[tab]);
  return Object.fromEntries(e.map((c, i) => [`--acc-${i}`, c])) as Record<string, string>;
};
