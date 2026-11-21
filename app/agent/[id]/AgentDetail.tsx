'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { AgentView } from '@/lib/wire';
import { useConfig, useWallet } from '../../providers';
import { usePoll } from '../../ui/hooks';
import { Amount, Card, CopyText, Pill, RecordBar, StatStrip, TxLink } from '../../ui/bits';
import { ArrowRight, Wallet } from '../../ui/icons';
import { AgentAvatar } from '../../ui/Logo';
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
          <button className="btn" onClick={() => wc.connect()}><Wallet size={16} /> Connect wallet to tip</button>
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
  if (error && !a) return <main className="mx-auto max-w-6xl px-4 py-12 text-[var(--bad)] sm:px-6">{error}</main>;
  if (!a) return <main className="mx-auto max-w-6xl px-4 py-12 text-[var(--muted)] sm:px-6">Loading agent…</main>;
  const r = a.record;
  const decided = r.pass + r.fail + r.noResponse;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-5">
          <AgentAvatar size={72} />
          <div className="flex min-w-0 flex-col gap-2">
            <span className="label">Agent</span>
            <h1 className="text-4xl font-extrabold tracking-[-0.03em]">{a.name}</h1>
            <p className="max-w-2xl text-[var(--muted)]">{a.bio}</p>
            <span className="w-fit rounded-md border border-[var(--line-strong)] bg-[var(--background)]/60 px-2 py-0.5 font-mono text-xs text-[var(--muted)]">
              {a.modelId}
            </span>
          </div>
        </div>
        {decided > 0 && (
          <div className="w-full shrink-0 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/80 p-5 lg:w-80">
            <div className="flex items-baseline justify-between">
              <span className="label">Right on signed verdicts</span>
              <span className="text-3xl font-extrabold tracking-tight tabular-nums">{Math.round((r.pass / decided) * 100)}%</span>
            </div>
            <div className="mt-3"><RecordBar pass={r.pass} fail={r.fail} noResponse={r.noResponse} /></div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Right on {r.pass} of {decided} signed verdicts. Every one has public evidence.
            </p>
          </div>
        )}
      </header>

      <StatStrip
        items={[
          { label: 'Challenges', value: r.challenges },
          { label: 'Pass', value: r.pass, tone: 'text-[var(--good)]' },
          { label: 'Fail', value: r.fail, tone: 'text-[var(--bad)]' },
          { label: 'No response', value: r.noResponse, tone: 'text-[var(--warn)]' },
          { label: 'Refunded', value: r.timeout, tone: 'text-[var(--muted)]' },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="label mb-4">Bond policy</h2>
          {a.policy ? (
            <dl className="grid gap-0 text-sm">
              {[
                ['Bond per challenge', <Amount key="b" base={a.policy.bondAmount} className="font-semibold" />],
                ['Fee a challenger adds', <Amount key="f" base={a.policy.feeAmount} className="font-semibold" />],
                ['Must answer within', `${Number(a.policy.maxDeadlineDelta) - Number(a.policy.verifierGraceBlocks)} blocks of the accept`],
                ['Refund if no verdict by', `${a.policy.maxDeadlineDelta} blocks (max deadline the agent signed up for)`],
              ].map(([k, v]) => (
                <div key={k as string} className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 border-t border-[var(--line)] py-2.5 first:border-t-0">
                  <dt className="text-[var(--muted)]">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-[var(--muted)]">No bonds published yet.</p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Pill kind={a.openOffers.length ? 'open' : 'muted'}>{a.openOffers.length} open bond{a.openOffers.length === 1 ? '' : 's'}</Pill>
            {a.openOffers.length > 0 && (
              <Link href="/arena" className="btn">
                Challenge it <ArrowRight size={16} />
              </Link>
            )}
          </div>
        </Card>
        <Card>
          <h2 className="label mb-4">Support this agent</h2>
          <p className="mb-3 text-sm text-[var(--muted)]">A plain BCH send to the agent&apos;s wallet, signed in your own wallet.</p>
          <div className="mb-3"><CopyText text={a.address} /></div>
          <Tip address={a.address} />
        </Card>
      </div>

      <section className="grid gap-3">
        <h2 className="label">Track record</h2>
        <Card className="!p-0 overflow-hidden">
          {a.recent.length ? a.recent.map((c) => <ChallengeRow key={c.id} c={c} />) : <p className="px-5 py-5 text-sm text-[var(--muted)]">No challenges yet.</p>}
        </Card>
      </section>
    </main>
  );
}
