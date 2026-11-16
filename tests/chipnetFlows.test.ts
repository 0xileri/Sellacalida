// Dry-runs the chipnet runner's flows on mocknet so script logic is covered by CI.
import { describe, expect, it } from 'vitest';
import { binToHex, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, type NetworkProvider } from 'cashscript';
import { p2pkhLockingBytecode } from '@/lib/bch/transactions';
import { PUSD_CATEGORY_MAINNET } from '@/lib/constants';
import {
  MAINNET_AMOUNTS, checkMainnetCaps, describeTx, finishPending, genesis, scenarioCancel, scenarioFail,
  scenarioPass, scenarioStartShort, seedMocknet, sweep,
  type FlowContext, type Key,
} from '../scripts/chipnet/flows';

function key(label: string): Key {
  const priv = sha256.hash(utf8ToBin(`flows:${label}`));
  const pk = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pk);
  return { label, priv, pk, pkh, lock: p2pkhLockingBytecode(pkh), template: new SignatureTemplate(priv) };
}

describe('chipnet runner flows (mocknet dry run)', () => {
  it('genesis, cancel, pass, fail, noresponse and timeout all confirm', async () => {
    const provider = new MockNetworkProvider({ validateTransactions: true, updateUtxoSet: true });
    provider.setBlockHeight(300_000);
    const agent = key('agent');
    seedMocknet(provider, agent);
    const ctx: FlowContext = {
      network: 'mocknet', provider, agent, challenger: key('challenger'), verifier: key('verifier'),
      feeWallet: key('fee'), log: () => {}, results: [],
      reachHeight: async (h) => { provider.setBlockHeight(h); return true; },
    };
    await genesis(ctx);
    await scenarioCancel(ctx);
    await scenarioPass(ctx);
    await scenarioFail(ctx);
    const nr = await scenarioStartShort(ctx, 'noresponse');
    const to = await scenarioStartShort(ctx, 'timeout');
    expect(nr.readyAt).toBe(300_001);
    expect(to.readyAt).toBe(300_019);
    expect(await finishPending(ctx, nr)).toBe(true);
    expect(await finishPending(ctx, to)).toBe(true);
    expect(ctx.results.map((r) => `${r.scenario}:${r.step}`)).toEqual([
      'genesis:mint test token',
      'cancel:fund offer (P2SH32)', 'cancel:cancel (agent checkSig)',
      'pass:fund offer (P2SH32)', 'pass:accept (exact)', 'pass:settle PASS (1-output)',
      'fail:fund offer (P2SH32)', 'fail:accept (change 35)', 'fail:settle FAIL (2-output)',
      'noresponse:fund offer (P2SH32)', 'noresponse:accept (exact)',
      'timeout:fund offer (P2SH32)', 'timeout:accept (change 5)',
      'noresponse:settle NORESPONSE (1-output)', 'timeout:timeout refund',
    ]);
  });
});

function mockCtx(over: Partial<FlowContext> = {}, seedSats = 100_000n) {
  const provider = new MockNetworkProvider({ validateTransactions: true, updateUtxoSet: true });
  provider.setBlockHeight(300_000);
  const agent = key('agent');
  seedMocknet(provider, agent, seedSats);
  const ctx: FlowContext = {
    network: 'mocknet', provider, agent, challenger: key('challenger'), verifier: key('verifier'),
    feeWallet: key('fee'), log: () => {}, results: [],
    reachHeight: async (h) => { provider.setBlockHeight(h); return true; },
    ...over,
  };
  return { ctx, provider, agent };
}

/** Give the agent PUSD-category tokens on mocknet, the way a wallet would fund it on mainnet. */
function givePusd(provider: MockNetworkProvider, agent: Key, amount: bigint) {
  provider.addUtxo(binToHex(agent.lock), {
    txid: binToHex(sha256.hash(utf8ToBin('pusd-funding'))), vout: 1, satoshis: 1000n,
    token: { category: PUSD_CATEGORY_MAINNET, amount },
  });
}

