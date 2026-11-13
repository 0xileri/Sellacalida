// Transaction builders for the WizardConnect wallet spike (spec section 11 checklist). Every wallet
// input uses a CashScript placeholder unlocker; contract inputs are either fully unlocked by
// CashScript (accept, timeout) or carry placeholderSignature() / placeholderPublicKey() (cancel).
import {
  TransactionBuilder,
  placeholderP2PKHUnlocker,
  placeholderPublicKey,
  placeholderSignature,
  type NetworkProvider,
  type SpendableUtxo,
} from 'cashscript';
import { MIN_OUTPUT_SATS } from '../constants';
import { makeOfferContract, escrowArgsFor, makeEscrowContract, type ChallengeTerms, type OfferParams } from '../contracts';
import { buildAccept, buildCancel, buildTimeout, withFee, DEFAULT_FEE_RATE } from '../bch/transactions';
import { hexToBin } from '@bitauth/libauth';
import type { WalletAddress, WalletUtxo } from './wizard';

export const SPIKE_OFFER_SATS = 3000n;
export const SPIKE_ESCROW_SATS = 3000n;

export interface WalletInputRef {
  inputIndex: number;
  path: 'receive' | 'change';
  index: number;
}

export interface WalletTx {
  builder: TransactionBuilder;
  walletInputs: WalletInputRef[];
}

function addWalletInputs(b: TransactionBuilder, utxos: WalletUtxo[], startIndex: number): WalletInputRef[] {
  return utxos.map((u, i) => {
    b.addInput(u, placeholderP2PKHUnlocker(u.address));
    return { inputIndex: startIndex + i, path: u.path, index: u.index };
  });
}

/** Pick BCH-only UTXOs (largest first) until `target` sats are covered. */
export function pickBch(utxos: WalletUtxo[], target: bigint): WalletUtxo[] {
  const sorted = utxos.filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1));
  const out: WalletUtxo[] = [];
  let sum = 0n;
  for (const u of sorted) {
    if (sum >= target) break;
    out.push(u);
    sum += u.satoshis;
  }
  if (sum < target) throw new Error(`not enough BCH: have ${sum} sats, need ${target}`);
  return out;
}

/** Spike step 3 / agent flow: send `bond` tokens plus dust BCH from the wallet into a new offer (P2SH32). */
export function buildFundOffer(o: {
  provider: NetworkProvider;
  offer: OfferParams;
  walletUtxos: WalletUtxo[];
  tokenChange: WalletAddress;
  bchChange: WalletAddress;
}): WalletTx {
  const category = o.offer.tokenCategory;
  // take only as many token UTXOs as the bond needs, largest first
  const candidates = o.walletUtxos
    .filter((u) => u.token?.category === category && !u.token.nft && u.token.amount > 0n)
    .sort((a, b) => (b.token!.amount > a.token!.amount ? 1 : -1));
  const tokenIns: WalletUtxo[] = [];
  let tokenTotal = 0n;
  for (const u of candidates) {
    if (tokenTotal >= o.offer.bondAmount) break;
    tokenIns.push(u);
    tokenTotal += u.token!.amount;
  }
  if (tokenTotal < o.offer.bondAmount) throw new Error(`wallet holds ${tokenTotal} of this token, bond needs ${o.offer.bondAmount}`);
  const tokenChange = tokenTotal - o.offer.bondAmount;
  const bchIns = pickBch(o.walletUtxos, SPIKE_OFFER_SATS + 3000n);
  const all = [...tokenIns, ...bchIns];
  const inSats = all.reduce((a, u) => a + u.satoshis, 0n);
  const fixed = SPIKE_OFFER_SATS + (tokenChange > 0n ? MIN_OUTPUT_SATS : 0n);
  const offerContract = makeOfferContract(o.offer, o.provider);
  let walletInputs: WalletInputRef[] = [];
  const { builder } = withFee((fee) => {
    const b = new TransactionBuilder({ provider: o.provider });
    walletInputs = addWalletInputs(b, all, 0);
    b.addOutput({ to: hexToBin(offerContract.lockingBytecode), amount: SPIKE_OFFER_SATS, token: { category, amount: o.offer.bondAmount } });
    if (tokenChange > 0n) b.addOutput({ to: o.tokenChange.lock, amount: MIN_OUTPUT_SATS, token: { category, amount: tokenChange } });
    b.addOutput({ to: o.bchChange.lock, amount: inSats - fixed - fee });
    return b;
  }, all.length, DEFAULT_FEE_RATE);
  return { builder, walletInputs };
}

/** Spike step 5: cancel through the contract's checkSig, with the wallet filling placeholders. */
export function buildCancelWithPlaceholders(o: {
  provider: NetworkProvider;
  offer: OfferParams;
  offerUtxo: SpendableUtxo;
  agent: WalletAddress;
}): WalletTx {
  const offerContract = makeOfferContract(o.offer, o.provider);
  const builder = buildCancel({
    provider: o.provider, offer: o.offer, offerContract, offerUtxo: o.offerUtxo,
    agentPk: placeholderPublicKey(), agentSig: placeholderSignature(),
  });
  // the contract input itself needs the wallet's sig + pubkey for the agent key
  return { builder, walletInputs: [{ inputIndex: 0, path: o.agent.path, index: o.agent.index }] };
}

