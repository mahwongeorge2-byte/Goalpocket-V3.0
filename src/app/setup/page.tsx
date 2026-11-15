'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type P = { on: boolean; name: string; kind: string; currency: 'USD' | 'LRD'; balance: string; spendable: boolean };

const DEFAULTS: P[] = [
  { on: true, name: 'USD cash', kind: 'cash', currency: 'USD', balance: '', spendable: true },
  { on: true, name: 'LRD cash', kind: 'cash', currency: 'LRD', balance: '', spendable: true },
  { on: true, name: 'Orange Money', kind: 'orange_money', currency: 'USD', balance: '', spendable: true },
  { on: true, name: 'MoMo', kind: 'momo', currency: 'LRD', balance: '', spendable: true },
  { on: false, name: 'Susu', kind: 'susu', currency: 'LRD', balance: '', spendable: false },
  { on: false, name: 'Bank account', kind: 'bank', currency: 'USD', balance: '', spendable: true },
];

const input = 'h-11 rounded-xl border border-line bg-white px-3 w-full';

export default function Setup() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pockets, setPockets] = useState<P[]>(DEFAULTS);
  const [rate, setRate] = useState('');
  const [home, setHome] = useState<'USD' | 'LRD'>('USD');
  const [goal, setGoal] = useState({ name: '', target: '', currency: 'USD', date: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const upd = (i: number, patch: Partial<P>) => setPockets((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const chosen = pockets.filter((p) => p.on);
    if (!chosen.length) return setError('Pick at least one pocket.');
    if (!(Number(rate) > 0)) return setError('Enter your exchange rate (Liberian dollars for one US dollar).');
    const wantsGoal = goal.name || goal.target || goal.date;
    if (wantsGoal && (!goal.name || !(Number(goal.target) > 0) || !goal.date)) return setError('Fill in all goal fields, or leave them all empty.');
    setBusy(true);
    const r = await fetch('/api/setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: name || 'Friend', homeCurrency: home, lrdPerUsd: Number(rate),
        pockets: chosen.map((p) => ({ name: p.name, kind: p.kind, currency: p.currency, balance: Number(p.balance.replace(/,/g, '')) || 0, spendable: p.spendable })),
        goal: wantsGoal ? { name: goal.name, target: Number(goal.target), currency: goal.currency, targetDate: goal.date } : null,
      }),
    });
    if (r.ok) router.push('/chat');
    else { setError((await r.json().catch(() => ({}))).error ?? 'Something went wrong.'); setBusy(false); }
  }

  return (
    <main className="max-w-md mx-auto px-4 py-6">
      <h1 className="font-head font-bold text-2xl">Set up Goalpocket</h1>
      <p className="text-muted text-sm mt-1">Takes about two minutes. Rough guesses are fine. You can fix them later.</p>
      <form onSubmit={submit} className="grid gap-6 mt-5">
        <label className="grid gap-1.5 text-sm font-medium">Your first name
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="Musu" />
        </label>

        <fieldset className="grid gap-2">
          <legend className="font-head font-bold mb-1">Your pockets</legend>
          <p className="text-sm text-muted -mt-1 mb-1">Tick where you keep money and roughly how much is there now.</p>
          {pockets.map((p, i) => (
            <div key={i} className={`rounded-xl border border-line bg-white p-3 grid gap-2 ${p.on ? '' : 'opacity-70'}`}>
              <div className="flex items-center gap-3">
                <input type="checkbox" aria-label={`Use ${p.name}`} checked={p.on} onChange={(e) => upd(i, { on: e.target.checked })} className="w-5 h-5 accent-green" />
                <input aria-label="Pocket name" className="flex-1 min-w-0 bg-transparent font-medium" value={p.name} onChange={(e) => upd(i, { name: e.target.value })} />
                <select aria-label="Currency" value={p.currency} onChange={(e) => upd(i, { currency: e.target.value as 'USD' | 'LRD' })} className="h-9 rounded-lg border border-line px-2 text-sm">
                  <option>USD</option><option>LRD</option>
                </select>
              </div>
              {p.on && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted w-8">{p.currency === 'USD' ? '$' : 'L$'}</span>
                  <input inputMode="decimal" aria-label={`${p.name} balance`} className={input} placeholder="0" value={p.balance} onChange={(e) => upd(i, { balance: e.target.value })} />
                  <label className="text-xs text-muted flex items-center gap-1 whitespace-nowrap">
                    <input type="checkbox" checked={p.spendable} onChange={(e) => upd(i, { spendable: e.target.checked })} className="accent-green" /> Spendable now
                  </label>
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-muted">🔒 A pocket that is not &quot;spendable now&quot; (like susu) counts in your total but not in &quot;Can I afford it?&quot;</p>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="font-head font-bold mb-1">Your exchange rate</legend>
          <label className="grid gap-1.5 text-sm">How many Liberian dollars for one US dollar?
            <input inputMode="decimal" className={input} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="for example 172" />
          </label>
          <p className="text-xs text-muted">Use the rate you actually get. Check the Central Bank of Liberia daily rate if unsure.</p>
          <div className="flex gap-2 text-sm items-center">Show my total in
            {(['USD', 'LRD'] as const).map((c) => (
              <button type="button" key={c} onClick={() => setHome(c)} className={`h-9 px-4 rounded-full border ${home === c ? 'bg-green text-white border-green' : 'border-line bg-white'}`}>{c}</button>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="font-head font-bold mb-1">What are you saving for? <span className="font-normal text-muted text-sm">(optional)</span></legend>
          <input className={input} placeholder="Laptop" value={goal.name} onChange={(e) => setGoal({ ...goal, name: e.target.value })} maxLength={40} />
          <div className="flex gap-2">
            <input inputMode="decimal" className={input} placeholder="Amount" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} />
            <select value={goal.currency} onChange={(e) => setGoal({ ...goal, currency: e.target.value })} className="h-11 rounded-xl border border-line px-2"><option>USD</option><option>LRD</option></select>
          </div>
          <label className="grid gap-1.5 text-sm">By when?<input type="date" className={input} value={goal.date} onChange={(e) => setGoal({ ...goal, date: e.target.value })} /></label>
        </fieldset>

        {error && <p role="alert" className="text-sm text-alert bg-alert-tint rounded-lg p-2.5">{error}</p>}
        <button disabled={busy} className="h-12 rounded-xl bg-green text-white font-semibold">{busy ? 'Setting up…' : 'Start'}</button>
        <p className="text-xs text-muted text-center">Goalpocket never asks for PINs or passwords and never moves money.</p>
      </form>
    </main>
  );
}
