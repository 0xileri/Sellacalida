import { handle, json, readJson, requireAdmin, serverCtx } from '@/lib/server/http';
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
    const body = req.headers.get('content-length') === '0' ? {} : await readJson<Record<string, unknown>>(req).catch(() => ({}));
    const o = await createOffer(ctx, {
      bond: asInt(body.bond, 'bond'),
      fee: asInt(body.fee, 'fee'),
      maxDeadlineDelta: asInt(body.maxDeadlineDelta, 'maxDeadlineDelta'),
      verifierGraceBlocks: asInt(body.verifierGraceBlocks, 'verifierGraceBlocks'),
    } as Parameters<typeof createOffer>[1]);
    return json(offerView(ctx, o), 201);
  });
}
