// The "AI never invents numbers" check.
// Every number the AI writes must appear in the tool results, the context the
// server gave it, or the user's own message. Small bare whole numbers (counts,
// days of the month) are allowed; money amounts are never exempt.

const NUM = /(L\$|\$|US\$|LRD\s?|USD\s?)?(\d[\d,]*(?:\.\d+)?)/gi;

function normalise(s: string): string | null {
  const v = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  return String(Math.round(v * 100) / 100);
}

export function numbersIn(text: string): { raw: string; value: string; money: boolean }[] {
  const out: { raw: string; value: string; money: boolean }[] = [];
  for (const m of text.matchAll(NUM)) {
    const value = normalise(m[2]);
    if (value !== null) out.push({ raw: m[0], value, money: Boolean(m[1]) });
  }
  return out;
}

export function allowedNumbers(sources: string[]): Set<string> {
  const s = new Set<string>();
  for (const src of sources) for (const n of numbersIn(src)) s.add(n.value);
  return s;
}

/** Returns the numbers in `reply` that are not backed by any source. */
export function unbackedNumbers(reply: string, sources: string[]): string[] {
  const allowed = allowedNumbers(sources);
  const bad: string[] = [];
  for (const n of numbersIn(reply)) {
    if (allowed.has(n.value)) continue;
    const v = Number(n.value);
    const smallCount = !n.money && Number.isInteger(v) && v <= 31;
    const year = !n.money && Number.isInteger(v) && v >= 2020 && v <= 2100;
    if (smallCount || year) continue;
    bad.push(n.raw.trim());
  }
  return bad;
}
