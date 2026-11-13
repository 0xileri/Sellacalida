import { publicConfig } from '@/lib/server/config';
import { handle, json, serverCtx } from '@/lib/server/http';

export async function GET() {
  return handle(() => json(publicConfig(serverCtx().config)));
}