describe('capped mainnet mode (dry run on mocknet)', () => {
  it('every scenario works with cent-sized PUSD bonds, and a sweep empties the throwaway keys', async () => {
    const { ctx, provider, agent } = mockCtx({ amounts: MAINNET_AMOUNTS, category: PUSD_CATEGORY_MAINNET });
    givePusd(provider, agent, 35n);
    await scenarioCancel(ctx);
    await scenarioPass(ctx);
    await scenarioFail(ctx);
    const nr = await scenarioStartShort(ctx, 'noresponse');
    const to = await scenarioStartShort(ctx, 'timeout');
    expect(await finishPending(ctx, nr)).toBe(true);
    expect(await finishPending(ctx, to)).toBe(true);
    expect(ctx.results.map((r) => r.step)).toContain('accept (change 2)');
    expect(ctx.results.map((r) => r.step)).toContain('accept (change 1)');

    const mine = key('my-wallet');
    const before = async (k: Key) => (await provider.getUtxosForLockingBytecode(k.lock));
    const tokensHeld = async (k: Key) => (await before(k)).reduce((a, u) => a + (u.token?.amount ?? 0n), 0n);
    const totalTokens = (await tokensHeld(agent)) + (await tokensHeld(ctx.challenger)) + (await tokensHeld(ctx.feeWallet));
    expect(totalTokens).toBe(35n); // nothing lost: every bond and fee came back to one of the three keys

    expect(await sweep(ctx, [agent, ctx.challenger, ctx.feeWallet], mine.lock)).toMatch(/^[0-9a-f]{64}$/);
    for (const k of [agent, ctx.challenger, ctx.feeWallet]) expect(await before(k)).toHaveLength(0);
    const got = await before(mine);
    expect(got.reduce((a, u) => a + (u.token?.amount ?? 0n), 0n)).toBe(35n);
    expect(got.find((u) => !u.token)!.satoshis).toBeGreaterThan(50_000n);
    expect(await sweep(ctx, [agent], mine.lock)).toBeNull();
  });

  it('never mints a token on mainnet and refuses bonds above the cap', async () => {
    const { ctx } = mockCtx({ network: 'mainnet', category: PUSD_CATEGORY_MAINNET });
    await expect(genesis(ctx)).rejects.toThrow(/PUSD only/);
    ctx.amounts = { ...MAINNET_AMOUNTS, bond: 100n };
    await expect(scenarioCancel(ctx)).rejects.toThrow(/capped/);
  });

  it('refuses to spend from an agent hot wallet above the caps', async () => {
    const small = mockCtx({ category: PUSD_CATEGORY_MAINNET }, 40_000n);
    givePusd(small.provider, small.agent, 35n);
    await expect(checkMainnetCaps(small.ctx)).resolves.toEqual({ sats: 41_000n, tokens: 35n });
    const big = mockCtx({ category: PUSD_CATEGORY_MAINNET }, 300_000n);
    await expect(checkMainnetCaps(big.ctx)).rejects.toThrow(/over the mainnet runner caps/);
    const rich = mockCtx({ category: PUSD_CATEGORY_MAINNET }, 40_000n);
    givePusd(rich.provider, rich.agent, 5_000n);
    await expect(checkMainnetCaps(rich.ctx)).rejects.toThrow(/sweep/);
  });

  it('the broadcast summary names PUSD in explorer byte order and every output address', async () => {
    const { ctx, provider, agent } = mockCtx({ amounts: MAINNET_AMOUNTS, category: PUSD_CATEGORY_MAINNET });
    givePusd(provider, agent, 35n);
    const sent: string[] = [];
    ctx.provider = new Proxy(provider, {
      get(t, prop, r) {
        if (prop === 'sendRawTransaction') return async (hex: string) => { sent.push(hex); return t.sendRawTransaction(hex); };
        const v = Reflect.get(t, prop, r);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    }) as NetworkProvider;
    await scenarioPass(ctx);
    expect(sent).toHaveLength(3); // fund, accept, settle
    const fundSummary = describeTx(sent[0], 'mainnet');
    expect(fundSummary).toMatch(/out 0: 3000 sats \+ 5 PUSD base units -> bitcoincash:p/); // the offer covenant (P2SH32)
    expect(fundSummary).toMatch(/\+ 1 PUSD base units -> bitcoincash:q/); // challenger's fee
    const settleSummary = describeTx(sent[2], 'mainnet');
    expect(settleSummary).toMatch(/out 0: \d+ sats \+ 6 PUSD base units -> bitcoincash:q/); // bond + fee to the agent
    expect(describeTx('00', 'mainnet')).toMatch(/could not decode/);
  });
});
