'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TEMPLATES } from '@/lib/templates/public';
import type { ChallengeView, OfferView } from '@/lib/wire';
import { usePoll } from '../ui/hooks';
import { Amount, Card, Pill, SourceBadge, TxLink, verdictLabel } from '../ui/bits';
import AcceptPanel from './AcceptPanel';

function OfferCard({ offer }: { offer: OfferView }) {
  const [open, setOpen] = useState(false);
  const p = offer.params;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Pill kind="open">OPEN BOND</Pill>
            <Link href={`/agent/${offer.agentId}`} className="font-semibold hover:underline">{offer.agentName}</Link>
          </div>
          <div className="mt-2 text-2xl font-semibold"><Amount base={p.bondAmount} /></div>
          <div className="text-sm text-[var(--muted)]">
            at stake · you add <Amount base={p.feeAmount} /> · answer within {Number(p.maxDeadlineDelta) - Number(p.verifierGraceBlocks)} blocks
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">offer <TxLink txid={offer.txid} /></div>
        </div>
        {!open && <button className="btn" onClick={() => setOpen(true)}>Challenge</button>}
      </div>
      {open && <AcceptPanel offer={offer} onClose={() => setOpen(false)} />}
    </Card>
  );
}

export function ChallengeRow({ c }: { c: ChallengeView }) {
  const v = verdictLabel(c.status, c.verdict);
  return (
    <Link href={`/challenge/${c.id}`} className="grid gap-1 border-t border-[var(--line)] px-1 py-3 first:border-t-0 hover:bg-[var(--panel-2)] sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{TEMPLATES[c.templateId].title}</span>
          {c.answer && <SourceBadge source={c.answer.source} modelId={c.answer.modelId} />}
        </div>
        <div className="truncate text-sm text-[var(--muted)]">{c.prompt.split('\n')[0]}</div>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <Amount base={(BigInt(c.bondAmount) + BigInt(c.feeAmount)).toString()} className="text-[var(--muted)]" />
        <Pill kind={v.kind}>{v.text}</Pill>
      </div>
    </Link>
  );
}

export default function ArenaView() {
  const offers = usePoll<{ open: OfferView[] }>('/api/offers', 4000);
  const challenges = usePoll<{ challenges: ChallengeView[] }>('/api/challenges', 3000);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Arena</h1>
        <p className="mt-1 text-[var(--muted)]">Pick an open bond, ask something with one checkable answer, and lock your fee.</p>
      </header>

      <section className="grid gap-3">
        <h2 className="label">Open bonds</h2>
        {offers.error && <p className="text-sm text-[var(--bad)]">{offers.error}</p>}
        {offers.data?.open.length === 0 && (
          <Card><p className="text-sm text-[var(--muted)]">No open bonds right now. The agent publishes a new one after each challenge.</p></Card>
        )}
        {offers.data?.open.map((o) => <OfferCard key={o.id} offer={o} />)}
      </section>

      <section className="grid gap-3">
        <h2 className="label">Live and recent challenges</h2>
        <Card className="py-1 sm:py-1">
          {challenges.data?.challenges.length ? (
            challenges.data.challenges.map((c) => <ChallengeRow key={c.id} c={c} />)
          ) : (
            <p className="py-3 text-sm text-[var(--muted)]">{challenges.loading ? 'Loading…' : 'No challenges yet. Be the first.'}</p>
          )}
        </Card>
      </section>
    </main>
  );
}
