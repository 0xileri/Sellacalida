import { handle, json, readJson, requireAdmin, serverCtx } from '@/lib/server/http';
import { afterAccept, challengeView, devSimulateAccept, UserError } from '@/lib/server/service';

/**
 * Mocknet only: play the challenger's wallet with a throwaway key, so the whole flow can be run
 * and screenshotted locally. Refuses on chipnet and mainnet.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = serverCtx();
    requireAdmin(req, ctx);
    const body = await readJson<{ offerId?: unknown; spec?: unknown }>(req);
    if (typeof body.offerId !== 'string') throw new UserError('offerId is required');
    const c = await devSimulateAccept(ctx, body.offerId, body.spec);
    await afterAccept(ctx, c.id);
    return json(challengeView(ctx, ctx.db.challenge(c.id)!), 201);
  });
}
