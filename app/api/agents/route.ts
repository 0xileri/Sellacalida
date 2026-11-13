import { handle, json, serverCtx } from '@/lib/server/http';
import { agentView } from '@/lib/server/service';

export async function GET() {
  return handle(() => {
    const ctx = serverCtx();
    return json({ agents: ctx.db.agents.map((a) => agentView(ctx, a.id)) });
  });
}
