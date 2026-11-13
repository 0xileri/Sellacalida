// Browser: turn a prepared accept bundle into a signed, broadcast accept transaction.
// The offer input is fully unlocked by CashScript; the wallet signs only its own inputs.
import { binToHex } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { SellacalidaNetwork } from '../constants';
import { makeOfferContract } from '../contracts';
import { addressToLockingBytecode } from '../bch/address';
import { makeProvider } from '../bch/network';
import { offerParamsFromWire, termsFromWire, type AcceptBundle } from '../wire';
import { buildAcceptFromWallet, buildBchTip } from './spikeFlows';
import { deriveAddresses, fetchWalletUtxos, signWithWallet } from './wizard';

export type Step = 'loading wallet' | 'building' | 'waiting for wallet signature' | 'broadcasting';

export async function walletReceiveAddress(manager: DappConnectionManager, network: SellacalidaNetwork) {
  const r0 = deriveAddresses(manager, network, { receive: 1, change: 0 })[0];
  if (!r0) throw new Error('wallet has not shared its receive path yet; try again in a moment');
  return r0;
}

export async function signAndBroadcastAccept(o: {
  manager: DappConnectionManager;
  network: SellacalidaNetwork;
  bundle: AcceptBundle;
  onStep?: (s: Step) => void;
}): Promise<string> {
  const provider = makeProvider(o.network);
  o.onStep?.('loading wallet');
  const addresses = deriveAddresses(o.manager, o.network);
  const utxos = await fetchWalletUtxos(provider, addresses);
  const challenger = addresses.find((a) => a.path === 'receive' && a.index === 0);
  if (!challenger) throw new Error('wallet has not shared its receive path');

  o.onStep?.('building');
  const offer = offerParamsFromWire(o.bundle.offer.params);
  const terms = termsFromWire(o.bundle.terms);
  if (binToHex(challenger.pkh) !== binToHex(terms.challengerPkh)) throw new Error('this wallet is not the challenger the server prepared');
  const contract = makeOfferContract(offer, provider);
  const tx = buildAcceptFromWallet({
    provider, offer, challenger, walletUtxos: utxos, locktime: o.bundle.locktime,
    escrowSatoshis: BigInt(o.bundle.escrowSatoshis),
    terms: { challengeId: terms.challengeId, specHash: terms.specHash, expiryHeight: terms.expiryHeight },
    offerUtxo: {
      txid: o.bundle.offer.txid, vout: o.bundle.offer.vout, satoshis: BigInt(o.bundle.offer.satoshis),
      lockingBytecode: contract.lockingBytecode, token: { category: offer.tokenCategory, amount: offer.bondAmount },
    },
  });

  o.onStep?.('waiting for wallet signature');
  const signed = await signWithWallet(o.manager, tx.builder, tx.walletInputs, 'Accept a Sellacalida challenge: lock your fee with the agent bond');
  o.onStep?.('broadcasting');
  return provider.sendRawTransaction(signed.signedTransaction);
}

export async function signAndBroadcastTip(o: {
  manager: DappConnectionManager;
  network: SellacalidaNetwork;
  to: string;
  sats: bigint;
}): Promise<string> {
  const provider = makeProvider(o.network);
  const addresses = deriveAddresses(o.manager, o.network);
  const utxos = await fetchWalletUtxos(provider, addresses);
  const change = addresses.find((a) => a.path === 'change' && a.index === 0) ?? addresses[0];
  const tx = buildBchTip({ provider, walletUtxos: utxos, toLockingBytecode: addressToLockingBytecode(o.to), amount: o.sats, change });
  const signed = await signWithWallet(o.manager, tx.builder, tx.walletInputs, `Tip ${o.sats} sats to a Sellacalida agent`);
  return provider.sendRawTransaction(signed.signedTransaction);
}
