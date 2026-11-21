'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { useConfig, useWallet } from '../providers';
import { NetworkBadge, short } from './bits';
import { ArrowUpRight, Wallet } from './icons';
import { Wordmark } from './Logo';

function ConnectButton() {
  const { wc, address } = useWallet();
  if (wc.state === 'connected') {
    return (
      <button className="btn-ghost" onClick={() => void wc.disconnect()} title={`${wc.walletName ?? 'wallet'} · click to disconnect`}>
        <span className="h-2 w-2 rounded-full bg-[var(--good)] shadow-[0_0_0_3px_rgba(63,185,80,0.18)]" />
        <span className="font-mono">{address ? short(address.replace(/^[a-z]+:/, ''), 4) : wc.walletName ?? 'connected'}</span>
      </button>
    );
  }
  const waiting = wc.state === 'connecting' || wc.state === 'reconnecting';
  return (
    <button className="btn" onClick={() => wc.connect()} disabled={waiting}>
      <Wallet size={16} />
      <span>{waiting ? 'Waiting for wallet…' : 'Connect wallet'}</span>
    </button>
  );
}

type NavItem = { href: string; label: string };

function NavLinks({ items, active }: { items: NavItem[]; active: string | null }) {
  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`rounded-lg px-3 py-1.5 transition ${
            active?.startsWith(n.href)
              ? 'bg-[var(--panel-2)] text-[var(--foreground)] shadow-[inset_0_0_0_1px_var(--line-strong)]'
              : 'text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--foreground)]'
          }`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

// usePathname is runtime URL data under Cache Components, so it lives behind Suspense
function ActiveNav({ items }: { items: NavItem[] }) {
  return <NavLinks items={items} active={usePathname()} />;
}

/** The other deployment: mainnet links to the play-money copy, the play copy links back. */
function OtherSiteLink() {
  const c = useConfig();
  if (!c) return null;
  const href = c.network === 'mainnet' ? c.links.play : c.network === 'mocknet' ? c.links.live : null;
  if (!href) return null;
  const label = c.network === 'mainnet' ? 'Try with play money' : 'Real money (mainnet)';
  return (
    <a className="hidden items-center gap-1 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)] lg:inline-flex" href={href}>
      {label}
      <ArrowUpRight size={14} />
    </a>
  );
}

export default function Header() {
  const c = useConfig();
  const items: NavItem[] = [
    { href: '/arena', label: 'Arena' },
    ...(c ? [{ href: `/agent/${c.featuredAgentId}`, label: 'Agent' }] : []),
  ];
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--background)]/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-5 sm:px-6">
        <Link href="/" className="rounded-lg" aria-label="Sellacalida home">
          <Wordmark textClassName="hidden sm:inline" />
        </Link>
        <Suspense fallback={<NavLinks items={items} active={null} />}>
          <ActiveNav items={items} />
        </Suspense>
        <div className="ml-auto flex items-center gap-3">
          <OtherSiteLink />
          <span className="hidden sm:inline-flex">
            <NetworkBadge />
          </span>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
