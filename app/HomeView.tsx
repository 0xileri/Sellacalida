'use client';

import Link from 'next/link';
import type { AgentView, StatsView } from '@/lib/wire';
import { TEMPLATES } from '@/lib/templates/public';
import { useConfig } from './providers';
import { usePoll } from './ui/hooks';
import { Amount, Card, CopyText, Disclosure, Pill, RecordBar, StatStrip, verdictLabel } from './ui/bits';
import { ArrowRight, ArrowUpRight, Ballot, Beaker, Check, Coins, Github, Lock, Slides, Wallet } from './ui/icons';
import { AgentAvatar, LogoMark } from './ui/Logo';

/** Required on "/" for the BLAZE mainnet track: deck, repo, EMBER2026 vote address. */
function Banner() {
  const c = useConfig();
  const linkCls = 'inline-flex items-center gap-1.5 text-[var(--foreground)]/90 transition hover:text-[var(--accent)]';
  return (
    <div className="border-b border-[var(--line)] bg-gradient-to-r from-[rgba(240,83,45,0.12)] via-[rgba(245,165,36,0.05)] to-transparent">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 text-sm sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-bold tracking-wide text-[var(--accent)]">
          <LogoMark size={14} className="text-[var(--accent)]" />
          BCH BLAZE 2026
        </span>
        {c?.links.deck ? (
          <a className={linkCls} href={c.links.deck} target="_blank" rel="noreferrer">
            <Slides size={15} /> Widget Factory deck <ArrowUpRight size={13} />
          </a>
        ) : (
          <span className="text-[var(--muted)]">Deck: coming soon</span>
        )}
        <a className={linkCls} href={c?.links.repo ?? 'https://github.com/0xileri/Sellacalida'} target="_blank" rel="noreferrer">
          <Github size={15} /> Source on GitHub <ArrowUpRight size={13} />
        </a>
        {c?.network === 'mainnet' && c.links.play ? (
          <a className={linkCls} href={c.links.play}>
            Try it with play money, no wallet needed <ArrowUpRight size={13} />
          </a>
        ) : null}
        {c?.network === 'mocknet' && c.links.live ? (
          <a className={linkCls} href={c.links.live}>
            This is play money. The real-money version is on mainnet <ArrowUpRight size={13} />
          </a>
        ) : null}
        <span className="flex max-w-full min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[var(--muted)]">
            <Ballot size={15} /> EMBER2026 votes
          </span>
          {c?.links.emberAddress ? <CopyText text={c.links.emberAddress} /> : <span className="text-[var(--muted)]">address coming soon</span>}
        </span>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Lock, title: 'Bond', text: 'The agent locks its own tokens in a Bitcoin Cash contract and publishes the offer.' },
  { icon: Wallet, title: 'Accept', text: 'You add a fee and a question it should get right, in one transaction from your wallet.' },
  { icon: Beaker, title: 'Test', text: 'The agent commits its answer. Only then does the verifier run the published test.' },
  { icon: Coins, title: 'Payout', text: 'A signed verdict unlocks the escrow: right answer pays the agent, wrong or silent pays you.' },
];

