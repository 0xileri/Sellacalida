// Dry-runs the chipnet runner's flows on mocknet so script logic is covered by CI.
import { describe, expect, it, vi } from 'vitest';
import { binToHex, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, type NetworkProvider } from 'cashscript';
import { p2pkhLockingBytecode } from '@/lib/bch/transactions';
import { PUSD_CATEGORY_MAINNET } from '@/lib/constants';
import {
  MAINNET_AMOUNTS, checkMainnetCaps, confirmingProvider, describeTx, finishPending, genesis, parseSweepDestination,
  reclaimOffers, waitForHeight, scenarioCancel, scenarioFail, scenarioPass, scenarioStartShort, seedMocknet, sweep,
  type FlowContext, type Key,
} from '../scripts/chipnet/flows';
import { encodeCashAddress } from '@bitauth/libauth';

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

    expect(await sweep(ctx, [agent, ctx.challenger, ctx.feeWallet], { lock: mine.lock, tokenAware: true })).toMatch(/^[0-9a-f]{64}$/);
    for (const k of [agent, ctx.challenger, ctx.feeWallet]) expect(await before(k)).toHaveLength(0);
    const got = await before(mine);
    expect(got.reduce((a, u) => a + (u.token?.amount ?? 0n), 0n)).toBe(35n);
    expect(got.find((u) => !u.token)!.satoshis).toBeGreaterThan(50_000n);
    expect(await sweep(ctx, [agent], { lock: mine.lock, tokenAware: true })).toBeNull();
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
    // the agent funded on 17 Nov held 501,000 sats: inside the cap
    const real = mockCtx({ category: PUSD_CATEGORY_MAINNET }, 500_000n);
    givePusd(real.provider, real.agent, 100n);
    await expect(checkMainnetCaps(real.ctx)).resolves.toEqual({ sats: 501_000n, tokens: 100n });
    const big = mockCtx({ category: PUSD_CATEGORY_MAINNET }, 1_000_001n); // the cap allows exactly 1,000,000
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

