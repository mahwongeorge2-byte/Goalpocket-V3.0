'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Welcome() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function demo() {
    setBusy(true); setError('');
    const r = await fetch('/api/demo', { method: 'POST' }).catch(() => null);
    if (!r) { setError('No connection. Check your internet and try again.'); setBusy(false); return; }
    if (r.ok) router.push('/chat');
    else { setError((await r.json().catch(() => ({}))).error ?? 'Could not start the demo. Please try again.'); setBusy(false); }
  }

  return (
    <main className="min-h-dvh flex flex-col justify-between bg-gradient-to-b from-green to-green-dk text-white px-5 py-7 max-w-md mx-auto">
      <div className="flex items-center gap-2.5 font-head font-extrabold text-2xl">
        <span aria-hidden className="w-10 h-10 rounded-xl bg-gold text-green-dk grid place-items-center">G</span>Goalpocket
      </div>
      <div>
        <h1 className="font-head font-extrabold text-[34px] leading-tight">Know what&apos;s in every pocket.</h1>
        <p className="mt-3 opacity-90">Cash, Orange Money, MoMo and susu. US and Liberian dollars. One honest picture, just by chatting.</p>
      </div>
      <div className="grid gap-2.5">
        <button onClick={() => router.push('/setup')} className="h-12 rounded-xl bg-gold text-green-dk font-semibold">Get started</button>
        <button onClick={demo} disabled={busy} className="h-12 rounded-xl border border-white/60 font-semibold">{busy ? 'Opening the demo…' : 'Try the demo'}</button>
        {error && <p role="alert" className="text-sm bg-white/15 rounded-lg p-2">{error}</p>}
        <p className="text-[13px] opacity-90 text-center">🔒 No PINs. No bank logins. Goalpocket never moves money.</p>
        <p className="text-[11px] opacity-75 text-center">The demo uses a fictional user with sample data.</p>
      </div>
    </main>
  );
}
