import { handle, json, readJson, serverCtx } from '@/lib/server/http';
import { challengeView, prepareChallenge, recentChallenges, UserError } from '@/lib/server/service';

export async function GET() {
  return handle(() => json({ challenges: recentChallenges(serverCtx()) }));
}

/** Prepare a challenge: validates the spec now (never at settle time) and returns the accept bundle. */
export async function POST(req: Request) {
  return handle(async () => {
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
