import { handle, json, readJson, serverCtx } from '@/lib/server/http';
import { afterAccept, challengeView, confirmAccept, UserError } from '@/lib/server/service';

/** The challenger's wallet broadcast the accept. The server re-checks it on chain, then the agent runs. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const { txid } = await readJson<{ txid?: unknown }>(req);
    if (typeof txid !== 'string') throw new UserError('txid is required');
    const ctx = serverCtx();
    const c = await confirmAccept(ctx, id, txid.toLowerCase());
    void afterAccept(ctx, c.id).catch((e) => console.error('[sellacalida] afterAccept:', e));
    return json(challengeView(ctx, c));
  });
}
