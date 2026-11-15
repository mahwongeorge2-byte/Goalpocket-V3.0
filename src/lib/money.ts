// Money helpers. All amounts are integer cents. No floating-point sums.
export type Currency = 'USD' | 'LRD';

/** Convert cents between currencies at `lrdPerUsd` Liberian dollars per 1 US dollar. */
export function convertCents(cents: number, from: Currency, to: Currency, lrdPerUsd: number): number {
  if (from === to) return cents;
  if (!(lrdPerUsd > 0)) throw new Error('Exchange rate must be greater than zero');
  const raw = from === 'USD' ? cents * lrdPerUsd : cents / lrdPerUsd;
  return roundHalfUp(raw);
}

export function roundHalfUp(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** "$1,234.56" or "L$2,150" (Liberian dollar amounts drop .00). */
export function formatMoney(cents: number, currency: Currency): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = whole.toLocaleString('en-US');
  let body: string;
  if (currency === 'USD') body = `$${wholeStr}.${String(frac).padStart(2, '0')}`;
  else body = frac === 0 ? `L$${wholeStr}` : `L$${wholeStr}.${String(frac).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

/** Turn a user amount like 15 or 15.5 into cents. Returns null if invalid. */
export function toCents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return cents > 0 ? cents : null;
}

export function formatRate(lrdPerUsd: number): string {
  const r = Number.isInteger(lrdPerUsd) ? String(lrdPerUsd) : lrdPerUsd.toFixed(2);
  return `L$${r} = $1`;
}
