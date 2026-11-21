// npm run withdraw: cancel a deployed agent's open bonds and sweep its funds back, run against the
// real server code on mocknet.
import { describe, expect, it } from 'vitest';
import { hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import { SignatureTemplate } from 'cashscript';
import { buildContextFromEnv } from '@/lib/server/context';
import { createOffer, devSimulateAccept, offerView } from '@/lib/server/service';
import { makeOfferContract } from '@/lib/contracts';
import { p2pkhLockingBytecode } from '@/lib/bch/transactions';
import type { ChallengeSpec } from '@/lib/templates/public';
import { sweep, type FlowContext, type Key } from '../scripts/chipnet/flows';
import { bondsOf, cancelBonds } from '../scripts/appWithdraw';

const MATH: ChallengeSpec = { templateId: 'math.exact_result', version: 1, network: 'mocknet', params: { op: 'add', left: '40', right: '2' } };

function key(label: string, priv: Uint8Array): Key {
  const pk = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const pkh = hash160(pk);
  return { label, priv, pk, pkh, lock: p2pkhLockingBytecode(pkh), template: new SignatureTemplate(priv) };
}

function setup() {
  const app = buildContextFromEnv({ NETWORK: 'mocknet' });
  const agent = key('AGENT_WIF', app.agentKey!.priv);
  const ctx: FlowContext = {
    network: 'mocknet', provider: app.provider, agent, challenger: agent, verifier: agent, feeWallet: agent,
    log: () => {}, results: [], reachHeight: async () => true,
  };
  return { app, agent, ctx };
}

describe('npm run withdraw', () => {
  it('cancels the agent\'s open bonds back to it, then sweeps everything to your wallet', async () => {
    const { app, agent, ctx } = setup();
    const offer = await createOffer(app);
    const bonds = bondsOf([offerView(app, offer)], agent);
    expect(bonds).toHaveLength(1);

    expect(await cancelBonds(ctx, agent, bonds)).toHaveLength(1);
    expect(await makeOfferContract(bonds[0].params, app.provider).getUtxos()).toHaveLength(0);

    const mine = key('my-wallet', sha256.hash(utf8ToBin('withdraw:mine')));
    const before = await app.provider.getUtxosForLockingBytecode(agent.lock);
    const tokens = before.reduce((a, u) => a + (u.token?.amount ?? 0n), 0n);
    expect(await sweep(ctx, [agent], { lock: mine.lock, tokenAware: true })).toMatch(/^[0-9a-f]{64}$/);
    expect(await app.provider.getUtxosForLockingBytecode(agent.lock)).toHaveLength(0);
    const got = await app.provider.getUtxosForLockingBytecode(mine.lock);
    expect(got.reduce((a, u) => a + (u.token?.amount ?? 0n), 0n)).toBe(tokens); // every token, including the cancelled bond
    expect(ctx.results.map((r) => r.step)).toEqual(['cancel open bond', 'sweep to your wallet']);
  });

  it('skips a bond a challenger accepted meanwhile (it settles on its own) and bonds of other agents', async () => {
    const { app, agent, ctx } = setup();
    const taken = await createOffer(app);
    const listing = [offerView(app, taken)]; // the listing was read while it was still open
    await devSimulateAccept(app, taken.id, MATH);
    const stranger = key('other', sha256.hash(utf8ToBin('withdraw:other')));
    const theirs = { ...listing[0], params: { ...listing[0].params, agentPkh: Buffer.from(stranger.pkh).toString('hex') } };

    const bonds = bondsOf([...listing, theirs, { ...listing[0], status: 'cancelled' as const }], agent);
    expect(bonds).toHaveLength(1); // only this agent's open one
    const logs: string[] = [];
    expect(await cancelBonds({ ...ctx, log: (l) => logs.push(l) }, agent, bonds)).toEqual([]);
    expect(logs.join('\n')).toMatch(/no longer open \(accepted or cancelled\); skipping/);
  });
});
