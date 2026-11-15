'use client';
import { useState } from 'react';
import type { Affordability } from '@/lib/engine';
import { Shell, Card, VerdictCard, useAppState, post, formatMoney, prettyDate, field } from './ui';

export default function GoalScreen() {
  const { state, error } = useAppState();
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('');
  const [cur, setCur] = useState<'USD' | 'LRD'>('USD');
  const [answer, setAnswer] = useState<Affordability | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!state) return <Shell title="Goal"><p className="p-4 text-muted">{error || 'Loading…'}</p></Shell>;
  const g = state.goal;

  async function check(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    const n = Number(price.replace(/,/g, ''));
    if (!item.trim() || !(n > 0)) return setMsg('Enter what it is and the price.');
    setBusy(true);
    const r = await post('/api/afford', { item: item.trim(), price: n, currency: cur });
    setBusy(false);
    if (r.ok) setAnswer(r.data as Affordability); else setMsg(r.data.error ?? 'Could not check.');
  }

  return (
    <Shell title="Goal">
      <div className="px-4 py-4 grid gap-3">
        {g ? (
          <Card className="bg-gold-tint border-gold">
            <p className="text-xs font-semibold uppercase tracking-wide text-caution">Saving for</p>
            <h2 className="font-head font-extrabold text-2xl">{g.goal.name}</h2>
            <p className="num mt-1"><b>{formatMoney(g.savedCents, g.goal.currency)}</b> of {formatMoney(g.goal.targetCents, g.goal.currency)}</p>
            <div className="h-3 rounded-full bg-white mt-2 overflow-hidden" role="progressbar" aria-label="Goal progress"
              aria-valuenow={Math.round((g.savedCents / g.goal.targetCents) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-gold" style={{ width: `${Math.min(100, (g.savedCents / g.goal.targetCents) * 100)}%` }} />
            </div>
            <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
              <div className="bg-white rounded-lg p-2"><dt className="text-xs text-muted">Target date</dt><dd className="font-semibold">{prettyDate(g.goal.targetDate, true)}</dd></div>
              <div className="bg-white rounded-lg p-2"><dt className="text-xs text-muted">Still to save</dt><dd className="num font-semibold">{formatMoney(g.remainingCents, g.goal.currency)}</dd></div>
              <div className="bg-white rounded-lg p-2"><dt className="text-xs text-muted">Needed each week</dt><dd className="num font-semibold">{formatMoney(g.paceNeededCents, g.goal.currency)}</dd></div>
              <div className="bg-white rounded-lg p-2"><dt className="text-xs text-muted">Your pace (last 4 weeks)</dt><dd className="num font-semibold">{formatMoney(g.yourPaceCents, g.goal.currency)} a week</dd></div>
            </dl>
            <p className="mt-3 text-sm">
              {g.remainingCents === 0 ? '🎉 You reached your goal!'
                : g.projectedFinish ? <>At your pace you finish around <b>{prettyDate(g.projectedFinish, true)}</b>. {g.onTrack ? 'You are on track.' : 'That is after your target date.'}</>
                : 'Add money to your goal to see when you will finish.'}
            </p>
            <p className="text-xs text-muted mt-2">Add money to your goal by telling the chat, for example &quot;Put $20 from Orange Money toward my laptop&quot;.</p>
          </Card>
        ) : (
          <Card><h2 className="font-head font-bold">No goal yet</h2><p className="text-sm text-muted mt-1">Tell the chat, for example &quot;I want to save $500 for a laptop by March&quot;.</p></Card>
        )}

        <Card>
          <h2 className="font-head font-bold">Can I afford it?</h2>
          <form onSubmit={check} className="grid gap-2 mt-2">
            <input aria-label="What is it?" className={field} placeholder="Phone" maxLength={60} value={item} onChange={(e) => setItem(e.target.value)} />
            <div className="flex gap-2">
              <input aria-label="Price" inputMode="decimal" className={field} placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} />
              <select aria-label="Currency" className="h-11 rounded-xl border border-line bg-white px-2" value={cur} onChange={(e) => setCur(e.target.value as 'USD' | 'LRD')}><option>USD</option><option>LRD</option></select>
            </div>
            {msg && <p role="alert" className="text-sm text-alert">{msg}</p>}
            <button disabled={busy} className="h-11 rounded-xl bg-green text-white font-semibold">{busy ? 'Checking…' : 'Check'}</button>
          </form>
          {answer && <div className="mt-3"><VerdictCard a={answer} home={state.home} /></div>}
        </Card>
      </div>
    </Shell>
  );
}
