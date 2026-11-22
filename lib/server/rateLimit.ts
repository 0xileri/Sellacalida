// Per-client sliding-window limiter for public POST routes (preparing a challenge). It keeps one
// client from flooding the JSON store or the Electrum server. State lives on globalThis so every
// Next.js bundle in the process shares it (see lib/server/context.ts).
const holder = globalThis as unknown as { __sellacalidaRate?: Map<string, number[]> };
const buckets = (): Map<string, number[]> => (holder.__sellacalidaRate ??= new Map<string, number[]>());

/** Preparing a challenge: a real challenger needs one per attempt, so this is generous. */
export const PREPARE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

/**
 * The client as the hosting proxy saw it: the last X-Forwarded-For hop, which the proxy appends
 * (or writes) itself. Earlier hops come from the client and are not trusted.
 */
export function clientKey(req: Request): string {
  const hops = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return hops.at(-1) ?? 'local';
}

/** Takes a slot, or returns a readable refusal. Old timestamps and idle clients are pruned as it goes. */
export function takeRateSlot(scope: string, key: string, o: { limit: number; windowMs: number }, now = Date.now()): string | null {
  const m = buckets();
  const id = `${scope}:${key}`;
  const recent = (m.get(id) ?? []).filter((t) => t > now - o.windowMs);
  if (recent.length >= o.limit) {
    m.set(id, recent);
    const wait = Math.max(1, Math.ceil((recent[0] + o.windowMs - now) / 1000));
    return `too many requests from this address; try again in ${wait} s`;
  }
  recent.push(now);
  m.set(id, recent);
  if (m.size > 5000) {
    for (const [k, v] of m) if (!v.length || v[v.length - 1] <= now - o.windowMs) m.delete(k);
  }
  return null;
}

/** Test hook. */
export function resetRateLimits() {
  holder.__sellacalidaRate = new Map<string, number[]>();
}
