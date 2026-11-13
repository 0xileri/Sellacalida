// Dry-runs the chipnet runner's flows on mocknet so script logic is covered by CI.
import { describe, expect, it } from 'vitest';
import { hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate } from 'cashscript';
import { p2pkhLockingBytecode } from '@/lib/bch/transactions';
import {
  finishPending, genesis, scenarioCancel, scenarioFail, scenarioPass, scenarioStartShort, seedMocknet,
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
