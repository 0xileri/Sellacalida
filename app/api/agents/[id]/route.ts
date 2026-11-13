import { handle, json, serverCtx } from '@/lib/server/http';
import { agentView, UserError } from '@/lib/server/service';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const view = agentView(serverCtx(), id);
    if (!view) throw new UserError('no such agent', 404);
    return json(view);
  });
}
