import { handle, json, serverCtx } from '@/lib/server/http';
import { offerView } from '@/lib/server/service';

export async function GET() {
  return handle(() => {
    const ctx = serverCtx();
    const open = ctx.db.offers.filter((o) => o.status === 'open').map((o) => offerView(ctx, o));
    return json({ open });
  });
}
