// The verifier loop: one in-process timer, no separate worker (spec section 2). Started once from
// instrumentation.ts when the Node server boots.
import { serverCtx } from './http';
import { ensureOpenOffers, refreshOffers, verifierTick } from './service';

let started = false;

export function startVerifierLoop() {
  if (started) return;
  started = true;
  let ctx;
  try {
    ctx = serverCtx();
  } catch (e) {
    console.error('[sellacalida] verifier loop not started:', e instanceof Error ? e.message : e);
    return;
  }
  const every = ctx.config.verifierTickMs;
  console.log(`[sellacalida] ${ctx.config.network}: verifier ${ctx.verifier ? 'on' : 'OFF (no VERIFIER_PRIVATE_KEY)'}, agent ${ctx.llm ? ctx.llm.model : 'OFFLINE (no LLM_API_KEY)'}, tick ${every} ms`);
  const tick = async () => {
    try {
      await refreshOffers(ctx);
      await verifierTick(ctx);
      await ensureOpenOffers(ctx);
    } catch (e) {
      console.error('[sellacalida] tick failed:', e instanceof Error ? e.message : e);
    }
  };
  void tick();
  setInterval(() => void tick(), every).unref();
}
