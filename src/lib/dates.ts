// Date helpers on plain YYYY-MM-DD strings (UTC, which is also Liberia's time zone).
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

export function monthStart(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`;
}
