import { handle, json, readJson, serverCtx } from '@/lib/server/http';
import { clientKey, PREPARE_LIMIT, takeRateSlot } from '@/lib/server/rateLimit';
import { challengeView, prepareChallenge, recentChallenges, UserError } from '@/lib/server/service';

export async function GET() {
  return handle(() => json({ challenges: recentChallenges(serverCtx()) }));
}

/** Prepare a challenge: validates the spec now (never at settle time) and returns the accept bundle. */
export async function POST(req: Request) {
  return handle(async () => {
    // before any parsing or chain lookups, so a flood costs nothing but this check
    const refused = takeRateSlot('prepare', clientKey(req), PREPARE_LIMIT);
    if (refused) {
      const hops = (req.headers.get('x-forwarded-for') ?? '').split(',').filter((h) => h.trim()).length;
      console.warn(`[sellacalida] prepare rate-limited (x-forwarded-for hops: ${hops})`);
      throw new UserError(refused, 429);
    }
    const body = await readJson<{ offerId?: unknown; spec?: unknown; challengerAddress?: unknown }>(req);
    if (typeof body.offerId !== 'string' || typeof body.challengerAddress !== 'string') {
      throw new UserError('offerId and challengerAddress are required');
    }
    const ctx = serverCtx();
    const { challenge, bundle } = await prepareChallenge(ctx, {
      offerId: body.offerId, spec: body.spec, challengerAddress: body.challengerAddress,
    });
    return json({ challenge: challengeView(ctx, challenge), bundle }, 201);
  });
}