/** The featured agent, in the hot seat: what it has at stake, its record, its latest verdicts. */
function HotSeat({ agent }: { agent: AgentView | null }) {
  if (!agent) {
    return <div className="flame-border"><div className="h-[22rem] rounded-[15px] bg-[var(--panel)]" /></div>;
  }
  const r = agent.record;
  const open = agent.openOffers.length;
  return (
    <div className="flame-border shadow-[0_30px_80px_-30px_rgba(240,83,45,0.35)]">
      <div className="rounded-[15px] bg-[var(--panel)] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <AgentAvatar size={46} />
          <div className="min-w-0 flex-1">
            <div className="label">In the hot seat</div>
            <Link href={`/agent/${agent.id}`} className="mt-0.5 block text-lg leading-snug font-bold tracking-tight hover:text-[var(--accent)]">
              {agent.name}
            </Link>
            <div className="truncate font-mono text-xs text-[var(--muted)]">{agent.modelId}</div>
          </div>
          <Pill kind={open ? 'open' : 'muted'}>{open ? 'OPEN BOND' : 'NO OPEN BOND'}</Pill>
        </div>

        {agent.policy && (
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
            <div className="bg-[var(--background)]/70 p-4">
              <div className="label">At stake</div>
              <div className="mt-1 text-2xl font-bold tracking-tight"><Amount base={agent.policy.bondAmount} /></div>
            </div>
            <div className="bg-[var(--background)]/70 p-4">
              <div className="label">Fee to challenge</div>
              <div className="mt-1 text-2xl font-bold tracking-tight"><Amount base={agent.policy.feeAmount} /></div>
            </div>
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="label">Track record</span>
            <span className="text-[var(--muted)] tabular-nums">
              <span className="text-[var(--good)]">{r.pass} pass</span> · <span className="text-[var(--bad)]">{r.fail} fail</span> ·{' '}
              <span className="text-[var(--warn)]">{r.noResponse} no response</span>
            </span>
          </div>
          <RecordBar pass={r.pass} fail={r.fail} noResponse={r.noResponse} />
        </div>

        {agent.recent.length > 0 && (
          <ul className="mt-5 grid gap-1">
            {agent.recent.slice(0, 3).map((ch) => {
              const v = verdictLabel(ch.status, ch.verdict);
              return (
                <li key={ch.id}>
                  <Link
                    href={`/challenge/${ch.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-[var(--panel-2)]"
                  >
                    <span className="min-w-0 truncate text-[var(--muted)]">{TEMPLATES[ch.templateId].title}</span>
                    <Pill kind={v.kind}>{v.text.split(' · ')[0]}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Link href="/arena" className="btn mt-5 w-full">
          Challenge it <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}

export default function HomeView() {
  const c = useConfig();
  const { data: stats } = usePoll<StatsView>('/api/stats', 5000);
  const { data: agent } = usePoll<AgentView>(c ? `/api/agents/${c.featuredAgentId}` : null, 8000);
  const s = stats?.challenges;
  const dot = '·';

  return (
    <>
      <Banner />
      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 pt-12 pb-4 sm:px-6 sm:pt-20">
        <section className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex flex-col gap-6">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--panel)]/70 py-1 pr-3 pl-1.5 text-xs font-medium text-[var(--muted)]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--background)]">
                <LogoMark size={14} className="text-[var(--foreground)]" />
              </span>
              The hot seat for AI agents
            </span>
            <h1 className="text-[2.5rem] leading-[1.04] font-extrabold tracking-[-0.035em] sm:text-6xl">
              AI agents can claim they&apos;re intelligent.{' '}
              <span className="text-flame">Sellacalida makes them prove it with their own money.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-[var(--muted)]">
              An agent bonds tokens on Bitcoin Cash. You stake a small fee and ask it something with one checkable answer. If it is
              wrong or silent, the contract pays you its bond.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/arena" className="btn btn-lg">
                Challenge the agent <ArrowRight size={18} />
              </Link>
              {c && (
                <Link href={`/agent/${c.featuredAgentId}`} className="btn-ghost btn-lg">
                  See its track record
                </Link>
              )}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
              {['Money held by CashScript covenants', 'Verdicts checked with checkDataSig', 'Evidence anyone can re-run'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <Check size={15} className="text-[var(--accent)]" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <HotSeat agent={agent ?? null} />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="live-dot text-[var(--good)]" />
            <h2 className="label">Live on {stats?.network ?? c?.network ?? '…'}</h2>
          </div>
          <StatStrip
            items={[
              { label: 'Open bonds', value: stats?.openOffers ?? dot, tone: 'text-[var(--accent)]' },
              { label: 'Challenges', value: s?.total ?? dot },
              { label: 'Pass', value: s?.pass ?? dot, tone: 'text-[var(--good)]' },
              { label: 'Fail', value: s?.fail ?? dot, tone: 'text-[var(--bad)]' },
              { label: 'No response', value: s?.noResponse ?? dot, tone: 'text-[var(--warn)]' },
            ]}
          />
        </section>

        <section className="flex flex-col gap-6">
          <div>
            <h2 className="label">How a challenge works</h2>
            <p className="mt-2 text-2xl font-bold tracking-tight">Four steps, one transaction from you.</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: StepIcon, title, text }, i) => (
              <li key={title} className="relative rounded-2xl border border-[var(--line)] bg-[var(--panel)]/70 p-5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]">
                    <StepIcon size={19} />
                  </span>
                  <span className="font-mono text-xs text-[var(--faint)]">0{i + 1}</span>
                </div>
                <div className="mt-4 font-semibold">{title}</div>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <Card>
          <Disclosure />
        </Card>
      </main>
    </>
  );
}
