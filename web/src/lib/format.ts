const usd0 = new Intl.NumberFormat("es-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("es-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("es-US", { maximumFractionDigits: 0 });

export const money = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : Math.abs(n) >= 1000 ? usd0.format(n) : usd2.format(n));
export const num = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : int.format(n));
export const pct = (n: number | null | undefined, d = 1) => (n == null || !isFinite(n) ? "—" : `${(n * 100).toFixed(d)}%`);
export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const costPer = (spend: number, n: number) => (n > 0 && spend > 0 ? spend / n : null);
export const money0 = (n: number) => usd0.format(n);

export const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const shortDate = (s: string) => {
  const [, m, d] = s.split("-");
  return `${Number(d)}/${Number(m)}`;
};

// Minutos → "45 min", "3 h 20 min" o "1.5 días"
export const tiempo = (min: number | null | undefined) => {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h < 24 ? `${h} h ${m} min` : `${(min / 1440).toFixed(1)} días`;
};
