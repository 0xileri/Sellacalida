// Route handlers called directly with Web Requests against a mocknet server context.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContextFromEnv, setServerContext, type ServerContext } from '@/lib/server/context';
import type { LlmClient } from '@/lib/agent/llm';
import { GET as getConfig } from '@/app/api/config/route';
import { GET as getStats } from '@/app/api/stats/route';
import { GET as getOffers } from '@/app/api/offers/route';
import { GET as listChallenges, POST as prepare } from '@/app/api/challenges/route';
import { GET as getChallenge } from '@/app/api/challenges/[id]/route';
import { POST as accepted } from '@/app/api/challenges/[id]/accepted/route';
import { GET as getEvidence } from '@/app/api/challenges/[id]/evidence/route';
import { GET as getAgent } from '@/app/api/agents/[id]/route';
import { POST as adminOffer } from '@/app/api/admin/offers/route';
import { POST as devChallenge } from '@/app/api/admin/dev/challenge/route';
import { resetPublicDevLimit } from '@/lib/server/devLimit';
import { loadConfig } from '@/lib/server/config';
import { PREPARE_LIMIT, resetRateLimits, takeRateSlot } from '@/lib/server/rateLimit';
import { buildAccept } from '@/lib/bch/transactions';
import { escrowArgsFor, makeOfferContract } from '@/lib/contracts';
import nextConfig from '@/next.config';

const MATH = { templateId: 'math.exact_result', version: 1, network: 'mocknet', params: { op: 'add', left: '40', right: '2' } };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://test/api', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function ctxWith(answer: string, env: Record<string, string> = {}): ServerContext {
  const ctx = buildContextFromEnv({ NETWORK: 'mocknet', ...env });
  const client: LlmClient = {
    complete: vi.fn(async () => ({ content: answer, toolCalls: [], finishReason: 'stop', servedModel: 'anthropic/claude-sonnet-5.5', generationId: 'g', usage: null })),
  };
  ctx.llm = { client, model: 'anthropic/claude-sonnet-5.5' };
  setServerContext(ctx);
  return ctx;
}

afterEach(() => {
  setServerContext(null);
  resetRateLimits();
});

describe('public routes', () => {
  it('/api/config exposes network and token info only', async () => {
    ctxWith('42');
    const body = await (await getConfig()).json();
    expect(body).toMatchObject({ network: 'mocknet', tokenDecimals: 2 });
    expect(JSON.stringify(body)).not.toMatch(/wif|private|token":"[a-z]/i);
  });

  it('full flow over HTTP: publish offer, dev accept, agent answers, verifier settles, evidence downloads', async () => {
    const ctx = ctxWith('42');
    const offer = await (await adminOffer(post({}))).json();
    expect(offer.status).toBe('open');
    expect((await (await getOffers()).json()).open).toHaveLength(1);

    const settled = await (await devChallenge(post({ offerId: offer.id, spec: MATH }))).json();
    expect(settled).toMatchObject({ status: 'settled', verdict: 'PASS', answer: { canonicalAnswer: '42', source: 'ai' } });

    const detail = await (await getChallenge(new Request('http://t'), params(settled.id))).json();
    expect(detail.prompt).toContain('(40 + 2)');
    expect((await (await listChallenges()).json()).challenges).toHaveLength(1);
    expect((await (await getStats()).json()).challenges).toMatchObject({ total: 1, pass: 1 });
    expect((await (await getAgent(new Request('http://t'), params(ctx.config.agent.id))).json()).record.pass).toBe(1);

    const ev = await getEvidence(new Request('http://t'), params(settled.id));
    expect(ev.headers.get('content-disposition')).toMatch(/attachment/);
    expect((await ev.json()).verdict).toBe('PASS');
  });

  it('prepare validates input and returns 400 with a readable error', async () => {
    ctxWith('42');
    const offer = await (await adminOffer(post({}))).json();
    const res = await prepare(post({ offerId: offer.id, spec: { ...MATH, params: { op: 'div', left: '1', right: '0' } }, challengerAddress: 'bchreg:qq' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/division or modulo by zero/);
    expect((await prepare(post({ spec: MATH }))).status).toBe(400);
  });

  it('accepted with a bogus txid is refused and nothing changes', async () => {
    const ctx = ctxWith('42');
    const offer = await (await adminOffer(post({}))).json();
    const prep = await (await prepare(post({ offerId: offer.id, spec: MATH, challengerAddress: ctx.devChallenger!.address }))).json();
    const res = await accepted(post({ txid: 'ab'.repeat(32) }), params(prep.challenge.id));
    expect(res.status).toBe(404);
    expect(ctx.db.challenge(prep.challenge.id)?.status).toBe('awaiting_accept');
  });

  it('unknown ids are 404s', async () => {
    ctxWith('42');
    expect((await getChallenge(new Request('http://t'), params('nope'))).status).toBe(404);
    expect((await getAgent(new Request('http://t'), params('nope'))).status).toBe(404);
  });
});

describe('every API route is request-time', () => {
  it('each route handler goes through handle(), which calls connection() so nothing is prerendered', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f === 'route.ts') files.push(p);
      }
    };
    walk(join(process.cwd(), 'app/api'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const handlers = src.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      const wrapped = src.match(/return handle\(/g) ?? [];
      expect({ file: f, wrapped: wrapped.length }).toEqual({ file: f, wrapped: handlers.length });
    }
    expect(readFileSync(join(process.cwd(), 'lib/server/http.ts'), 'utf8')).toContain('await connection()');
  });
});

