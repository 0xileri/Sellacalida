// Withdraw a deployed app's funds back to your own wallet: cancel the agent's open bonds, then sweep
// the agent and fee wallet. Logic only, so it can be tested on mocknet; the command is withdraw.mts.
import { binToHex } from '@bitauth/libauth';
import { explorerTxUrl } from '../lib/bch/network';
import { buildCancel } from '../lib/bch/transactions';
import { makeOfferContract, type OfferParams } from '../lib/contracts';
import { offerParamsFromWire, type OfferView } from '../lib/wire';
import type { FlowContext, Key } from './chipnet/flows';

export interface OpenBond {
  txid: string;
  vout: number;
  params: OfferParams;
}

/** The open bonds in a site's /api/offers listing that this agent key posted. */
export function bondsOf(offers: OfferView[], agent: Key): OpenBond[] {
  return offers
    .filter((o) => o.status === 'open')
    .map((o) => ({ txid: o.txid, vout: o.vout, params: offerParamsFromWire(o.params) }))
    .filter((b) => binToHex(b.params.agentPkh) === binToHex(agent.pkh));
}

/**
 * Cancel each open bond back to the agent's own address (the agent's checkSig path). A bond that is
 * no longer at its contract (accepted by a challenger meanwhile, or already cancelled) is skipped:
 * an accepted bond is in an escrow and settles on its own. Returns the cancel txids.
 */
export async function cancelBonds(ctx: FlowContext, agent: Key, bonds: OpenBond[]): Promise<string[]> {
  const txids: string[] = [];
  for (const b of bonds) {
    const offerContract = makeOfferContract(b.params, ctx.provider);
    const live = (await offerContract.getUtxos()).find((u) => u.txid === b.txid && u.vout === b.vout);
    if (!live) {
      ctx.log(`  bond ${b.txid.slice(0, 12)}...:${b.vout} is no longer open (accepted or cancelled); skipping`);
      continue;
    }
    const txid = (
      await buildCancel({
        provider: ctx.provider, offer: b.params, offerContract, offerUtxo: live, agentPk: agent.pk, agentSig: agent.template,
      }).send()
    ).txid;
    ctx.results.push({ scenario: 'withdraw', step: 'cancel open bond', txid, url: explorerTxUrl(ctx.network, txid) });
    ctx.log(`  withdraw    cancel open bond       ${txid}`);
    txids.push(txid);
  }
  return txids;
}
