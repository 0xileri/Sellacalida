'use client';

// The important page (spec section 7): everything about one challenge, with pass, fail and
// no-response shown with equal clarity, and the evidence reproducible.
import Link from 'next/link';
import { use, type ReactNode } from 'react';
import { TEMPLATES } from '@/lib/templates/public';
import type { ChallengeView, EvidenceView, StatsView } from '@/lib/wire';
import { usePoll } from '../../ui/hooks';
import { Amount, Card, CopyText, Disclosure, Pill, SourceBadge, TxLink, short, verdictLabel } from '../../ui/bits';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 border-t border-[var(--line)] py-2 text-sm first:border-t-0">
      <div className="text-[var(--muted)]">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

function Trace({ check }: { check: NonNullable<EvidenceView['check']> }) {
  const t = check.trace;
  if (t.kind === 'math') {
    return (
      <ol className="grid gap-1 font-mono text-xs">
        {t.steps.map((s, i) => (
          <li key={i} className="flex flex-wrap gap-2">
            <span className="text-[var(--muted)]">{i + 1}.</span>
            <span>{s.expr}</span>
            <span className="text-[var(--muted)]">=</span>
            <span>{s.value}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left font-mono text-xs">
        <thead className="text-[var(--muted)]">
          <tr>
            <th className="py-1 pr-3 font-normal">#</th>
            <th className="py-1 pr-3 font-normal">sats</th>
            <th className="py-1 pr-3 font-normal">token</th>
            <th className="py-1 pr-3 font-normal">nft</th>
            <th className="py-1 font-normal">match</th>
          </tr>
        </thead>
        <tbody>
          {t.outputs.map((o) => (
            <tr key={o.index} className={o.matched ? 'text-[var(--accent)]' : ''}>
              <td className="py-1 pr-3">{o.index}</td>
              <td className="py-1 pr-3">{o.valueSatoshis}</td>
              <td className="py-1 pr-3">{o.tokenCategory ? `${short(o.tokenCategory, 4)} ×${o.tokenAmount}` : '·'}</td>
              <td className="py-1 pr-3">{o.nftCapability ? `${o.nftCapability} ${o.nftCommitment || '(empty)'}` : '·'}</td>
              <td className="py-1">{o.matched ? 'yes' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.note && <p className="mt-2 text-xs text-[var(--muted)]">{t.note}</p>}
    </div>
  );
}

function Payout({ c }: { c: ChallengeView }) {
  const total = (BigInt(c.bondAmount) + BigInt(c.feeAmount)).toString();
  if (c.verdict === 'PASS')
    return <p>The agent answered correctly and receives <Amount base={total} className="font-semibold" />: its bond back plus your fee.</p>;
  if (c.verdict === 'FAIL')
    return <p>The agent was wrong. The challenger receives <Amount base={total} className="font-semibold" />: the fee back plus the agent&apos;s bond.</p>;
  if (c.verdict === 'NORESPONSE')
    return <p>The agent did not answer in time. The challenger receives <Amount base={total} className="font-semibold" />.</p>;
  if (c.status === 'timed_out')
    return <p>No verdict was signed before expiry, so both sides were refunded: <Amount base={c.bondAmount} /> to the agent, <Amount base={c.feeAmount} /> to the challenger.</p>;
  return <p className="text-[var(--muted)]">Nothing paid yet. The escrow holds <Amount base={total} /> until a signed verdict or the expiry height.</p>;
}

export default function ChallengeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: c, error } = usePoll<ChallengeView>(`/api/challenges/${id}`, 2500);
  const { data: stats } = usePoll<StatsView>('/api/stats', 10_000);

  if (error && !c) return <main className="mx-auto max-w-5xl px-4 py-10 text-[var(--bad)]">{error}</main>;
  if (!c) return <main className="mx-auto max-w-5xl px-4 py-10 text-[var(--muted)]">Loading challenge…</main>;

  const v = verdictLabel(c.status, c.verdict);
  const ev = c.evidence;
  const height = stats?.height ?? null;
  const settled = c.status === 'settled' || c.status === 'timed_out';

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-3">
        <Link href="/arena" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">← Arena</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{TEMPLATES[c.templateId].title}</h1>
          <span className="text-lg"><Pill kind={v.kind}>{v.text}</Pill></span>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Agent <Link className="underline underline-offset-4" href={`/agent/${c.agentId}`}>{c.agentName}</Link> · challenge{' '}
          <span className="font-mono">{short(c.id, 6)}</span> · {c.network}
        </p>
        {c.lastError && !settled && <p className="text-sm text-[var(--warn)]">{c.lastError}</p>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="label mb-2">The question</h2>
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">{c.prompt}</pre>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-[var(--muted)]">Canonical spec (its sha256 is bound into the escrow)</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--background)] p-2 font-mono">{c.specJson}</pre>
            </details>
          </Card>

          <Card>
            <h2 className="label mb-2">The agent&apos;s answer</h2>
            {!c.answer ? (
              <p className="text-[var(--muted)]">
                {c.status === 'accepted' ? 'Thinking… the answer is committed before the verifier looks at anything.' : 'No answer was committed.'}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-3xl font-semibold">{c.answer.canonicalAnswer || '(unparseable)'}</span>
                  <SourceBadge source={c.answer.source} modelId={c.answer.modelId} />
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-[var(--muted)]">Raw reply from the model</summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-[var(--background)] p-2 font-mono text-xs">{c.answer.rawResponse}</pre>
                </details>
                {c.answer.toolCalls.length > 0 && (
                  <div className="text-sm">
                    <div className="text-[var(--muted)]">Tool calls before answering</div>
                    <ul className="mt-1 grid gap-1 font-mono text-xs">
                      {c.answer.toolCalls.map((t, i) => (
                        <li key={i}>
                          {t.name}({short(t.arguments, 18)}) {t.ok ? '' : <span className="text-[var(--bad)]">error: {t.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <Row label="Committed at">height {c.answer.committedAtHeight} · {c.answer.committedAtWAT}</Row>
                  <Row label="Answer hash"><span className="font-mono text-xs">{c.answer.answerHash}</span></Row>
                  <Row label="Raw reply hash"><span className="font-mono text-xs">{c.answer.rawResponseHash}</span></Row>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="label mb-2">The verdict</h2>
            {!ev ? (
              <p className="text-[var(--muted)]">
                {c.status === 'timed_out' ? 'No verdict was signed. The escrow refunded both sides.' : 'Not signed yet.'}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Pill kind={ev.verdict}>{ev.verdict}</Pill>
                  {ev.check ? (
                    <span className="text-sm">
                      Expected <span className="font-mono font-semibold">{ev.check.expected}</span>, agent said{' '}
                      <span className="font-mono font-semibold">{c.answer?.canonicalAnswer || '(nothing parseable)'}</span>
                    </span>
                  ) : (
                    <span className="text-sm">No answer was committed before the answer deadline.</span>
                  )}
                </div>
                {ev.check && (
                  <div>
                    <div className="mb-2 text-sm text-[var(--muted)]">Checker trace (re-run from the evidence)</div>
                    <Trace check={ev.check} />
                  </div>
                )}
                <div>
                  <Row label="Signed at">height {ev.decidedAtHeight} · {ev.decidedAtWAT}</Row>
                  <Row label="Verifier key"><span className="font-mono text-xs">{ev.verifierPk}</span></Row>
                  <Row label="Signature"><span className="font-mono text-xs">{ev.signature}</span></Row>
                  <Row label="Attestation"><span className="font-mono text-xs">{ev.attestation}</span></Row>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a className="btn-ghost text-sm" href={`/api/challenges/${c.id}/evidence`}>Download evidence</a>
                  <CopyText text="npm run reproduce -- evidence.json" label="npm run reproduce -- evidence.json" />
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="label mb-2">Money</h2>
            <Row label="Agent bond"><Amount base={c.bondAmount} /></Row>
            <Row label="Challenger fee"><Amount base={c.feeAmount} /></Row>
            <Row label="Challenger"><span className="font-mono text-xs">{c.challengerAddress}</span></Row>
            <div className="mt-3 text-sm"><Payout c={c} /></div>
          </Card>
          <Card>
            <h2 className="label mb-2">Clock</h2>
            <Row label="Now">{height !== null ? `height ${height}` : '…'}</Row>
            <Row label="Answer deadline">
              height {c.answerDeadline}
              {height !== null && height < c.answerDeadline && !settled ? ` (${c.answerDeadline - height} blocks left)` : ''}
            </Row>
            <Row label="Expiry">height {c.expiryHeight}</Row>
          </Card>
          <Card>
            <h2 className="label mb-2">On chain</h2>
            <Row label="Accept">{c.acceptTxid ? <TxLink txid={c.acceptTxid} /> : '…'}</Row>
            <Row label="Escrow">{c.escrow ? <span><TxLink txid={c.escrow.txid} />:{c.escrow.vout}</span> : '…'}</Row>
            <Row label={c.timeoutTxid ? 'Timeout' : 'Settle'}>
              {c.settleTxid ? <TxLink txid={c.settleTxid} /> : c.timeoutTxid ? <TxLink txid={c.timeoutTxid} /> : '…'}
            </Row>
          </Card>
          <Card><Disclosure /></Card>
        </div>
      </div>
    </main>
  );
}
