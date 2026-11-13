import { handle, json, serverCtx } from '@/lib/server/http';
import { statsView } from '@/lib/server/service';

export async function GET() {
  return handle(async () => json(await statsView(serverCtx())));
}
