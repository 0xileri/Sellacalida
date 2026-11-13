// Server service layer on mocknet: offers from the agent wallet, challenge preparation, accept
// confirmation re-checked from the raw tx, the agent run and the verifier tick.
import { describe, expect, it, vi } from 'vitest';
import { MockNetworkProvider, TransactionBuilder } from 'cashscript';
import type { LlmClient } from '@/lib/agent/llm';
import { PUSD_CATEGORY_MAINNET } from '@/lib/constants';
import { makeOfferContract } from '@/lib/contracts';
import { loadConfig } from '@/lib/server/config';
import { buildContextFromEnv, type ServerContext } from '@/lib/server/context';
import {
  UserError, agentView, cancelOffer, challengeView, confirmAccept, createOffer, devSimulateAccept, prepareChallenge,
  afterAccept, ensureOpenOffers, refreshOffers, statsView, verifierTick,
} from '@/lib/server/service';
import type { ChallengeSpec } from '@/lib/templates/public';
import { reproduceEvidence, type Evidence } from '@/lib/verifier/evidence';
import { pkhToCashAddress } from '@/lib/bch/address';
import { agent as stranger } from './helpers';

const MATH: ChallengeSpec = {
  templateId: 'math.exact_result', version: 1, network: 'mocknet',
  params: { op: 'div', left: { op: 'mul', left: '-7', right: '3' }, right: '2' }, // -10
};

function stubLlm(content: string): ServerContext['llm'] {
  const client: LlmClient = {
    complete: vi.fn(async () => ({ content, toolCalls: [], finishReason: 'stop', servedModel: 'anthropic/claude-sonnet-5.5', generationId: 'gen-x', usage: null })),
  };
  return { client, model: 'anthropic/claude-sonnet-5.5' };
}

function devCtx(llmAnswer: string | null = '-10') {
  const ctx = buildContextFromEnv({ NETWORK: 'mocknet' });
  ctx.llm = llmAnswer === null ? null : stubLlm(llmAnswer);
  return ctx;
}

const provider = (ctx: ServerContext) => ctx.provider as MockNetworkProvider;

describe('config guards', () => {
  it('mainnet must use the PUSD mainnet-v1 category', () => {
    expect(loadConfig({ NETWORK: 'mainnet' }).tokenCategory).toBe(PUSD_CATEGORY_MAINNET);
    expect(() => loadConfig({ NETWORK: 'mainnet', TOKEN_CATEGORY: 'ab'.repeat(32) })).toThrow(/must be PUSD/);
  });
  it('chipnet requires its own category and refuses PUSD', () => {
    expect(() => loadConfig({ NETWORK: 'chipnet' })).toThrow(/TOKEN_CATEGORY is required/);
    expect(() => loadConfig({ NETWORK: 'chipnet', TOKEN_CATEGORY: PUSD_CATEGORY_MAINNET })).toThrow(/never use the mainnet PUSD/);
  });
  it('refuses the wrapped-PUSD lookalike and unknown networks', () => {
    expect(() => loadConfig({ NETWORK: 'chipnet', TOKEN_CATEGORY: '741dd9a36c0a1d8b6d396b5095880ac942dcf3f634d969a2caa1d2021687519f' })).toThrow(/wrapped/);
    expect(() => loadConfig({ NETWORK: 'testnet4' })).toThrow(/NETWORK/);
  });
});

describe('offers', () => {
  it('the agent wallet publishes a bond into a live offer covenant', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    expect(o.status).toBe('open');
    const utxos = await makeOfferContract(o.params, ctx.provider).getUtxos();
    expect(utxos.map((u) => u.token)).toEqual([{ category: ctx.config.tokenCategory, amount: 100n }]);
    expect((await statsView(ctx)).openOffers).toBe(1);
  });

  it('the agent can cancel an open offer, after which it cannot be prepared', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    await cancelOffer(ctx, o.id);
    expect(ctx.db.offer(o.id)?.status).toBe('cancelled');
    await expect(prepareChallenge(ctx, { offerId: o.id, spec: MATH, challengerAddress: ctx.devChallenger!.address })).rejects.toThrow(/cancelled/);
  });
});

