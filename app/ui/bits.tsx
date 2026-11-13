'use client';

// Small display pieces shared by every page.
import { useState, type ReactNode } from 'react';
import { useConfig } from '../providers';

export function formatUnits(base: string | bigint, decimals: number): string {
  const v = BigInt(base);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  if (decimals === 0) return `${neg ? '-' : ''}${abs}`;
  const s = abs.toString().padStart(decimals + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/** "1.00 PUSD" with the integer base units in the tooltip (spec section 7 copy rule). */
export function Amount({ base, className = '' }: { base: string | bigint; className?: string }) {
  const c = useConfig();
  const decimals = c?.tokenDecimals ?? 2;
  const symbol = c?.tokenSymbol ?? '';
  return (
    <span className={`tabular-nums ${className}`} title={`${base} base units`}>
      {formatUnits(base, decimals)} {symbol}
    </span>
  );
}

export function explorerTx(network: string | undefined, txid: string) {
  if (network === 'mainnet') return `https://explorer.bch.ninja/tx/${txid}`;
  if (network === 'chipnet') return `https://chipnet.imaginary.cash/tx/${txid}`;
  return null;
}

export const short = (s: string, n = 6) => (s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

export function TxLink({ txid, label }: { txid: string; label?: string }) {
  const c = useConfig();
  const href = explorerTx(c?.network, txid);
  const text = label ?? short(txid, 8);
  return href ? (
    <a className="font-mono underline decoration-[var(--line)] underline-offset-4 hover:decoration-[var(--accent)]" href={href} target="_blank" rel="noreferrer" title={txid}>
      {text}
    </a>
  ) : (
    <span className="font-mono" title={`${txid} (local mocknet, no explorer)`}>{text}</span>
  );
}

const PILL: Record<string, string> = {
  PASS: 'bg-[var(--good-bg)] text-[var(--good)] border-[var(--good)]',
  FAIL: 'bg-[var(--bad-bg)] text-[var(--bad)] border-[var(--bad)]',
  NORESPONSE: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]',
  timed_out: 'bg-transparent text-[var(--muted)] border-[var(--line)]',
  live: 'bg-[var(--live-bg)] text-[var(--live)] border-[var(--live)]',
  open: 'bg-[var(--live-bg)] text-[var(--live)] border-[var(--live)]',
  muted: 'bg-transparent text-[var(--muted)] border-[var(--line)]',
};

export function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${PILL[kind] ?? PILL.muted}`}>
      {children}
    </span>
  );
}

export function verdictLabel(status: string, verdict: string | null): { kind: string; text: string } {
  if (verdict === 'PASS') return { kind: 'PASS', text: 'PASS · agent paid' };
  if (verdict === 'FAIL') return { kind: 'FAIL', text: 'FAIL · challenger paid' };
  if (verdict === 'NORESPONSE') return { kind: 'NORESPONSE', text: 'NO RESPONSE · challenger paid' };
  if (status === 'timed_out') return { kind: 'timed_out', text: 'REFUNDED · verifier timeout' };
  if (status === 'answered') return { kind: 'live', text: 'ANSWERED · verifying' };
  if (status === 'accepted') return { kind: 'live', text: 'LIVE · agent thinking' };
  if (status === 'awaiting_accept') return { kind: 'muted', text: 'waiting for accept' };
  return { kind: 'muted', text: status };
}

export function SourceBadge({ source, modelId }: { source: string; modelId: string | null }) {
  return source === 'fixture' ? (
    <Pill kind="NORESPONSE">FIXTURE · not an AI solve</Pill>
  ) : (
    <Pill kind="muted">AI · {modelId ?? 'unknown model'}</Pill>
  );
}

export function CopyText({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--line)] px-2 py-1 text-left font-mono text-xs hover:border-[var(--accent)]"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      title="Copy"
    >
      <span className="truncate">{label ?? text}</span>
      <span className="shrink-0 text-[var(--muted)]">{done ? 'copied' : 'copy'}</span>
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function Disclosure() {
  return (
    <p className="text-sm leading-relaxed text-[var(--muted)]">
      <b className="text-[var(--foreground)]">Trust boundary.</b> The BCH contract holds the money and enforces the payout. An
      independent verifier runs a fixed, published test and signs pass, fail, or no-response. You can re-run the test from the
      evidence, but you do have to trust this verifier&apos;s key to be the one that signed it, and to sign no-response only
      when the agent really did not commit an answer by the deadline. This is not a fully trustless judgment of the AI. If the
      verifier never signs, both sides are refunded at the expiry height.
    </p>
  );
}

export function NetworkBadge() {
  const c = useConfig();
  if (!c) return null;
  const text = c.network === 'mainnet' ? 'mainnet' : c.network === 'chipnet' ? 'chipnet · test coins' : 'mocknet · play money';
  return <Pill kind={c.network === 'mainnet' ? 'PASS' : 'NORESPONSE'}>{text}</Pill>;
}
