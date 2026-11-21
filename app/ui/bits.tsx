'use client';

// Small display pieces shared by every page.
import { useState, type ReactNode } from 'react';
import { useConfig } from '../providers';
import { Check, Copy, Shield } from './icons';

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
    <a className="font-mono underline decoration-[var(--line-strong)] underline-offset-4 transition hover:text-[var(--foreground)] hover:decoration-[var(--accent)]" href={href} target="_blank" rel="noreferrer" title={txid}>
      {text}
    </a>
  ) : (
    <span className="font-mono" title={`${txid} (local mocknet, no explorer)`}>{text}</span>
  );
}

const PILL: Record<string, string> = {
  PASS: 'bg-[var(--good-bg)] text-[var(--good)] border-[var(--good)]/45',
  FAIL: 'bg-[var(--bad-bg)] text-[var(--bad)] border-[var(--bad)]/45',
  NORESPONSE: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/45',
  timed_out: 'bg-transparent text-[var(--muted)] border-[var(--line-strong)]',
  live: 'bg-[var(--live-bg)] text-[var(--live)] border-[var(--live)]/45',
  open: 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/45',
  muted: 'bg-transparent text-[var(--muted)] border-[var(--line-strong)]',
};

/** Text and soft background per outcome, for the larger outcome panels. */
export const TONE: Record<string, { text: string; bg: string; border: string }> = {
  PASS: { text: 'text-[var(--good)]', bg: 'bg-[var(--good-bg)]', border: 'border-[var(--good)]/40' },
  FAIL: { text: 'text-[var(--bad)]', bg: 'bg-[var(--bad-bg)]', border: 'border-[var(--bad)]/40' },
  NORESPONSE: { text: 'text-[var(--warn)]', bg: 'bg-[var(--warn-bg)]', border: 'border-[var(--warn)]/40' },
  live: { text: 'text-[var(--live)]', bg: 'bg-[var(--live-bg)]', border: 'border-[var(--live)]/40' },
  timed_out: { text: 'text-[var(--muted)]', bg: 'bg-[var(--panel-2)]', border: 'border-[var(--line-strong)]' },
  muted: { text: 'text-[var(--muted)]', bg: 'bg-[var(--panel-2)]', border: 'border-[var(--line-strong)]' },
};

export function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] leading-5 font-semibold tracking-wide whitespace-nowrap ${PILL[kind] ?? PILL.muted}`}
    >
      {kind === 'live' && <span className="live-dot !h-1.5 !w-1.5" />}
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
      className="group inline-flex max-w-full min-w-0 items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--background)]/60 px-2.5 py-1 text-left font-mono text-xs transition hover:border-[var(--accent)]/70"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      title="Copy"
    >
      <span className="truncate">{label ?? text}</span>
      <span className={`inline-flex shrink-0 items-center gap-1 ${done ? 'text-[var(--good)]' : 'text-[var(--muted)] group-hover:text-[var(--foreground)]'}`}>
        {done ? <Check size={13} /> : <Copy size={13} />}
        <span className="font-sans">{done ? 'copied' : 'copy'}</span>
      </span>
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-[var(--line)] bg-[var(--panel)]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

/** A card heading: small caps label, optional right-hand slot. */
export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="label">{children}</h2>
      {right}
    </div>
  );
}

export function Disclosure({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex gap-3">
      {!compact && (
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]">
          <Shield size={17} />
        </span>
      )}
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        <b className="text-[var(--foreground)]">Trust boundary.</b> The BCH contract holds the money and enforces the payout. An
        independent verifier runs a fixed, published test and signs pass, fail, or no-response. You can re-run the test from the
        evidence, but you do have to trust this verifier&apos;s key to be the one that signed it, and to sign no-response only
        when the agent really did not commit an answer by the deadline. This is not a fully trustless judgment of the AI. If the
        verifier never signs, both sides are refunded at the expiry height.
      </p>
    </div>
  );
}

/** A row of big numbers in one bordered strip (live counts, track records). Hairlines come from the 1px gap. */
export function StatStrip({ items }: { items: { label: string; value: number | string; tone?: string }[] }) {
  const odd = items.length % 2 === 1;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-5">
      {items.map((it, i) => (
        <div key={it.label} className={`bg-[var(--panel)] px-5 py-4 ${odd && i === items.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}>
          <div className={`text-3xl font-bold tracking-tight tabular-nums ${it.tone ?? ''}`}>{it.value}</div>
          <div className="mt-1 text-xs font-medium text-[var(--muted)]">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Pass / fail / no-response as one stacked bar. */
export function RecordBar({ pass, fail, noResponse }: { pass: number; fail: number; noResponse: number }) {
  const total = pass + fail + noResponse;
  if (!total) return <div className="h-2 rounded-full bg-[var(--panel-3)]" />;
  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-[var(--panel-3)]" role="img" aria-label={`${pass} pass, ${fail} fail, ${noResponse} no response`}>
      {pass > 0 && <div className="bg-[var(--good)]" style={{ width: `${(pass / total) * 100}%` }} />}
      {fail > 0 && <div className="bg-[var(--bad)]" style={{ width: `${(fail / total) * 100}%` }} />}
      {noResponse > 0 && <div className="bg-[var(--warn)]" style={{ width: `${(noResponse / total) * 100}%` }} />}
    </div>
  );
}

export function NetworkBadge() {
  const c = useConfig();
  if (!c) return null;
  const text = c.network === 'mainnet' ? 'Mainnet' : c.network === 'chipnet' ? 'Chipnet · test coins' : 'Play money';
  const tone = c.network === 'mainnet' ? 'text-[var(--good)] border-[var(--good)]/35' : 'text-[var(--warn)] border-[var(--warn)]/35';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border bg-[var(--background)]/60 px-2.5 py-1 text-xs font-medium whitespace-nowrap ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}
