import { handle, json, serverCtx } from '@/lib/server/http';
import { UserError } from '@/lib/server/service';

/** The evidence file for a signed verdict. Re-check it offline with `npm run reproduce`. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const c = serverCtx().db.challenge(id);
    if (!c) throw new UserError('no such challenge', 404);
    if (!c.evidence) throw new UserError('no signed verdict yet', 404);
    return json(c.evidence, 200, { 'content-disposition': `attachment; filename="sellacalida-evidence-${id.slice(0, 12)}.json"` });
  });
}
