'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AppState } from '@/lib/state';
import type { Affordability } from '@/lib/engine';
import { formatMoney } from '@/lib/money';
import { prettyDate } from '@/lib/dates';

export { formatMoney, prettyDate };
export type { AppState };

export const field = 'h-11 rounded-xl border border-line bg-white px-3 w-full';

/** Loads /api/state. `reload` after any change so every number comes fresh from the engine. */
export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (r.status === 401) { window.location.href = '/'; return; }
    if (!r.ok) { setError('Could not load your money. Please refresh.'); return; }
    setState(await r.json()); setError('');
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { state, error, reload };
}

export async function post(url: string, body: unknown, method = 'POST') {
  try {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => ({ error: 'The server returned an unreadable response. Please try again.' }));
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach Goalpocket. Check your connection and try again.' } };
  }
}

const TABS = [
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/money', label: 'Money', icon: '👛' },
  { href: '/goal', label: 'Goal', icon: '🎯' },
];

export function Shell({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="max-w-md mx-auto min-h-dvh flex flex-col bg-paper">
      <header className="sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-line px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2 font-head font-bold text-lg">
          <span aria-hidden className="w-7 h-7 rounded-lg bg-green text-gold grid place-items-center text-sm font-extrabold">G</span>{title}
        </div>
        {right}
      </header>
      <div className="flex-1 flex flex-col">{children}</div>
      <nav aria-label="Main" className="sticky bottom-0 bg-white border-t border-line grid grid-cols-3">
        {TABS.map((t) => {
          const on = path === t.href;
          return (
            <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined}
              className={`h-16 grid place-items-center text-xs font-semibold ${on ? 'text-green' : 'text-muted'}`}>
              <span className="grid place-items-center gap-0.5"><span aria-hidden className="text-xl">{t.icon}</span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  // Only add the default white background and border when the caller didn't pick their own.
  const bg = /(^|\s)bg-/.test(className) ? '' : 'bg-white';
  const border = /(^|\s)border-(?!line)/.test(className) ? '' : 'border-line';
  return <section className={`rounded-2xl border p-4 ${bg} ${border} ${className}`}>{children}</section>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 bg-ink/40 flex items-end justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md bg-paper rounded-t-3xl p-5 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-head font-bold text-lg">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-white border border-line">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const VERDICT = {
  yes: { label: 'Yes', box: 'bg-green-tint border-green', text: 'text-green-dk' },
  yes_but: { label: 'Yes, but…', box: 'bg-gold-tint border-gold', text: 'text-caution' },
  not_yet: { label: 'Not yet', box: 'bg-alert-tint border-alert', text: 'text-alert' },
} as const;

/** The "Can I afford it?" answer. Every figure on it comes from the engine. */
export function VerdictCard({ a, home }: { a: Affordability; home: 'USD' | 'LRD' }) {
  const [math, setMath] = useState(false);
  const v = VERDICT[a.verdict];
  return (
    <div className={`rounded-2xl border-2 p-4 ${v.box}`}>
      <p className={`font-head font-extrabold text-2xl ${v.text}`}>{v.label}</p>
      <p className="mt-1 text-sm">{a.reason}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="bg-white/70 rounded-lg p-2"><dt className="text-muted text-xs">Left after</dt><dd className="num font-semibold">{formatMoney(a.leftAfterHomeCents, home)}</dd></div>
        <div className="bg-white/70 rounded-lg p-2"><dt className="text-muted text-xs">Usual week</dt><dd className="num font-semibold">{formatMoney(a.weeklySpendHomeCents, home)}</dd></div>
      </dl>
      {a.goal && a.goal.delayDays !== null && a.goal.delayDays > 0 && (
        <p className="mt-2 text-sm">🎯 {a.goal.name}: about {a.goal.delayDays} days later{a.goal.finishAfter ? ` (${prettyDate(a.goal.finishAfter, true)})` : ''}.</p>
      )}
      {a.roughEstimate && <p className="mt-2 text-xs text-muted">Rough estimate: less than two weeks of entries so far.</p>}
      <button onClick={() => setMath(!math)} aria-expanded={math} className="mt-3 text-sm font-semibold underline">{math ? 'Hide the math' : 'Show the math'}</button>
      {math && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {a.math.map((m, i) => (
              <tr key={i} className="border-t border-black/10 align-top">
                <td className="py-1.5 pr-2">{m.label}<div className="text-xs text-muted">{m.source}</div></td>
                <td className="py-1.5 text-right num font-semibold whitespace-nowrap">{m.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-[11px] text-muted">Based on what you recorded. Not financial advice.</p>
    </div>
  );
}
