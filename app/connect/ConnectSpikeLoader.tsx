'use client';

import dynamic from 'next/dynamic';

// Wallet and chain libraries touch browser-only APIs (WebSocket, localStorage, WASM), so the spike
// renders on the client only.
const ConnectSpike = dynamic(() => import('./ConnectSpike'), {
  ssr: false,
  loading: () => <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-[var(--muted)]">Loading wallet tools...</div>,
});

export default function ConnectSpikeLoader() {
  return <ConnectSpike />;
}
