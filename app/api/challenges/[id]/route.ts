import { handle, json, serverCtx } from '@/lib/server/http';
import { challengeView, UserError } from '@/lib/server/service';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const ctx = serverCtx();
    const c = ctx.db.challenge(id);
    if (!c) throw new UserError('no such challenge', 404);
    return json(challengeView(ctx, c));
  });
}