describe('public play challenges on a mocknet preview', () => {
  it('open to anyone, one at a time, capped per process; admin-only when not enabled', async () => {
    resetPublicDevLimit();
    const ctx = ctxWith('42', { ADMIN_TOKEN: 'secret-token', MOCKNET_PUBLIC_CHALLENGES: '1', MOCKNET_CHALLENGE_CAP: '2' });
    const auth = { authorization: 'Bearer secret-token' };
    const offers = [await (await adminOffer(post({}, auth))).json(), await (await adminOffer(post({}, auth))).json(), await (await adminOffer(post({}, auth))).json()];

    const first = await devChallenge(post({ offerId: offers[0].id, spec: MATH }));
    expect(first.status).toBe(201);
    const tooSoon = await devChallenge(post({ offerId: offers[1].id, spec: MATH }));
    expect(tooSoon.status).toBe(429);
    expect((await tooSoon.json()).error).toMatch(/one play challenge at a time/);

    ctx.config = { ...ctx.config, publicDevChallenges: { ...ctx.config.publicDevChallenges, minIntervalMs: 0 } };
    expect((await devChallenge(post({ offerId: offers[1].id, spec: MATH }))).status).toBe(201);
    const capped = await devChallenge(post({ offerId: offers[2].id, spec: MATH }));
    expect(capped.status).toBe(429);
    expect((await capped.json()).error).toMatch(/used up/);

    ctx.config = { ...ctx.config, publicDevChallenges: { ...ctx.config.publicDevChallenges, enabled: false } };
    expect((await devChallenge(post({ offerId: offers[2].id, spec: MATH }))).status).toBe(401);
  });

  it('can never be enabled off mocknet', () => {
    const ctx = buildContextFromEnv({ NETWORK: 'mocknet', MOCKNET_PUBLIC_CHALLENGES: '1' });
    expect(ctx.config.publicDevChallenges.enabled).toBe(true);
    expect(loadConfig({ NETWORK: 'chipnet', TOKEN_CATEGORY: 'ab'.repeat(32), MOCKNET_PUBLIC_CHALLENGES: '1' }).publicDevChallenges.enabled).toBe(false);
  });
});

describe('admin routes', () => {
  it('need the bearer token when ADMIN_TOKEN is set', async () => {
    ctxWith('42', { ADMIN_TOKEN: 'secret-token' });
    expect((await adminOffer(post({}))).status).toBe(401);
    expect((await adminOffer(post({}, { authorization: 'Bearer wrong-token!' }))).status).toBe(401);
    expect((await adminOffer(post({}, { authorization: 'Bearer secret-token' }))).status).toBe(201);
  });

  it('are disabled off mocknet without a token', async () => {
    const ctx = ctxWith('42');
    ctx.config = { ...ctx.config, network: 'chipnet' };
    expect((await adminOffer(post({}))).status).toBe(403);
  });

  it('offer overrides are validated and applied', async () => {
    ctxWith('42');
    expect((await adminOffer(post({ bond: 'lots' }))).status).toBe(400);
    const o = await (await adminOffer(post({ bond: '250', fee: '30' }))).json();
    expect(o.params).toMatchObject({ bondAmount: '250', feeAmount: '30', maxDeadlineDelta: '144' });
  });
});