describe('mainnet runner: confirm before every broadcast', () => {
  it('a "no" broadcasts nothing and changes nothing on chain', async () => {
    const { ctx, provider, agent } = mockCtx({ amounts: MAINNET_AMOUNTS, category: PUSD_CATEGORY_MAINNET });
    givePusd(provider, agent, 35n);
    const before = await provider.getUtxosForLockingBytecode(agent.lock);
    const send = vi.spyOn(provider, 'sendRawTransaction');
    const shown: string[] = [];
    ctx.provider = confirmingProvider(provider, 'mainnet', async () => false, (l) => shown.push(l));
    await expect(scenarioPass(ctx)).rejects.toThrow(/broadcast declined; nothing was sent/);
    expect(send).not.toHaveBeenCalled();
    expect(await provider.getUtxosForLockingBytecode(agent.lock)).toEqual(before);
    expect(shown[0]).toMatch(/About to broadcast on MAINNET/);
    expect(shown[0]).toMatch(/\+ 5 PUSD base units -> bitcoincash:p/); // the bond going into the offer covenant
  });

  it('every transaction of a scenario asks once, and only a "y" sends it', async () => {
    const { ctx, provider, agent } = mockCtx({ amounts: MAINNET_AMOUNTS, category: PUSD_CATEGORY_MAINNET });
    givePusd(provider, agent, 35n);
    const send = vi.spyOn(provider, 'sendRawTransaction');
    const ask = vi.fn(async () => true);
    ctx.provider = confirmingProvider(provider, 'mainnet', ask, () => {});
    await scenarioPass(ctx); // fund, accept, settle
    expect(ask).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(ask.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);

    // the second scenario: approve the fund tx, refuse the accept. Only the fund tx goes out.
    let n = 0;
    ctx.provider = confirmingProvider(provider, 'mainnet', async () => n++ === 0, () => {});
    await expect(scenarioCancel(ctx)).rejects.toThrow(/broadcast declined/);
    expect(send).toHaveBeenCalledTimes(4); // 3 from the pass scenario + the approved fund tx
    expect(n).toBe(2);
  });

  it('reads and heights pass straight through without a prompt', async () => {
    const { provider } = mockCtx();
    const ask = vi.fn(async () => false);
    const wrapped = confirmingProvider(provider, 'mainnet', ask, () => {});
    expect(await wrapped.getBlockHeight()).toBe(300_000);
    expect(wrapped.network).toBe(provider.network);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('mainnet runner: sweep destination', () => {
  const own = [key('agent'), key('challenger'), key('fee'), key('verifier')];
  const addr = (prefix: 'bitcoincash' | 'bchtest', type: 'p2pkh' | 'p2pkhWithTokens', k = key('my-wallet')) =>
    encodeCashAddress({ prefix, type, payload: k.pkh }).address;

  it('accepts your own address on the right network and notes whether it is token-aware', () => {
    expect(parseSweepDestination(addr('bitcoincash', 'p2pkhWithTokens'), 'mainnet', own)).toMatchObject({ tokenAware: true });
    expect(parseSweepDestination(addr('bitcoincash', 'p2pkh'), 'mainnet', own)).toMatchObject({ tokenAware: false });
    const bare = addr('bitcoincash', 'p2pkhWithTokens').split(':')[1];
    expect(parseSweepDestination(bare, 'mainnet', own).lock).toEqual(key('my-wallet').lock);
  });

  it('refuses another network, a bad checksum, or one of the runner\'s own throwaway keys', () => {
    expect(() => parseSweepDestination(addr('bchtest', 'p2pkhWithTokens'), 'mainnet', own)).toThrow(/is not a mainnet address/);
    const good = addr('bitcoincash', 'p2pkhWithTokens');
    const broken = good.slice(0, -1) + (good.endsWith('q') ? 'p' : 'q');
    expect(() => parseSweepDestination(broken, 'mainnet', own)).toThrow(/not a CashAddress/);
    for (const k of own) {
      expect(() => parseSweepDestination(addr('bitcoincash', 'p2pkhWithTokens', k), 'mainnet', own)).toThrow(/own throwaway keys/);
    }
  });

  it('tokens only go to a token-aware address (a wallet without CashTokens support could burn them)', async () => {
    const { ctx, provider, agent } = mockCtx({ category: PUSD_CATEGORY_MAINNET });
    givePusd(provider, agent, 35n);
    const mine = key('my-wallet');
    await expect(sweep(ctx, [agent], { lock: mine.lock, tokenAware: false })).rejects.toThrow(/token-aware address/);
    expect(await provider.getUtxosForLockingBytecode(mine.lock)).toHaveLength(0);
    expect(await sweep(ctx, [agent], { lock: mine.lock, tokenAware: true })).toMatch(/^[0-9a-f]{64}$/);

    // BCH alone may go to a plain address
    const bchOnly = mockCtx();
    expect(await sweep(bchOnly.ctx, [bchOnly.agent], { lock: mine.lock, tokenAware: false })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('mainnet runner: reclaim a bond left behind by a stopped run', () => {
  it('a run stopped after "fund offer" leaves the bond in the offer; reclaim cancels it back to the agent', async () => {
    const { ctx, provider, agent } = mockCtx({ amounts: MAINNET_AMOUNTS, category: PUSD_CATEGORY_MAINNET });
    givePusd(provider, agent, 100n);
    const agentTokens = async () =>
      (await provider.getUtxosForLockingBytecode(agent.lock)).reduce((a, u) => a + (u.token?.amount ?? 0n), 0n);

    // what happened on 17 Nov: "pass" broadcast its fund tx, then stopped before the accept
    let n = 0;
    ctx.provider = confirmingProvider(provider, 'mainnet', async () => n++ === 0, () => {});
    await expect(scenarioPass(ctx)).rejects.toThrow(/broadcast declined/);
    // and the same for a short-window offer (noresponse / timeout)
    n = 0;
    await expect(scenarioStartShort(ctx, 'timeout')).rejects.toThrow(/broadcast declined/);
    expect(await agentTokens()).toBe(100n - 6n - 7n); // two bonds stuck in offers, two fees at the challenger

    ctx.provider = provider;
    const txids = await reclaimOffers(ctx);
    expect(txids).toHaveLength(2);
    expect(await agentTokens()).toBe(100n - 1n - 2n); // both bonds back; the challenger's tokens come back with sweep
    expect(ctx.results.filter((r) => r.scenario === 'reclaim').map((r) => r.step)).toEqual([
      'cancel a leftover offer', 'cancel a leftover offer',
    ]);
    expect(await reclaimOffers(ctx)).toEqual([]); // nothing left
  });
});

describe('mainnet runner: waiting for a block height', () => {
  const heights = (...seq: (number | Error)[]) => {
    let i = 0;
    return vi.fn(async () => {
      const v = seq[Math.min(i++, seq.length - 1)];
      if (v instanceof Error) throw v;
      return v;
    });
  };
  const noSleep = vi.fn(async () => {});

  it('survives a dropped Electrum connection one block short (19 Nov) and prints each height once', async () => {
    const drop = new Error('Failed to establish connection: WebSocket: 1006: .');
    const get = heights(978017, 978017, 978021, drop, drop, 978021, 978022);
    const log: string[] = [];
    await expect(waitForHeight(get, 978022, { wait: true, log: (l) => log.push(l), sleep: noSleep })).resolves.toBe(true);
    expect(log).toEqual([
      '  height 978017, waiting for 978022 (5 more blocks)...',
      '  height 978021, waiting for 978022 (1 more block)...',
      '  connection to the Electrum server dropped (Failed to establish connection: WebSocket: 1006: .); retrying in a minute (1/10)',
      '  connection to the Electrum server dropped (Failed to establish connection: WebSocket: 1006: .); retrying in a minute (2/10)',
    ]);
  });

  it('gives up after too many failures in a row, and never retries without --wait', async () => {
    const drop = new Error('down');
    await expect(waitForHeight(heights(drop), 10, { wait: true, log: () => {}, sleep: noSleep, maxFailures: 3 })).rejects.toThrow('down');
    await expect(waitForHeight(heights(drop), 10, { wait: false, log: () => {}, sleep: noSleep })).rejects.toThrow('down');
    const log: string[] = [];
    await expect(waitForHeight(heights(5), 10, { wait: false, log: (l) => log.push(l), sleep: noSleep })).resolves.toBe(false);
    expect(log).toEqual(['  height 5 < 10: run "pending" again later (or add --wait)']);
    await expect(waitForHeight(heights(10), 10, { wait: false, log: () => {}, sleep: noSleep })).resolves.toBe(true);
  });
});
