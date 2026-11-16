'use client';
import { useState } from 'react';
import { Shell, Card, Sheet, useAppState, post, formatMoney, prettyDate, field, type AppState } from './ui';

const KIND_ICON: Record<string, string> = { cash: '💵', orange_money: '📱', momo: '📲', susu: '🤝', bank: '🏦', other: '👛' };

export default function MoneyScreen() {
  const { state, error, reload } = useAppState();
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [removingId, setRemovingId] = useState('');
  if (!state) return <Shell title="Money"><p className="p-4 text-muted">{error || 'Loading…'}</p></Shell>;
  const h = state.home;
  const t = state.totals;
  const locked = state.pockets.filter((p) => !p.spendable);
  const maxCat = Math.max(1, ...state.week.byCategory.map((c) => c.homeCents));
  const b = state.budget;

  async function remove(id: string, label: string) {
    if (!window.confirm(`Remove "${label}"? This hides the entry and updates your balances. You cannot undo this from the app.`)) return;
    setRemoveError(''); setRemovingId(id);
    const r = await post(`/api/entries?id=${id}`, undefined, 'DELETE');
    setRemovingId('');
    if (!r.ok) { setRemoveError(r.data.error ?? 'Could not remove this entry. Please try again.'); return; }
    await reload();
  }

  return (
    <Shell title="Money" right={<button onClick={() => setSettings(true)} className="text-sm text-muted underline">Settings</button>}>
      <div className="px-4 py-4 grid gap-3">
        <Card className="bg-green text-white border-green">
          <p className="text-sm opacity-90">Available to spend</p>
          <p className="font-head font-extrabold text-4xl num mt-1">{formatMoney(t.availableHomeCents, h)}</p>
          <p className="text-sm opacity-90 mt-1 num">Total with locked pockets: {formatMoney(t.totalHomeCents, h)}</p>
          <p className="text-xs opacity-75 mt-2 num">At your rate: L${state.rate} = $1{locked.length ? ` · 🔒 ${locked.map((p) => p.name).join(', ')} not counted as spendable` : ''}</p>
        </Card>

        <Card>
          <h2 className="font-head font-bold mb-2">Pockets</h2>
          <ul className="grid gap-1">
            {state.pockets.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-1.5">
                <span className="flex items-center gap-2"><span aria-hidden>{KIND_ICON[p.kind] ?? '👛'}</span>{p.name}{!p.spendable && <span className="text-xs text-muted">🔒 locked</span>}</span>
                <span className={`num font-semibold ${p.balanceCents < 0 ? 'text-alert' : ''}`}>{formatMoney(p.balanceCents, p.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-head font-bold">This week</h2>
            <span className="text-xs text-muted">{prettyDate(state.week.start)} to {prettyDate(state.week.end)}</span>
          </div>
          <p className="text-sm mt-1 num">Spent <b>{formatMoney(state.week.expenseHomeCents, h)}</b> · Earned <b>{formatMoney(state.week.incomeHomeCents, h)}</b></p>
          {b && (
            <div className="mt-3">
              <div className="flex justify-between text-xs"><span>Weekly budget</span><span className="num">{formatMoney(b.usedCents, b.budget.currency)} of {formatMoney(b.budget.limitCents, b.budget.currency)}</span></div>
              <div className="h-2.5 rounded-full bg-line mt-1 overflow-hidden" role="progressbar" aria-valuenow={Math.round(b.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Weekly budget used">
                <div className={`h-full ${b.level === 'over' ? 'bg-alert' : b.level === 'near' ? 'bg-gold' : 'bg-green'}`} style={{ width: `${Math.min(100, b.pct)}%` }} />
              </div>
              {b.level !== 'ok' && <p className={`text-xs mt-1 ${b.level === 'over' ? 'text-alert' : 'text-caution'}`}>{b.level === 'over' ? 'Over budget this week.' : 'Close to your budget.'}</p>}
            </div>
          )}
          <ul className="mt-3 grid gap-2">
            {state.week.byCategory.length === 0 && <li className="text-sm text-muted">No spending recorded this week yet.</li>}
            {state.week.byCategory.map((c) => (
              <li key={c.category} className="text-sm">
                <div className="flex justify-between"><span>{c.label}</span><span className="num">{formatMoney(c.homeCents, h)}</span></div>
                <div className="h-1.5 rounded-full bg-green-tint mt-1"><div className="h-full rounded-full bg-green" style={{ width: `${(c.homeCents / maxCat) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="bg-gold-tint border-gold">
          <p className="text-xs font-semibold uppercase tracking-wide text-caution">Insight of the week</p>
          <p className="mt-1">{state.insight.text}</p>
          {state.insight.math.length > 0 && (
            <details className="mt-2 text-sm"><summary className="font-semibold underline cursor-pointer">Show the math</summary>
              <ul className="mt-1">{state.insight.math.map((m, i) => <li key={i} className="flex justify-between gap-2 py-1 border-t border-black/10"><span>{m.label}<span className="block text-xs text-muted">{m.source}</span></span><span className="num font-semibold">{m.value}</span></li>)}</ul>
            </details>
          )}
        </Card>

        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-head font-bold">This month</h2>
            <span className="text-xs text-muted">{prettyDate(state.report.start)} to {prettyDate(state.report.end)}</span>
          </div>
          <dl className="grid grid-cols-2 gap-2 mt-2 text-sm">
            <div className="bg-paper rounded-lg p-2"><dt className="text-xs text-muted">Earned</dt><dd className="num font-semibold text-green">{formatMoney(state.report.incomeHomeCents, h)}</dd></div>
            <div className="bg-paper rounded-lg p-2"><dt className="text-xs text-muted">Spent</dt><dd className="num font-semibold">{formatMoney(state.report.expenseHomeCents, h)}</dd></div>
            <div className="bg-paper rounded-lg p-2"><dt className="text-xs text-muted">Earned minus spent</dt><dd className={`num font-semibold ${state.report.differenceHomeCents < 0 ? 'text-alert' : ''}`}>{formatMoney(state.report.differenceHomeCents, h)}</dd></div>
            <div className="bg-paper rounded-lg p-2"><dt className="text-xs text-muted">Put toward goal</dt><dd className="num font-semibold">{formatMoney(state.report.toGoalHomeCents, h)}</dd></div>
          </dl>
          {state.report.topLabel && state.report.topCategory && <p className="text-xs text-muted mt-2">Biggest spend: {state.report.topLabel}, {formatMoney(state.report.topCategory.homeCents, h)}.</p>}
          {state.report.entryCount === 0 && <p className="text-xs text-muted mt-2">Nothing recorded this month yet.</p>}
        </Card>

        <Card>
          <h2 className="font-head font-bold mb-2">Recent</h2>
          {removeError && <p role="alert" className="mb-2 text-sm text-alert">{removeError}</p>}
          <ul className="divide-y divide-line">
            {state.recent.length === 0 && <li className="text-sm text-muted py-2">Nothing yet. Tap + or tell the chat.</li>}
            {state.recent.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-3">
                <span aria-hidden className="text-lg">{r.icon}</span>
                <div className="flex-1 min-w-0"><p className="truncate">{r.description || r.categoryLabel}</p><p className="text-xs text-muted">{r.categoryLabel} · {r.pocketName} · {prettyDate(r.occurredOn)}</p></div>
                <span className={`num font-semibold ${r.type === 'income' ? 'text-green' : ''}`}>{r.type === 'income' ? '+' : '−'}{formatMoney(r.amountCents, r.currency)}</span>
                <button onClick={() => remove(r.id, r.description || r.categoryLabel)} disabled={removingId === r.id} aria-label={`Remove ${r.description}`} className="w-10 h-10 rounded-full text-muted hover:bg-line disabled:opacity-50">{removingId === r.id ? '…' : '✕'}</button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <button onClick={() => setAdding(true)} aria-label="Add an entry" className="fixed bottom-20 right-[max(1rem,calc(50%-14rem+1rem))] w-14 h-14 rounded-full bg-gold text-green-dk text-3xl font-bold shadow-lg">+</button>
      <EntrySheet open={adding} onClose={() => setAdding(false)} state={state} onSaved={() => { setAdding(false); reload(); }} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} state={state} onSaved={reload} />
    </Shell>
  );
}

type Draft = { amount: string; pocket_id: string; category: string; description: string; date: string };

function EntrySheet({ open, onClose, state, onSaved }: { open: boolean; onClose: () => void; state: AppState; onSaved: () => void }) {
  const fresh = (): Draft => ({ amount: '', pocket_id: state.pockets[0]?.id ?? '', category: 'transport', description: '', date: state.today });
  // Spent and Earned each keep their own draft, so nothing typed in one shows up in the other.
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [drafts, setDrafts] = useState<Record<'income' | 'expense', Draft>>(() => ({ expense: fresh(), income: fresh() }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const f = drafts[type];
  const set = (patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [type]: { ...d[type], ...patch } }));
  const reset = () => { setDrafts({ expense: fresh(), income: fresh() }); setType('expense'); setError(''); };
  const close = () => { reset(); onClose(); };
  const pocket = state.pockets.find((p) => p.id === f.pocket_id);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const amount = Number(f.amount.replace(/,/g, ''));
    if (!(amount > 0)) return setError('Enter an amount.');
    setBusy(true);
    const r = await post('/api/entries', { ...f, type, category: type === 'income' ? 'income' : f.category, amount });
    setBusy(false);
    if (r.ok) { reset(); onSaved(); } else setError(r.data.error ?? 'Could not save.');
  }
  return (
    <Sheet open={open} onClose={close} title="Add an entry">
      <form onSubmit={save} className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          {(['expense', 'income'] as const).map((t) => (
            <button type="button" key={t} onClick={() => { setType(t); setError(''); }} className={`h-11 rounded-xl border font-semibold ${type === t ? 'bg-green text-white border-green' : 'bg-white border-line'}`}>{t === 'expense' ? 'Spent' : 'Earned'}</button>
          ))}
        </div>
        <label className="grid gap-1 text-sm">Pocket
          <select className={field} value={f.pocket_id} onChange={(e) => set({ pocket_id: e.target.value })}>
            {state.pockets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Amount {pocket ? `(${pocket.currency === 'USD' ? '$' : 'L$'})` : ''}
          <input className={field} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" />
        </label>
        {type === 'expense' && (
          <label className="grid gap-1 text-sm">Category
            <select className={field} value={f.category} onChange={(e) => set({ category: e.target.value })}>
              {state.categories.filter((c) => c.key !== 'income').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm">What for?
          <input className={field} maxLength={120} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={type === 'expense' ? 'Keke to Red Light' : 'Sales'} />
        </label>
        <label className="grid gap-1 text-sm">Date
          <input type="date" className={field} max={state.today} value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
        <button disabled={busy} className="h-12 rounded-xl bg-green text-white font-semibold">{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  );
}

function SettingsSheet({ open, onClose, state, onSaved }: { open: boolean; onClose: () => void; state: AppState; onSaved: () => void }) {
  const [rate, setRate] = useState(String(state.rate));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function saveRate() {
    const n = Number(rate);
    if (!(n > 0)) return setMsg('Enter a number above zero.');
    setBusy(true);
    const r = await post('/api/settings', { action: 'rate', lrdPerUsd: n });
    setBusy(false);
    setMsg(r.ok ? 'Rate saved.' : (r.data.error ?? 'Could not save the rate. Please try again.'));
    if (r.ok) onSaved();
  }
  async function toggle(pocketId: string, spendable: boolean) {
    setBusy(true);
    const r = await post('/api/settings', { action: 'spendable', pocketId, spendable });
    setBusy(false);
    if (!r.ok) setMsg(r.data.error ?? 'Could not update that pocket. Please try again.');
    else { setMsg('Pocket setting saved.'); onSaved(); }
  }
  async function signout() {
    setBusy(true);
    const r = await post('/api/settings', { action: 'signout' });
    setBusy(false);
    if (r.ok) window.location.href = '/';
    else setMsg(r.data.error ?? 'Could not sign out. Please try again.');
  }
  async function wipe() {
    if (!window.confirm('Permanently delete your Goalpocket account and all its saved records? This cannot be undone. If you want to keep a copy, do not continue.')) return;
    setBusy(true);
    const r = await post('/api/settings', { action: 'delete_my_data' });
    setBusy(false);
    if (r.ok) window.location.href = '/';
    else setMsg(r.data.error ?? 'Could not delete your data. Nothing was confirmed as deleted; please try again.');
  }
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="grid gap-5">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="rate">Your exchange rate (L$ for $1)</label>
          <div className="flex gap-2"><input id="rate" className={field} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /><button onClick={saveRate} disabled={busy} className="h-11 px-4 rounded-xl bg-green text-white font-semibold">Save</button></div>
          {msg && <p className="text-xs text-muted" role="status">{msg}</p>}
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-medium">Spendable now</p>
          {state.pockets.map((p) => (
            <label key={p.id} className="flex items-center justify-between py-1.5 text-sm">{p.name}<input type="checkbox" className="w-5 h-5 accent-green" checked={p.spendable} disabled={busy} onChange={(e) => toggle(p.id, e.target.checked)} /></label>
          ))}
        </div>
        {busy && <p className="text-xs text-muted" role="status">Saving…</p>}
        <div className="grid gap-2">
          <button onClick={signout} disabled={busy} className="h-11 rounded-xl border border-line bg-white font-semibold">Sign out</button>
          <button onClick={wipe} disabled={busy} className="h-11 rounded-xl border border-alert text-alert bg-white font-semibold">Delete my data</button>
        </div>
      </div>
    </Sheet>
  );
}
