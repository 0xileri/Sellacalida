'use client';

import { useCallback, useEffect, useState } from 'react';

/** Poll a JSON endpoint (spec section 2: browser polling every 2-3 s, no websockets). */
export function usePoll<T>(url: string | null, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        const body = await r.json();
        if (!alive) return;
        if (!r.ok) setError(body?.error ?? `HTTP ${r.status}`);
        else {
          setData(body as T);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, refresh };
}
