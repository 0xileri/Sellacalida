import type { Metadata } from 'next';
import { Suspense } from 'react';
import ChallengeDetail from './ChallengeDetail';

export const metadata: Metadata = { title: 'Challenge | Sellacalida' };

// Cache Components: route params are runtime data, so they are read inside a Suspense boundary.
export default function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-4 py-10 text-[var(--muted)]">Loading challenge…</main>}>
      <ChallengeDetail params={params} />
    </Suspense>
  );
}
