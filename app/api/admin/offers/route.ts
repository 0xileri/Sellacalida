import { handle, json, requireAdmin, serverCtx } from '@/lib/server/http';
import { createOffer, offerView, UserError } from '@/lib/server/service';

const asInt = (v: unknown, name: string) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' && typeof v !== 'number') throw new UserError(`${name} must be an integer`);
  if (!/^[0-9]+$/.test(String(v))) throw new UserError(`${name} must be a non-negative integer (base units)`);
  return BigInt(v);
};

/** Admin: the agent's hot wallet publishes a new bonded offer. */
export async function POST(req: Request) {
  return handle(async () => {
    const ctx = serverCtx();
    requireAdmin(req, ctx);
    const text = await req.text();
    let body: Record<string, unknown> = {};
    if (text.trim() !== '') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new UserError('request body must be JSON');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UserError('request body must be a JSON object');
      body = parsed as Record<string, unknown>;
    }
    const o = await createOffer(ctx, {
      bond: asInt(body.bond, 'bond'),
      fee: asInt(body.fee, 'fee'),
      maxDeadlineDelta: asInt(body.maxDeadlineDelta, 'maxDeadlineDelta'),
      verifierGraceBlocks: asInt(body.verifierGraceBlocks, 'verifierGraceBlocks'),
    } as Parameters<typeof createOffer>[1]);
    return json(offerView(ctx, o), 201);
  });
}
