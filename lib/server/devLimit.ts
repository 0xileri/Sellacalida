// Global limiter for public play challenges on a mocknet preview: one at a time across all
// visitors, and a per-process cap, so LLM spend stays bounded. State lives on globalThis so every
// Next.js bundle in the process shares it (see lib/server/context.ts).
const holder = globalThis as unknown as { __sellacalidaDevLimit?: { last: number; count: number } };
const state = () => (holder.__sellacalidaDevLimit ??= { last: 0, count: 0 });

export function takePublicDevSlot(o: { minIntervalMs: number; maxPerProcess: number }, now = Date.now()): string | null {
  const s = state();
  const wait = s.last + o.minIntervalMs - now;
  if (wait > 0) return `one play challenge at a time on the preview; try again in ${Math.ceil(wait / 1000)} s`;
  if (s.count >= o.maxPerProcess) return 'the preview has used up its play challenges for now';
  s.last = now;
  s.count += 1;
  return null;
}

/** Test hook. */
export function resetPublicDevLimit() {
  holder.__sellacalidaDevLimit = { last: 0, count: 0 };
}
