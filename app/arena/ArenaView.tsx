'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TEMPLATES } from '@/lib/templates/public';
import type { ChallengeView, OfferView } from '@/lib/wire';
import { usePoll } from '../ui/hooks';
import { Amount, Card, Pill, SourceBadge, TxLink, verdictLabel } from '../ui/bits';
import { ArrowRight, ChevronRight, Clock, Coins } from '../ui/icons';
import { AgentAvatar } from '../ui/Logo';
import AcceptPanel from './AcceptPanel';

function OfferCard({ offer }: { offer: OfferView }) {
  const [open, setOpen] = useState(false);
  const p = offer.params;
  return (
    <div className={open ? 'flame-border' : 'rounded-2xl border border-[var(--line)]'}>
      <div className={`rounded-[15px] bg-[var(--panel)] p-5 sm:p-6`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <AgentAvatar size={48} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/agent/${offer.agentId}`} className="font-semibold hover:text-[var(--accent)]">{offer.agentName}</Link>
                <Pill kind="open">OPEN BOND</Pill>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tracking-tight"><Amount base={p.bondAmount} /></span>
                <span className="text-sm text-[var(--muted)]">at stake</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5"><Coins size={14} /> you add <Amount base={p.feeAmount} className="text-[var(--foreground)]" /></span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={14} /> answer within {Number(p.maxDeadlineDelta) - Number(p.verifierGraceBlocks)} blocks
                </span>
                <span>offer <TxLink txid={offer.txid} /></span>
              </div>
            </div>
          </div>
          {!open && (
            <button className="btn btn-lg w-full sm:w-auto" onClick={() => setOpen(true)}>
              Challenge <ArrowRight size={17} />
            </button>
          )}
        </div>
        {open && <AcceptPanel offer={offer} onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
}

const BAR: Record<string, string> = {
  PASS: 'bg-[var(--good)]',
  FAIL: 'bg-[var(--bad)]',
  NORESPONSE: 'bg-[var(--warn)]',
  live: 'bg-[var(--live)]',
};

export function ChallengeRow({ c }: { c: ChallengeView }) {
  const v = verdictLabel(c.status, c.verdict);
  return (
    <Link
      href={`/challenge/${c.id}`}
      className="group relative grid gap-2 border-t border-[var(--line)] py-4 pr-2 pl-5 transition first:border-t-0 hover:bg-[var(--panel-2)]/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
    >
      <span className={`absolute top-4 bottom-4 left-0 w-[3px] rounded-full ${BAR[v.kind] ?? 'bg-[var(--line-strong)]'}`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{TEMPLATES[c.templateId].title}</span>
          {c.answer && <SourceBadge source={c.answer.source} modelId={c.answer.modelId} />}
        </div>
        <div className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{c.prompt.split('\n')[0]}</div>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <Amount base={(BigInt(c.bondAmount) + BigInt(c.feeAmount)).toString()} className="text-[var(--muted)]" />
        <Pill kind={v.kind}>{v.text}</Pill>
        <ChevronRight size={16} className="hidden text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--foreground)] sm:block" />
      </div>
    </Link>
  );
}

export default function ArenaView() {
  const offers = usePoll<{ open: OfferView[] }>('/api/offers', 4000);
  const challenges = usePoll<{ challenges: ChallengeView[] }>('/api/challenges', 3000);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 pt-10 sm:px-6 sm:pt-14">
      <header className="flex flex-col gap-3">
        <span className="label">Arena</span>
        <h1 className="text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">
          Put the agent in the <span className="text-flame">hot seat</span>.
        </h1>
        <p className="max-w-2xl text-lg text-[var(--muted)]">Pick an open bond, ask something with one checkable answer, and lock your fee.</p>
      </header>

      <section className="grid gap-4">
        <h2 className="label">Open bonds</h2>
        {offers.error && <p className="text-sm text-[var(--bad)]">{offers.error}</p>}
        {offers.data?.open.length === 0 && (
          <Card><p className="text-sm text-[var(--muted)]">No open bonds right now. The agent publishes a new one after each challenge.</p></Card>
        )}
        {!offers.data && !offers.error && <div className="h-36 animate-pulse rounded-2xl border border-[var(--line)] bg-[var(--panel)]" />}
        {offers.data?.open.map((o) => <OfferCard key={o.id} offer={o} />)}
      </section>

      <section className="grid gap-4">
        <h2 className="label">Live and recent challenges</h2>
        <Card className="!p-0 overflow-hidden">
          {challenges.data?.challenges.length ? (
            challenges.data.challenges.map((c) => <ChallengeRow key={c.id} c={c} />)
          ) : (
            <p className="px-5 py-5 text-sm text-[var(--muted)]">{challenges.loading ? 'Loading…' : 'No challenges yet. Be the first.'}</p>
          )}
        </Card>
      </section>
    </main>
  );
}
