import { handle, json, requireAdmin, serverCtx } from '@/lib/server/http';
import { cancelOffer, offerView } from '@/lib/server/service';

/** Admin: the agent reclaims an unaccepted bond. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ctx = serverCtx();
    requireAdmin(req, ctx);
    const { id } = await params;
    return json(offerView(ctx, await cancelOffer(ctx, decodeURIComponent(id))));
  });
}
