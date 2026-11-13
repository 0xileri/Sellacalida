// Small helpers shared by the route handlers.
import { timingSafeEqual } from 'node:crypto';
import { connection } from 'next/server';
import { getServerContext, type ServerContext } from './context';
import { ensureAgent, UserError } from './service';

let agentEnsured = false;

/** The process-wide server context, with the configured agent registered once. */
export function serverCtx(): ServerContext {
  const ctx = getServerContext();
  if (!agentEnsured) {
    ensureAgent(ctx);
    agentEnsured = true;
  }
  return ctx;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

/** Run a handler, turning UserError into its status and anything else into a 500 with a message. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  // Cache Components prerenders GET handlers that touch no request data, which would freeze live
  // state (offers, stats) at build time. connection() makes every API response request-time.
  // Its prerender bailout must propagate; only "no Next request at all" (direct calls in tests)
  // is tolerated.
  try {
    await connection();
  } catch (e) {
    if (!(e instanceof Error && e.message.includes('called outside a request scope'))) throw e;
  }
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    const message = e instanceof Error ? e.message : String(e);
    console.error('[api]', message);
    return json({ error: message }, 500);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new UserError('request body must be JSON');
  }
}

/** Admin routes: Bearer ADMIN_TOKEN. Without a token configured they only work on mocknet. */
export function requireAdmin(req: Request, ctx: ServerContext) {
  const token = ctx.config.adminToken;
  if (!token) {
    if (ctx.config.network === 'mocknet') return;
    throw new UserError('admin routes are disabled: set ADMIN_TOKEN', 403);
  }
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UserError('unauthorized', 401);
}
