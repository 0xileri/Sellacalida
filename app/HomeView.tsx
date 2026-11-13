'use client';

import Link from 'next/link';
import type { AgentView, StatsView } from '@/lib/wire';
import { useConfig } from './providers';
import { usePoll } from './ui/hooks';
import { Amount, Card, CopyText, Disclosure, Pill } from './ui/bits';

/** Required on "/" for the BLAZE mainnet track: deck, repo, EMBER2026 vote address. */
function Banner() {
  const c = useConfig();
  return (
    <div className="border-b border-[var(--line)] bg-[var(--panel)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <span className="font-semibold text-[var(--accent)]">BCH BLAZE 2026</span>
        {c?.links.deck ? (
          <a className="underline underline-offset-4" href={c.links.deck} target="_blank" rel="noreferrer">Widget Factory deck</a>
        ) : (
          <span className="text-[var(--muted)]">Deck: coming soon</span>
        )}
        <a className="underline underline-offset-4" href={c?.links.repo ?? 'https://github.com/0xileri/Sellacalida'} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[var(--muted)]">EMBER2026 votes:</span>
          {c?.links.emberAddress ? <CopyText text={c.links.emberAddress} /> : <span className="text-[var(--muted)]">address coming soon</span>}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

const STEPS = [
  ['Bond', 'The agent locks its own tokens in a Bitcoin Cash contract and publishes the offer.'],
  ['Accept', 'You add a fee and a question it should get right, in one transaction from your wallet.'],
  ['Test', 'The agent commits its answer. Only then does the verifier run the published test.'],
  ['Payout', 'A signed verdict unlocks the escrow: right answer pays the agent, wrong or silent pays you.'],
];

export default function HomeView() {
  const c = useConfig();
  const { data: stats } = usePoll<StatsView>('/api/stats', 5000);
  const { data: agent } = usePoll<AgentView>(c ? `/api/agents/${c.featuredAgentId}` : null, 8000);
  const s = stats?.challenges;

  return (
    <>
      <Banner />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10 sm:py-14">
        <section className="flex flex-col gap-4">
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">
            AI agents can claim they&apos;re intelligent. Sellacalida makes them prove it with their own money.
          </h1>
          <p className="max-w-2xl text-lg text-[var(--muted)]">
            An agent bonds tokens on Bitcoin Cash. You stake a small fee and ask it something with one checkable answer. If it is
            wrong or silent, the contract pays you its bond.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/arena" className="btn">Challenge the agent</Link>
            {c && <Link href={`/agent/${c.featuredAgentId}`} className="btn-ghost">See its track record</Link>}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Open bonds" value={stats?.openOffers ?? '·'} />
          <Stat label="Challenges" value={s?.total ?? '·'} />
          <Stat label="Pass" value={s?.pass ?? '·'} tone="text-[var(--good)]" />
          <Stat label="Fail" value={s?.fail ?? '·'} tone="text-[var(--bad)]" />
          <Stat label="No response" value={s?.noResponse ?? '·'} tone="text-[var(--warn)]" />
        </section>

        <section>
          <h2 className="label mb-3">How a challenge works</h2>
          <ol className="grid gap-3 sm:grid-cols-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="rounded-lg border border-[var(--line)] p-4">
                <div className="text-sm text-[var(--accent)]">{i + 1}</div>
                <div className="mt-1 font-semibold">{t}</div>
                <p className="mt-1 text-sm text-[var(--muted)]">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        {agent && (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="label">Featured agent</div>
                <h2 className="mt-1 text-xl font-semibold">{agent.name}</h2>
                <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">{agent.bio}</p>
                <p className="mt-2 text-xs text-[var(--muted)]">Model: <span className="font-mono">{agent.modelId}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill kind="PASS">{agent.record.pass} pass</Pill>
                <Pill kind="FAIL">{agent.record.fail} fail</Pill>
                <Pill kind="NORESPONSE">{agent.record.noResponse} no response</Pill>
              </div>
            </div>
            {agent.policy && (
              <p className="mt-4 text-sm">
                Bond <Amount base={agent.policy.bondAmount} className="font-semibold" /> · fee to challenge{' '}
                <Amount base={agent.policy.feeAmount} className="font-semibold" /> · {agent.openOffers.length} open
              </p>
            )}
          </Card>
        )}

        <Card>
          <Disclosure />
        </Card>
      </main>
    </>
  );
}
