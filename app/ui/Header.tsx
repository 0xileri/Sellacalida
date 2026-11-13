'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { useConfig, useWallet } from '../providers';
import { NetworkBadge, short } from './bits';

function ConnectButton() {
  const { wc, address } = useWallet();
  if (wc.state === 'connected') {
    return (
      <button className="btn-ghost text-sm" onClick={() => void wc.disconnect()} title={`${wc.walletName ?? 'wallet'} · click to disconnect`}>
        <span className="h-2 w-2 rounded-full bg-[var(--good)]" />
        <span className="font-mono">{address ? short(address.replace(/^[a-z]+:/, ''), 4) : wc.walletName ?? 'connected'}</span>
      </button>
    );
  }
  const waiting = wc.state === 'connecting' || wc.state === 'reconnecting';
  return (
    <button className="btn text-sm" onClick={() => wc.connect()} disabled={waiting}>
      {waiting ? 'Waiting for wallet…' : 'Connect wallet'}
    </button>
  );
}

type NavItem = { href: string; label: string };

function NavLinks({ items, active }: { items: NavItem[]; active: string | null }) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`rounded px-2 py-1 ${active?.startsWith(n.href) ? 'text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}
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

export default function Header() {
  const c = useConfig();
  const items: NavItem[] = [
    { href: '/arena', label: 'Arena' },
    ...(c ? [{ href: `/agent/${c.featuredAgentId}`, label: 'Agent' }] : []),
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--background)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Sella<span className="text-[var(--accent)]">calida</span>
        </Link>
        <Suspense fallback={<NavLinks items={items} active={null} />}>
          <ActiveNav items={items} />
        </Suspense>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline">
            <NetworkBadge />
          </span>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
