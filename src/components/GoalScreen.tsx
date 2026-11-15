'use client';
import { useState } from 'react';
import type { Affordability } from '@/lib/engine';
import { Shell, Card, VerdictCard, useAppState, post, formatMoney, prettyDate, field } from './ui';

export default function GoalScreen() {
  const { state, error, reload } = useAppState();
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('');
  const [cur, setCur] = useState<'USD' | 'LRD'>('USD');
  const [answer, setAnswer] = useState<Affordability | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [gf, setGf] = useState({ name: '', target: '', cur: 'USD' as 'USD' | 'LRD', date: '' });
  const [cf, setCf] = useState({ pocket: '', amount: '' });
  const [gMsg, setGMsg] = useState('');
  const [cMsg, setCMsg] = useState('');
  const [gBusy, setGBusy] = useState(false);
  if (!state) return <Shell title="Goal"><p className="p-4 text-muted">{error || 'Loading…'}</p></Shell>;
  const g = state.goal;

  async function saveGoal(e: React.FormEvent) {
    e.preventDefault(); setGMsg('');
    const n = Number(gf.target.replace(/,/g, ''));
    if (!gf.name.trim() || !(n > 0) || !gf.date) return setGMsg('Enter a name, an amount and a date.');
    setGBusy(true);
    const r = await post('/api/goals', { action: 'goal', name: gf.name.trim(), target_amount: n, currency: gf.cur, target_date: gf.date });
    setGBusy(false);
    if (r.ok) { setGf({ name: '', target: '', cur: gf.cur, date: '' }); reload(); } else setGMsg(r.data.error ?? 'Could not save the goal.');
  }
  async function moveMoney(action: 'contribute' | 'withdraw') {
    setCMsg('');
    const n = Number(cf.amount.replace(/,/g, ''));
    const pocketId = cf.pocket || state?.pockets[0]?.id || '';
    if (!(n > 0)) return setCMsg('Enter an amount.');
    setGBusy(true);
    const r = await post('/api/goals', { action, pocket_id: pocketId, amount: n, date: state?.today });
    setGBusy(false);
    if (r.ok) { setCf({ pocket: cf.pocket, amount: '' }); reload(); } else setCMsg(r.data.error ?? 'Could not update the goal.');
  }

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
          <Card><h2 className="font-head font-bold">No goal yet</h2><p className="text-sm text-muted mt-1">Set one below, or tell the chat, for example &quot;I want to save $500 for a laptop by March&quot;.</p></Card>
        )}

        <Card>
          <h2 className="font-head font-bold">{g ? 'Start a new goal' : 'Set a goal'}</h2>
          {g && <p className="text-xs text-muted mt-1">This replaces your current goal.</p>}
          <form onSubmit={saveGoal} className="grid gap-2 mt-2">
            <input aria-label="Goal name" className={field} placeholder="Laptop" maxLength={40} value={gf.name} onChange={(e) => setGf({ ...gf, name: e.target.value })} />
            <div className="flex gap-2">
              <input aria-label="Target amount" inputMode="decimal" className={field} placeholder="Amount" value={gf.target} onChange={(e) => setGf({ ...gf, target: e.target.value })} />
              <select aria-label="Goal currency" className="h-11 rounded-xl border border-line bg-white px-2" value={gf.cur} onChange={(e) => setGf({ ...gf, cur: e.target.value as 'USD' | 'LRD' })}><option>USD</option><option>LRD</option></select>
            </div>
            <label className="grid gap-1 text-sm">By when?<input type="date" className={field} value={gf.date} onChange={(e) => setGf({ ...gf, date: e.target.value })} /></label>
            {gMsg && <p role="alert" className="text-sm text-alert">{gMsg}</p>}
            <button disabled={gBusy} className="h-11 rounded-xl bg-green text-white font-semibold">{gBusy ? 'Saving…' : 'Save goal'}</button>
          </form>
        </Card>

        {g && (
          <Card>
            <h2 className="font-head font-bold">Add or take out money</h2>
            <form onSubmit={(e) => { e.preventDefault(); moveMoney('contribute'); }} className="grid gap-2 mt-2">
              <select aria-label="Pocket" className={field} value={cf.pocket || state.pockets[0]?.id || ''} onChange={(e) => setCf({ ...cf, pocket: e.target.value })}>
                {state.pockets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}
              </select>
              <input aria-label="Amount" inputMode="decimal" className={field} placeholder="Amount" value={cf.amount} onChange={(e) => setCf({ ...cf, amount: e.target.value })} />
              {cMsg && <p role="alert" className="text-sm text-alert">{cMsg}</p>}
              <div className="flex gap-2">
                <button disabled={gBusy} className="flex-1 h-11 rounded-xl bg-green text-white font-semibold">{gBusy ? 'Saving…' : 'Add to goal'}</button>
                <button type="button" disabled={gBusy} onClick={() => moveMoney('withdraw')} className="flex-1 h-11 rounded-xl border border-line bg-white font-semibold">Take out</button>
              </div>
              <p className="text-xs text-muted">Adding moves money out of the pocket into your goal. Taking out puts it back in the pocket.</p>
            </form>
          </Card>
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
