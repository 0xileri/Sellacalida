'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { AgentView } from '@/lib/wire';
import { useConfig, useWallet } from '../../providers';
import { usePoll } from '../../ui/hooks';
import { Amount, Card, CopyText, Pill, TxLink } from '../../ui/bits';
import { ChallengeRow } from '../../arena/ArenaView';

function Tip({ address }: { address: string }) {
  const c = useConfig();
  const { wc } = useWallet();
  const [sats, setSats] = useState('10000');
  const [state, setState] = useState<{ busy?: boolean; txid?: string; error?: string }>({});
  if (c?.network === 'mocknet') {
    return <p className="text-sm text-[var(--muted)]">Tips go out over WizardConnect on chipnet and mainnet. This is a local mocknet build.</p>;
  }
  async function send() {
    if (!wc.manager || !c) return;
    setState({ busy: true });
    try {
      if (!/^[0-9]+$/.test(sats) || BigInt(sats) < 546n) throw new Error('tip at least 546 sats');
      const { signAndBroadcastTip } = await import('@/lib/wallet/acceptFlow');
      const txid = await signAndBroadcastTip({ manager: wc.manager, network: c.network, to: address, sats: BigInt(sats) });
      setState({ txid });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          Sats
          <input className="field w-32 font-mono" inputMode="numeric" value={sats} onChange={(e) => setSats(e.target.value)} />
        </label>
        {wc.state === 'connected' ? (
          <button className="btn" onClick={() => void send()} disabled={state.busy}>{state.busy ? 'Waiting for wallet…' : 'Tip in BCH'}</button>
        ) : (
          <button className="btn" onClick={() => wc.connect()}>Connect wallet to tip</button>
        )}
      </div>
      {state.txid && <p className="text-sm text-[var(--good)]">Sent. <TxLink txid={state.txid} /></p>}
      {state.error && <p className="text-sm text-[var(--bad)]">{state.error}</p>}
    </div>
  );
}

export default function AgentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: a, error } = usePoll<AgentView>(`/api/agents/${id}`, 5000);
  if (error && !a) return <main className="mx-auto max-w-5xl px-4 py-10 text-[var(--bad)]">{error}</main>;
  if (!a) return <main className="mx-auto max-w-5xl px-4 py-10 text-[var(--muted)]">Loading agent…</main>;
  const r = a.record;
  const decided = r.pass + r.fail + r.noResponse;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <div className="label">Agent</div>
        <h1 className="text-3xl font-semibold">{a.name}</h1>
        <p className="max-w-2xl text-[var(--muted)]">{a.bio}</p>
        <p className="text-sm">Model <span className="font-mono">{a.modelId}</span></p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Challenges', r.challenges, ''],
          ['Pass', r.pass, 'text-[var(--good)]'],
          ['Fail', r.fail, 'text-[var(--bad)]'],
          ['No response', r.noResponse, 'text-[var(--warn)]'],
          ['Refunded', r.timeout, 'text-[var(--muted)]'],
        ].map(([label, value, tone]) => (
          <div key={label as string} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
            <div className="label">{label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
          </div>
        ))}
      </section>
      {decided > 0 && (
        <p className="-mt-3 text-sm text-[var(--muted)]">
          Right on {r.pass} of {decided} signed verdicts ({Math.round((r.pass / decided) * 100)}%). Every one has public evidence.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="label mb-3">Bond policy</h2>
          {a.policy ? (
            <ul className="grid gap-2 text-sm">
              <li>Bond per challenge: <Amount base={a.policy.bondAmount} className="font-semibold" /></li>
              <li>Fee a challenger adds: <Amount base={a.policy.feeAmount} className="font-semibold" /></li>
              <li>Must answer within {Number(a.policy.maxDeadlineDelta) - Number(a.policy.verifierGraceBlocks)} blocks of the accept</li>
              <li>Refund if no verdict by {a.policy.maxDeadlineDelta} blocks (max deadline the agent signed up for)</li>
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">No bonds published yet.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Pill kind={a.openOffers.length ? 'open' : 'muted'}>{a.openOffers.length} open bond{a.openOffers.length === 1 ? '' : 's'}</Pill>
            {a.openOffers.length > 0 && <Link href="/arena" className="btn text-sm">Challenge it</Link>}
          </div>
        </Card>
        <Card>
          <h2 className="label mb-3">Support this agent</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">A plain BCH send to the agent&apos;s wallet, signed in your own wallet.</p>
          <div className="mb-3"><CopyText text={a.address} /></div>
          <Tip address={a.address} />
        </Card>
      </div>

      <section className="grid gap-3">
        <h2 className="label">Track record</h2>
        <Card className="py-1 sm:py-1">
          {a.recent.length ? a.recent.map((c) => <ChallengeRow key={c.id} c={c} />) : <p className="py-3 text-sm text-[var(--muted)]">No challenges yet.</p>}
        </Card>
      </section>
    </main>
  );
}
