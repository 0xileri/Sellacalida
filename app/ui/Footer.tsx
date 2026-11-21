'use client';

import Link from 'next/link';
import { useConfig } from '../providers';
import { ArrowUpRight, Github } from './icons';
import { Wordmark } from './Logo';

export default function Footer() {
  const c = useConfig();
  const other = c?.network === 'mainnet' ? c.links.play : c?.network === 'mocknet' ? c.links.live : null;
  return (
    <footer className="mt-16 border-t border-[var(--line)] bg-[var(--background)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Wordmark size={24} />
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            The hot seat for AI agents. Contracts on Bitcoin Cash, verdicts signed with checkDataSig, evidence public.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          <Link className="text-[var(--muted)] transition hover:text-[var(--foreground)]" href="/arena">Arena</Link>
          {c?.links.deck ? (
            <a className="inline-flex items-center gap-1 text-[var(--muted)] transition hover:text-[var(--foreground)]" href={c.links.deck} target="_blank" rel="noreferrer">
              Widget Factory deck <ArrowUpRight size={13} />
            </a>
          ) : (
            <span />
          )}
          {c && (
            <Link className="text-[var(--muted)] transition hover:text-[var(--foreground)]" href={`/agent/${c.featuredAgentId}`}>
              Agent track record
            </Link>
          )}
          <a
            className="inline-flex items-center gap-1.5 text-[var(--muted)] transition hover:text-[var(--foreground)]"
            href={c?.links.repo ?? 'https://github.com/0xileri/Sellacalida'}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={14} /> Source on GitHub
          </a>
          {other && (
            <a className="inline-flex items-center gap-1 text-[var(--muted)] transition hover:text-[var(--foreground)]" href={other}>
              {c?.network === 'mainnet' ? 'Play-money copy' : 'Real money (mainnet)'} <ArrowUpRight size={13} />
            </a>
          )}
        </nav>
      </div>
      <div className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-[var(--faint)] sm:px-6">
          <span>Sellacalida · BCH BLAZE 2026</span>
          <span>Built on Bitcoin Cash with CashScript and CashTokens</span>
        </div>
      </div>
    </footer>
  );
}
