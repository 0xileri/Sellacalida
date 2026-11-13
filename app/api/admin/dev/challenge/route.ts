import { takePublicDevSlot } from '@/lib/server/devLimit';
import { handle, json, readJson, requireAdmin, serverCtx } from '@/lib/server/http';
import { afterAccept, challengeView, devSimulateAccept, UserError } from '@/lib/server/service';

/**
 * Mocknet only: play the challenger's wallet with a throwaway key, so the whole flow can be run
 * locally or on a public preview. Refuses on chipnet and mainnet. On a preview with
 * MOCKNET_PUBLIC_CHALLENGES=1 anyone may call it, subject to a global rate limit and a per-process
 * cap that bound LLM spend; otherwise it is an admin route.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = serverCtx();
    const pub = ctx.config.publicDevChallenges;
    if (!pub.enabled) requireAdmin(req, ctx);
    const body = await readJson<{ offerId?: unknown; spec?: unknown }>(req);
    if (typeof body.offerId !== 'string') throw new UserError('offerId is required');
    if (pub.enabled) {
      const refused = takePublicDevSlot(pub);
      if (refused) throw new UserError(refused, 429);
    }
    const c = await devSimulateAccept(ctx, body.offerId, body.spec);
    await afterAccept(ctx, c.id);
    return json(challengeView(ctx, ctx.db.challenge(c.id)!), 201);
  });
}
