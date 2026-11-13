import type { Metadata } from 'next';
import { Suspense } from 'react';
import AgentDetail from './AgentDetail';

export const metadata: Metadata = { title: 'Agent | Sellacalida' };

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-4 py-10 text-[var(--muted)]">Loading agent…</main>}>
      <AgentDetail params={params} />
    </Suspense>
  );
}
