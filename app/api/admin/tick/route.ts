import { handle, json, requireAdmin, serverCtx } from '@/lib/server/http';
import { refreshOffers, statsView, verifierTick } from '@/lib/server/service';

/** Admin: run one verifier pass now instead of waiting for the timer. */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = serverCtx();
    requireAdmin(req, ctx);
    await refreshOffers(ctx);
    await verifierTick(ctx);
    return json(await statsView(ctx));
  });
}
