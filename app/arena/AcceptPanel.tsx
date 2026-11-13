'use client';

// Accept an offer: pick a template, fill its params, then lock your fee next to the agent's bond in
// one transaction from your wallet. On mocknet (local dev) a throwaway challenger key stands in.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseExpr } from '@/lib/templates/expr';
import { TEMPLATES, TEMPLATE_IDS, renderPrompt, validateSpecShape, type ChallengeSpec, type TemplateId } from '@/lib/templates/public';
import type { AcceptBundle, ChallengeView, OfferView } from '@/lib/wire';
import { useConfig, useWallet } from '../providers';
import { Amount } from '../ui/bits';

const HINTS: Record<TemplateId, string> = {
  'bch.output_token_count': 'Pick a real transaction with several token outputs. FT and NFT outputs both count.',
  'bch.total_sats_to_address': 'Token-aware and plain encodings of one address are the same destination.',
  'bch.nft_output_index': 'If zero or several outputs match, the right answer is -1.',
  'math.exact_result': 'Integers only. "/" truncates toward zero, "%" keeps the sign of the left side.',
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status });
  return data as T;
}

export default function AcceptPanel({ offer, onClose }: { offer: OfferView; onClose: () => void }) {
  const c = useConfig();
  const { wc, address } = useWallet();
  const router = useRouter();
  const [templateId, setTemplateId] = useState<TemplateId>('math.exact_result');
  const [expr, setExpr] = useState('(123456789 * -987654321) % 993');
  const [txid, setTxid] = useState('');
  const [category, setCategory] = useState('');
  const [addr, setAddr] = useState('');
  const [commitment, setCommitment] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const network = c?.network ?? 'chipnet';
  const { spec, problems } = useMemo(() => {
    try {
      const params =
        templateId === 'math.exact_result'
          ? parseExpr(expr)
          : templateId === 'bch.total_sats_to_address'
            ? { txid: txid.trim().toLowerCase(), address: addr.trim() }
            : templateId === 'bch.nft_output_index'
              ? { txid: txid.trim().toLowerCase(), category: category.trim().toLowerCase(), commitment: commitment.trim().toLowerCase() }
              : { txid: txid.trim().toLowerCase(), category: category.trim().toLowerCase() };
      const s = { templateId, version: 1, network, params } as ChallengeSpec;
      return { spec: s, problems: validateSpecShape(s) };
    } catch (e) {
      return { spec: null, problems: [e instanceof Error ? e.message : String(e)] };
    }
  }, [templateId, expr, txid, category, addr, commitment, network]);

  const grace = Number(offer.params.verifierGraceBlocks);
  const windowBlocks = Number(offer.params.maxDeadlineDelta);
  const isDev = network === 'mocknet';
  const busy = step !== null;

  async function submit() {
    if (!spec || problems.length) return;
    setError(null);
    try {
      let id: string;
      if (isDev) {
        setStep('simulating the challenger (mocknet)');
        id = (await postJson<ChallengeView>('/api/admin/dev/challenge', { offerId: offer.id, spec })).id;
      } else {
        if (!wc.manager || !address) throw new Error('connect your wallet first');
        setStep('checking the challenge');
        const { bundle } = await postJson<{ bundle: AcceptBundle }>('/api/challenges', { offerId: offer.id, spec, challengerAddress: address });
        const { signAndBroadcastAccept } = await import('@/lib/wallet/acceptFlow');
        const accepted = await signAndBroadcastAccept({ manager: wc.manager, network, bundle, onStep: (s) => setStep(s) });
        setStep('confirming on chain');
        for (let i = 0; ; i++) {
          try {
            await postJson('/api/challenges/' + bundle.challengeId + '/accepted', { txid: accepted });
            break;
          } catch (e) {
            if ((e as { status?: number }).status !== 404 || i >= 6) throw e;
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        id = bundle.challengeId;
      }
      router.push(`/challenge/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(null);
    }
  }

  return (
    <div className="mt-4 grid gap-4 rounded-lg border border-[var(--accent)]/40 bg-[var(--panel-2)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Challenge this bond</h3>
        <button className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]" onClick={onClose} disabled={busy}>Close</button>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="label mb-2">1. Pick a test</legend>
        {TEMPLATE_IDS.map((t) => (
          <label key={t} className={`cursor-pointer rounded-md border p-3 text-sm ${templateId === t ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}>
            <input type="radio" name="template" className="sr-only" checked={templateId === t} onChange={() => setTemplateId(t)} />
            <div className="font-medium">{TEMPLATES[t].title}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">{HINTS[t]}</div>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3">
        <div className="label">2. Make it hard</div>
        {templateId === 'math.exact_result' ? (
          <label className="grid gap-1 text-sm">
            Expression
            <input className="field font-mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="(-7 * 3) / 2" />
          </label>
        ) : (
          <>
            <label className="grid gap-1 text-sm">
              Transaction id
              <input className="field font-mono" value={txid} onChange={(e) => setTxid(e.target.value)} placeholder="64 hex chars" />
            </label>
            {templateId === 'bch.total_sats_to_address' ? (
              <label className="grid gap-1 text-sm">
                Address
                <input className="field font-mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={network === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'} />
              </label>
            ) : (
              <label className="grid gap-1 text-sm">
                Token category
                <input className="field font-mono" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="64 hex chars, explorer order" />
              </label>
            )}
            {templateId === 'bch.nft_output_index' && (
              <label className="grid gap-1 text-sm">
                NFT commitment (hex, optional)
                <input className="field font-mono" value={commitment} onChange={(e) => setCommitment(e.target.value)} placeholder="empty = any commitment" />
              </label>
            )}
          </>
        )}
      </div>

      <div className="grid gap-2 text-sm">
        <div className="label">3. What the agent will see</div>
        {spec && problems.length === 0 ? (
          <pre className="whitespace-pre-wrap rounded-md border border-[var(--line)] bg-[var(--background)] p-3 font-mono text-xs leading-relaxed">{renderPrompt(spec)}</pre>
        ) : (
          <ul className="list-inside list-disc text-[var(--bad)]">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </div>

      <div className="grid gap-1 text-sm text-[var(--muted)]">
        <div>
          You lock <Amount base={offer.params.feeAmount} className="text-[var(--foreground)]" />. The agent has{' '}
          <Amount base={offer.params.bondAmount} className="text-[var(--foreground)]" /> at stake. The winner takes both.
        </div>
        <div>
          The agent must answer within {windowBlocks - grace} blocks. If the verifier never signs, both sides are refunded after{' '}
          {windowBlocks} blocks.
        </div>
      </div>

      {isDev && (
        <p className="text-sm text-[var(--warn)]">
          Preview: play money on an in-memory test chain. A throwaway challenger key signs for you, but the agent&apos;s answer
          comes from the real model and the verifier signs for real.
        </p>
      )}
      {error && <p className="text-sm text-[var(--bad)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {isDev ? (
          <button className="btn" onClick={() => void submit()} disabled={busy || !spec || problems.length > 0}>
            Run it on mocknet (dev challenger)
          </button>
        ) : wc.state !== 'connected' ? (
          <button className="btn" onClick={() => wc.connect()}>Connect wallet to challenge</button>
        ) : (
          <button className="btn" onClick={() => void submit()} disabled={busy || !spec || problems.length > 0 || !address}>
            Lock fee and challenge
          </button>
        )}
        {step && <span className="text-sm text-[var(--muted)]">{step}…</span>}
      </div>
    </div>
  );
}