describe('auto bonds', () => {
  it('keeps AUTO_OFFERS bonds open and tops up after one is taken', async () => {
    const ctx = buildContextFromEnv({ NETWORK: 'mocknet', AUTO_OFFERS: '2' });
    ctx.llm = stubLlm('-10');
    expect(await ensureOpenOffers(ctx)).toBe(2);
    expect(await ensureOpenOffers(ctx)).toBe(0);
    const [first] = ctx.db.offers;
    await devSimulateAccept(ctx, first.id, MATH);
    expect(await ensureOpenOffers(ctx)).toBe(1);
    expect(ctx.db.offers.filter((o) => o.status === 'open')).toHaveLength(2);
  });

  it('does nothing without an agent key or when set to 0', async () => {
    const ctx = buildContextFromEnv({ NETWORK: 'mocknet', AUTO_OFFERS: '0' });
    expect(await ensureOpenOffers(ctx)).toBe(0);
    expect(ctx.db.offers).toHaveLength(0);
  });
});

describe('prepare', () => {
  it('rejects invalid params at accept time', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    const bad = { ...MATH, params: { op: 'div', left: '1', right: '0' } };
    await expect(prepareChallenge(ctx, { offerId: o.id, spec: bad, challengerAddress: ctx.devChallenger!.address })).rejects.toThrow(/division or modulo by zero/);
    await expect(prepareChallenge(ctx, { offerId: o.id, spec: { ...MATH, network: 'chipnet' }, challengerAddress: ctx.devChallenger!.address })).rejects.toThrow(/does not match/);
  });

  it('rejects a challenger address from another network', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    const mainnetAddr = pkhToCashAddress(stranger.pkh, 'mainnet');
    await expect(prepareChallenge(ctx, { offerId: o.id, spec: MATH, challengerAddress: mainnetAddr })).rejects.toThrow(/this app runs on mocknet/);
  });

  it('fixes the deadline from the offer policy and returns the accept bundle', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    const { challenge, bundle } = await prepareChallenge(ctx, { offerId: o.id, spec: MATH, challengerAddress: ctx.devChallenger!.address });
    expect(challenge.status).toBe('awaiting_accept');
    expect(bundle.locktime).toBe(300_000);
    expect(bundle.terms.expiryHeight).toBe(String(300_000 + 144));
    expect(bundle.offer.txid).toBe(o.txid);
  });
});

describe('accept confirmation is checked on chain', () => {
  it('refuses a transaction that does not spend the offer', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    const { challenge } = await prepareChallenge(ctx, { offerId: o.id, spec: MATH, challengerAddress: ctx.devChallenger!.address });
    const ch = ctx.devChallenger!;
    const [u] = (await ctx.provider.getUtxosForLockingBytecode(ch.lock)).filter((x) => !x.token);
    const b = new TransactionBuilder({ provider: ctx.provider });
    b.addInput(u, ch.template.unlockP2PKH());
    b.addOutput({ to: ch.lock, amount: u.satoshis - 500n });
    const { txid } = await b.send();
    await expect(confirmAccept(ctx, challenge.id, txid)).rejects.toThrow(/does not spend this offer/);
    expect(ctx.db.challenge(challenge.id)?.status).toBe('awaiting_accept');
  });

  it('a real accept is recorded, the offer closes, and confirming twice is harmless', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    const c = await devSimulateAccept(ctx, o.id, MATH);
    expect(c.status).toBe('accepted');
    expect(ctx.db.offer(o.id)?.status).toBe('accepted');
    expect((await confirmAccept(ctx, c.id, c.acceptTxid!)).status).toBe('accepted');
  });

  it('the dev challenger can run several challenges in a row (change UTXOs carry tokens and BCH)', async () => {
    const ctx = devCtx('-10');
    for (let i = 0; i < 3; i++) {
      const o = await createOffer(ctx);
      const c = await devSimulateAccept(ctx, o.id, MATH);
      expect(c.status).toBe('accepted');
    }
  });

  it('the dev accept route does not exist off mocknet', async () => {
    const ctx = devCtx();
    ctx.config = { ...ctx.config, network: 'chipnet' };
    await expect(devSimulateAccept(ctx, 'x', MATH)).rejects.toThrow(UserError);
  });
});