/**
 * Spike steps 4 + 6 / challenger flow: accept an offer. The offer input is fully unlocked by
 * CashScript and left out of inputPaths; the wallet signs only its own token (and BCH) inputs.
 */
export function buildAcceptFromWallet(o: {
  provider: NetworkProvider;
  offer: OfferParams;
  offerUtxo: SpendableUtxo;
  terms: Omit<ChallengeTerms, 'challengerPkh'>;
  challenger: WalletAddress;
  walletUtxos: WalletUtxo[];
  locktime: number;
}): WalletTx & { terms: ChallengeTerms } {
  const category = o.offer.tokenCategory;
  // input 1 must sit at P2PKH(challengerPkh); use the challenger address's own token UTXO
  const tokenUtxo = o.walletUtxos
    .filter((u) => u.address === o.challenger.address && u.token?.category === category && !u.token.nft)
    .sort((a, b) => (a.token!.amount > b.token!.amount ? 1 : -1))
    .find((u) => u.token!.amount >= o.offer.feeAmount);
  if (!tokenUtxo) throw new Error(`no UTXO at ${o.challenger.address} holds >= ${o.offer.feeAmount} of the token`);
  const terms: ChallengeTerms = { ...o.terms, challengerPkh: o.challenger.pkh };
  const escrowArgs = escrowArgsFor(o.offer, terms);
  const base = {
    provider: o.provider, offer: o.offer, offerContract: makeOfferContract(o.offer, o.provider), offerUtxo: o.offerUtxo,
    terms, escrowArgs, escrowSatoshis: SPIKE_ESCROW_SATS, locktime: o.locktime,
    challengerTokenInput: { utxo: tokenUtxo, unlocker: placeholderP2PKHUnlocker(tokenUtxo.address), placeholder: true },
  };
  try {
    const builder = buildAccept(base);
    return { builder, terms, walletInputs: [{ inputIndex: 1, path: tokenUtxo.path, index: tokenUtxo.index }] };
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('not enough BCH')) throw e;
    const bch = pickBch(o.walletUtxos.filter((u) => u !== tokenUtxo), 3000n)[0];
    const builder = buildAccept({
      ...base,
      bchFeeInput: { utxo: bch, unlocker: placeholderP2PKHUnlocker(bch.address), placeholder: true },
    });
    return {
      builder, terms,
      walletInputs: [
        { inputIndex: 1, path: tokenUtxo.path, index: tokenUtxo.index },
        { inputIndex: 2, path: bch.path, index: bch.index },
      ],
    };
  }
}

/** Native BCH feature (spec 3.3): a plain tip, change back to the sender. */
export function buildBchTip(o: {
  provider: NetworkProvider;
  walletUtxos: WalletUtxo[];
  toLockingBytecode: Uint8Array;
  amount: bigint;
  change: WalletAddress;
}): WalletTx {
  if (o.amount < 546n) throw new Error('tip must be at least 546 sats');
  const ins = pickBch(o.walletUtxos, o.amount + 2000n);
  const inSats = ins.reduce((a, u) => a + u.satoshis, 0n);
  let walletInputs: WalletInputRef[] = [];
  const { builder } = withFee((fee) => {
    const b = new TransactionBuilder({ provider: o.provider });
    walletInputs = addWalletInputs(b, ins, 0);
    b.addOutput({ to: o.toLockingBytecode, amount: o.amount });
    const change = inSats - o.amount - fee;
    if (change >= 546n) b.addOutput({ to: o.change.lock, amount: change });
    return b;
  }, ins.length, DEFAULT_FEE_RATE);
  return { builder, walletInputs };
}

/** Keyless refund once the chain reaches expiryHeight (anyone may broadcast it). */
export function buildKeylessTimeout(o: {
  provider: NetworkProvider;
  offer: OfferParams;
  terms: ChallengeTerms;
  escrowTxid: string;
  escrowVout?: number;
}): TransactionBuilder {
  const escrowArgs = escrowArgsFor(o.offer, o.terms);
  const escrowContract = makeEscrowContract(escrowArgs, o.provider);
  return buildTimeout({
    provider: o.provider, escrowContract, escrowArgs, tokenCategory: o.offer.tokenCategory,
    escrowUtxo: {
      txid: o.escrowTxid, vout: o.escrowVout ?? 0, satoshis: SPIKE_ESCROW_SATS,
      token: { category: o.offer.tokenCategory, amount: o.offer.bondAmount + o.offer.feeAmount },
      lockingBytecode: escrowContract.lockingBytecode,
    },
    locktime: Number(o.terms.expiryHeight),
  });
}
