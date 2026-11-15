'use client';
import { useEffect, useRef, useState } from 'react';
import type { ChatResult, Card as PendingCard } from '@/lib/ai/chat';
import type { TxnItem } from '@/lib/actions';
import { Shell, VerdictCard, useAppState, post, formatMoney, prettyDate, field, type AppState } from './ui';

type Msg =
  | { id: string; role: 'user' | 'assistant'; text: string }
  | { id: string; role: 'card'; card: PendingCard; status: 'open' | 'saved' | 'cancelled' }
  | { id: string; role: 'verdict'; result: NonNullable<ChatResult['affordability']> }
  | { id: string; role: 'ask'; question: string; options: string[]; used: boolean };

const STARTERS = ['Spent L$500 on keke and L$300 on data from MoMo', 'Can I afford a $120 phone?', 'How much did I spend this week?'];
let seq = 0;
const nid = () => `m${++seq}`;

export default function ChatScreen() {
  const { state, reload } = useAppState();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/chat').then((r) => (r.ok ? r.json() : [])).then((rows: { role: 'user' | 'assistant'; text: string }[]) =>
      setMsgs(rows.filter((r) => r.text).map((r) => ({ id: nid(), role: r.role, text: r.text }))));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);

  async function send(message: string) {
    const m = message.trim();
    if (!m || busy) return;
    setText(''); setBusy(true);
    setMsgs((x) => [...x, { id: nid(), role: 'user', text: m }]);
    const r = await post('/api/chat', { message: m });
    const res = r.data as ChatResult & { error?: string };
    const add: Msg[] = [];
    if (!r.ok) add.push({ id: nid(), role: 'assistant', text: res.error ?? 'Something went wrong. Please try again.' });
    else {
      if (res.demoMode) setDemo(true);
      if (res.reply) add.push({ id: nid(), role: 'assistant', text: res.reply });
      if (res.affordability) add.push({ id: nid(), role: 'verdict', result: res.affordability });
      for (const c of res.cards ?? []) add.push({ id: nid(), role: 'card', card: c, status: 'open' });
      if (res.ask) add.push({ id: nid(), role: 'ask', question: res.ask.question, options: res.ask.options, used: false });
    }
    setMsgs((x) => [...x, ...add]); setBusy(false);
  }

  const setMsg = (id: string, patch: Partial<Msg>) => setMsgs((x) => x.map((m) => (m.id === id ? ({ ...m, ...patch } as Msg) : m)));

  return (
    <Shell title="Goalpocket" right={state && <span className="text-xs text-muted num">{state.rate ? `L$${state.rate} = $1` : ''}</span>}>
      <div className="flex-1 px-4 py-4 grid gap-3 content-start" aria-live="polite">
        {demo && <p className="text-xs text-caution bg-gold-tint rounded-lg px-3 py-2">Demo mode: no AI is connected. Simple pattern matching reads your messages, so it understands less. All numbers still come from the same checked maths.</p>}
        {msgs.length === 0 && (
          <div className="rounded-2xl bg-white border border-line p-4">
            <p className="font-head font-bold">Hi{state?.profile.displayName ? ` ${state.profile.displayName}` : ''}! Tell me what you spent or earned.</p>
            <p className="text-sm text-muted mt-1">I&apos;ll show you a card first. Nothing is saved until you tap Save.</p>
            <div className="mt-3 grid gap-2">
              {STARTERS.map((s) => <button key={s} onClick={() => send(s)} className="text-left text-sm rounded-xl bg-green-tint px-3 py-2">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m) => {
          if (m.role === 'user' || m.role === 'assistant') return m.role === 'user' ? <p key={m.id} className="justify-self-end max-w-[85%] bg-green text-white rounded-2xl rounded-br-md px-3.5 py-2.5 whitespace-pre-wrap">{m.text}</p> : <p key={m.id} className="justify-self-start max-w-[90%] bg-white border border-line rounded-2xl rounded-bl-md px-3.5 py-2.5 whitespace-pre-wrap">{m.text}</p>;
          if (m.role === 'verdict') return state ? <VerdictCard key={m.id} a={m.result} home={state.home} /> : null;
          if (m.role === 'ask') return (
            <div key={m.id} className="grid gap-2">
              <p className="bg-white border border-line rounded-2xl px-3.5 py-2.5">{m.question}</p>
              <div className="flex flex-wrap gap-2">
                {m.options.map((o) => <button key={o} disabled={m.used || busy} onClick={() => { setMsg(m.id, { used: true }); send(o); }} className="h-10 px-4 rounded-full border border-green text-green font-semibold bg-white">{o}</button>)}
              </div>
            </div>
          );
          if (m.role !== 'card') return null;
          return state ? (
            <ConfirmCard key={m.id} card={m.card} status={m.status} state={state}
              onDone={(status, reply) => { setMsg(m.id, { status }); if (reply) setMsgs((x) => [...x, { id: nid(), role: 'assistant', text: reply }]); reload(); }} />
          ) : null;
        })}
        {busy && <p className="justify-self-start bg-white border border-line rounded-2xl px-3.5 py-2.5 text-muted">Thinking…</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="sticky bottom-16 bg-paper border-t border-line p-3 flex gap-2">
        <label className="sr-only" htmlFor="msg">Message</label>
        <input id="msg" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Spent L$500 on keke…" className={field} autoComplete="off" />
        <button disabled={busy || !text.trim()} className="h-11 px-4 rounded-xl bg-green text-white font-semibold">Send</button>
      </form>
    </Shell>
  );
}

type Row = { type: 'income' | 'expense'; amount: string; pocket_id: string; category: string; description: string; date: string };
const toRow = (i: TxnItem): Row => ({ type: i.type, amount: String(i.amountCents / 100), pocket_id: i.pocketId, category: i.category, description: i.description, date: i.date });

/** A proposal from the AI. Nothing is saved until the user taps Save. */
function ConfirmCard({ card, status, state, onDone }: { card: PendingCard; status: 'open' | 'saved' | 'cancelled'; state: AppState; onDone: (s: 'saved' | 'cancelled', reply?: string) => void }) {
  const p = card.pending;
  const [rows, setRows] = useState<Row[]>(p.kind === 'transactions' ? p.items.map(toRow) : []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true); setError('');
    const body: Record<string, unknown> = { id: card.pendingId };
    if (p.kind === 'transactions' && editing) {
      body.items = rows.map((r) => {
        const pocket = state.pockets.find((x) => x.id === r.pocket_id);
        return { ...r, amount: Number(r.amount.replace(/,/g, '')), currency: pocket?.currency ?? 'USD' };
      });
    }
    const r = await post('/api/actions/confirm', body);
    setBusy(false);
    if (r.ok) onDone('saved', r.data.message); else setError(r.data.error ?? 'Could not save.');
  }
  async function cancel() {
    setBusy(true);
    await post('/api/actions/cancel', { id: card.pendingId });
    setBusy(false); onDone('cancelled', 'OK, nothing was saved.');
  }

  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const warnings = p.kind === 'transactions' ? p.items.flatMap((i) => i.warnings) : p.kind === 'transfer' ? p.warnings : [];

  return (
    <div className={`rounded-2xl border-2 bg-white p-4 ${status === 'open' ? 'border-gold' : 'border-line opacity-80'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-caution">{status === 'open' ? 'Check and save' : status === 'saved' ? '✓ Saved' : 'Cancelled'}</p>
      <div className="mt-2 grid gap-2 text-sm">
        {p.kind === 'transactions' && !editing && p.items.map((i, k) => (
          <div key={k} className="flex justify-between gap-3 border-b border-line last:border-0 pb-2">
            <div><p className="font-medium">{i.description}</p><p className="text-xs text-muted">{state.categories.find((c) => c.key === i.category)?.label ?? i.category} · {i.pocketName} · {prettyDate(i.date)}</p></div>
            <p className={`num font-semibold whitespace-nowrap ${i.type === 'income' ? 'text-green' : ''}`}>{i.type === 'income' ? '+' : '−'}{formatMoney(i.amountCents, i.currency)}</p>
          </div>
        ))}
        {p.kind === 'transactions' && editing && rows.map((r, k) => (
          <div key={k} className="grid gap-2 border-b border-line last:border-0 pb-3">
            <input aria-label="Description" className={field} value={r.description} maxLength={120} onChange={(e) => upd(k, { description: e.target.value })} />
            <div className="flex gap-2">
              <select aria-label="Type" className={field} value={r.type} onChange={(e) => upd(k, { type: e.target.value as Row['type'] })}><option value="expense">Spent</option><option value="income">Earned</option></select>
              <input aria-label="Amount" inputMode="decimal" className={field} value={r.amount} onChange={(e) => upd(k, { amount: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <select aria-label="Pocket" className={field} value={r.pocket_id} onChange={(e) => upd(k, { pocket_id: e.target.value })}>
                {state.pockets.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}
              </select>
              <select aria-label="Category" className={field} value={r.category} onChange={(e) => upd(k, { category: e.target.value })}>
                {state.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <input aria-label="Date" type="date" className={field} value={r.date} max={state.today} onChange={(e) => upd(k, { date: e.target.value })} />
          </div>
        ))}
        {p.kind === 'transfer' && <p>Move <b className="num">{formatMoney(p.outCents, p.outCurrency)}</b> from {p.fromName} to {p.toName}{p.outCurrency !== p.inCurrency || p.inCents !== p.outCents ? <> (arrives as <b className="num">{formatMoney(p.inCents, p.inCurrency)}</b>)</> : null}{p.feeCents ? <>, fee <b className="num">{formatMoney(p.feeCents, p.outCurrency)}</b></> : null}.</p>}
        {p.kind === 'goal' && <p>New goal: <b>{p.name}</b>, <b className="num">{formatMoney(p.targetCents, p.currency)}</b> by {prettyDate(p.targetDate, true)}.</p>}
        {p.kind === 'goal_contribution' && <p>Put <b className="num">{formatMoney(p.fromCents, p.fromCurrency)}</b> from {p.pocketName} toward <b>{p.goalName}</b>{p.fromCurrency !== p.goalCurrency ? <> (counts as <b className="num">{formatMoney(p.toGoalCents, p.goalCurrency)}</b>)</> : null}.</p>}
        {p.kind === 'budget' && <p>Weekly budget: <b className="num">{formatMoney(p.limitCents, p.currency)}</b>{p.category ? ` for ${state.categories.find((c) => c.key === p.category)?.label ?? p.category}` : ''}.</p>}
        {p.kind === 'delete' && <p>Remove: {p.summary}</p>}
        {p.kind === 'edit' && <p>Change this entry: {Object.entries(p.changes).map(([k, v]) => `${k} → ${k === 'amountCents' ? Number(v) / 100 : String(v)}`).join(', ')}</p>}
      </div>
      {warnings.length > 0 && status === 'open' && <ul className="mt-2 text-xs text-caution list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {error && <p role="alert" className="mt-2 text-sm text-alert">{error}</p>}
      {status === 'open' && (
        <div className="mt-3 flex gap-2">
          <button onClick={save} disabled={busy} className="flex-1 h-11 rounded-xl bg-green text-white font-semibold">{p.kind === 'transactions' && p.items.length > 1 ? 'Save all' : 'Save'}</button>
          {p.kind === 'transactions' && <button onClick={() => setEditing(!editing)} disabled={busy} className="h-11 px-4 rounded-xl border border-line font-semibold">{editing ? 'Done' : 'Edit'}</button>}
          <button onClick={cancel} disabled={busy} className="h-11 px-4 rounded-xl border border-line font-semibold">Cancel</button>
        </div>
      )}
    </div>
  );
}