describe('abuse limits and response headers', () => {
  it('prepare is limited per client; a client-supplied earlier X-Forwarded-For hop does not get around it', async () => {
    ctxWith('42');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const from = (xff: string) => ({ 'x-forwarded-for': xff });
    for (let i = 0; i < PREPARE_LIMIT.limit; i++) expect((await prepare(post({}, from('203.0.113.7')))).status).toBe(400);
    const refused = await prepare(post({}, from('203.0.113.7')));
    expect(refused.status).toBe(429);
    expect((await refused.json()).error).toMatch(/too many requests from this address; try again in \d+ s/);
    expect((await prepare(post({}, from('1.2.3.4, 203.0.113.7')))).status).toBe(429); // the proxy's hop is last
    expect((await prepare(post({}, from('198.51.100.9')))).status).toBe(400); // other clients are unaffected
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/prepare rate-limited \(x-forwarded-for hops: 2\)/));
    warn.mockRestore();
  });

  it('the window slides', () => {
    const o = { limit: 2, windowMs: 1000 };
    expect(takeRateSlot('t', 'a', o, 0)).toBeNull();
    expect(takeRateSlot('t', 'a', o, 10)).toBeNull();
    expect(takeRateSlot('t', 'a', o, 20)).toMatch(/try again in 1 s/);
    expect(takeRateSlot('t', 'b', o, 20)).toBeNull();
    expect(takeRateSlot('t', 'a', o, 1001)).toBeNull();
  });

  it('every path gets the security headers, and no x-powered-by', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    expect(Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))).toMatchObject({
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Strict-Transport-Security': expect.stringMatching(/^max-age=\d+/),
    });
  });
});

describe('late accepts', () => {
  it('an accept broadcast after the server marked its prepare abandoned is still recorded, so the escrow settles', async () => {
    const ctx = ctxWith('42');
    const offer = await (await adminOffer(post({}))).json();
    const ch = ctx.devChallenger!;
    const prep = await (await prepare(post({ offerId: offer.id, spec: MATH, challengerAddress: ch.address }))).json();
    ctx.db.updateChallenge(prep.challenge.id, { status: 'abandoned' }); // what the hourly sweep does

    const o = ctx.db.offer(offer.id)!;
    const c = ctx.db.challenge(prep.challenge.id)!;
    const contract = makeOfferContract(o.params, ctx.provider);
    const utxos = await ctx.provider.getUtxosForLockingBytecode(ch.lock);
    const tokenUtxo = utxos.find((u) => u.token?.category === o.params.tokenCategory && u.token.amount >= o.params.feeAmount)!;
    const bch = utxos.filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
    const { txid } = await buildAccept({
      provider: ctx.provider, offer: o.params, offerContract: contract,
      offerUtxo: {
        txid: o.txid, vout: o.vout, satoshis: o.satoshis, lockingBytecode: contract.lockingBytecode,
        token: { category: o.params.tokenCategory, amount: o.params.bondAmount },
      },
      terms: c.terms, escrowArgs: escrowArgsFor(o.params, c.terms),
      challengerTokenInput: { utxo: tokenUtxo, unlocker: ch.template.unlockP2PKH() },
      bchFeeInput: { utxo: bch, unlocker: ch.template.unlockP2PKH() },
      escrowSatoshis: c.escrowSatoshis, locktime: c.locktime,
    }).send();

    const res = await accepted(post({ txid }), params(c.id));
    expect(res.status).toBe(200);
    expect(ctx.db.challenge(c.id)).toMatchObject({ acceptTxid: txid, lastError: null });
    expect(ctx.db.challenge(c.id)?.status).not.toBe('abandoned');
    expect(ctx.db.offer(offer.id)?.status).toBe('accepted');
  });

  it('but an abandoned prepare cannot claim the accept of the challenger who went first', async () => {
    const ctx = ctxWith('42');
    const offer = await (await adminOffer(post({}))).json();
    const loser = await (await prepare(post({ offerId: offer.id, spec: MATH, challengerAddress: ctx.devChallenger!.address }))).json();
    const winner = await (await devChallenge(post({ offerId: offer.id, spec: MATH }))).json();
    expect(ctx.db.challenge(loser.challenge.id)?.status).toBe('abandoned');

    const res = await accepted(post({ txid: winner.acceptTxid }), params(loser.challenge.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not the escrow for this challenge/);
    expect(ctx.db.challenge(loser.challenge.id)).toMatchObject({ status: 'abandoned', acceptTxid: null });
  });
});