describe('agent + verifier', () => {
  it('correct answer: the agent commits, the verifier signs PASS and pays the agent', async () => {
    const ctx = devCtx('-10');
    const o = await createOffer(ctx);
    const c = await devSimulateAccept(ctx, o.id, MATH);
    await afterAccept(ctx, c.id);
    const v = challengeView(ctx, ctx.db.challenge(c.id)!);
    expect(v.status).toBe('settled');
    expect(v.verdict).toBe('PASS');
    expect(v.answer).toMatchObject({ source: 'ai', modelId: 'anthropic/claude-sonnet-5.5', canonicalAnswer: '-10' });
    expect(reproduceEvidence(JSON.parse(JSON.stringify(v.evidence)) as Evidence).ok).toBe(true);
    const a = agentView(ctx, ctx.config.agent.id)!;
    expect(a.record).toMatchObject({ challenges: 1, pass: 1, fail: 0 });
  });

  it('wrong answer: FAIL pays the challenger', async () => {
    const ctx = devCtx('-11');
    const o = await createOffer(ctx);
    const c = await devSimulateAccept(ctx, o.id, MATH);
    await afterAccept(ctx, c.id);
    expect(ctx.db.challenge(c.id)).toMatchObject({ status: 'settled', verdict: 'FAIL' });
    expect((await statsView(ctx)).challenges).toMatchObject({ total: 1, fail: 1 });
  });

  it('agent offline: no answer, then NORESPONSE once the deadline passes', async () => {
    const ctx = devCtx(null);
    const o = await createOffer(ctx);
    const c = await devSimulateAccept(ctx, o.id, MATH);
    await afterAccept(ctx, c.id);
    expect(ctx.db.challenge(c.id)).toMatchObject({ status: 'accepted', lastError: expect.stringMatching(/agent offline/) });
    provider(ctx).setBlockHeight(300_000 + 144 - 18);
    await verifierTick(ctx);
    expect(ctx.db.challenge(c.id)).toMatchObject({ status: 'settled', verdict: 'NORESPONSE' });
  });

  it('expiry with nothing settled refunds both sides', async () => {
    const ctx = devCtx(null);
    ctx.verifier = { ...ctx.verifier! }; // keep the key: timeout needs no signature anyway
    const o = await createOffer(ctx);
    const c = await devSimulateAccept(ctx, o.id, MATH);
    provider(ctx).setBlockHeight(300_000 + 144);
    await verifierTick(ctx);
    expect(ctx.db.challenge(c.id)?.status).toBe('timed_out');
  });

  it('refreshOffers notices an offer spent outside the app', async () => {
    const ctx = devCtx();
    const o = await createOffer(ctx);
    const contract = makeOfferContract(o.params, ctx.provider);
    // spend it directly (agent cancel built by hand, not via the service)
    const { buildCancel } = await import('@/lib/bch/transactions');
    const [u] = await contract.getUtxos();
    await buildCancel({ provider: ctx.provider, offer: o.params, offerContract: contract, offerUtxo: u, agentPk: ctx.agentKey!.pk, agentSig: ctx.agentKey!.template }).send();
    await refreshOffers(ctx);
    expect(ctx.db.offer(o.id)?.status).toBe('spent');
  });
});

describe('one server context per process', () => {
  it('lives on globalThis, so the verifier loop and the routes share it across Next.js bundles', async () => {
    const { getServerContext, setServerContext } = await import('@/lib/server/context');
    const ctx = buildContextFromEnv({ NETWORK: 'mocknet' });
    setServerContext(ctx);
    expect((globalThis as { __sellacalidaServerContext?: unknown }).__sellacalidaServerContext).toBe(ctx);
    expect(getServerContext()).toBe(ctx);
    setServerContext(null);
  });

  it('runtime guards are per context, not per module copy', async () => {
    const a = buildContextFromEnv({ NETWORK: 'mocknet' });
    const b = buildContextFromEnv({ NETWORK: 'mocknet' });
    a.runtime.ticking = true;
    expect(b.runtime.ticking).toBe(false);
  });
});
