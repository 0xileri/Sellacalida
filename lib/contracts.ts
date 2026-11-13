// Contract factories and parameter types shared by tests, scripts, the app and the verifier.
// Amounts are bigint base units everywhere. Categories are explorer-order hex at the edges and
// converted to VM order only when they become contract arguments.
import { Contract, type NetworkProvider } from 'cashscript';
import offerArtifact from '../contracts/artifacts/SellacalidaOffer.json';
import escrowArtifact from '../contracts/artifacts/SellacalidaEscrow.json';
import { MAX_HEIGHT, MIN_VERIFIER_GRACE, NETWORK_IDS, type SellacalidaNetwork } from './constants';
import { escrowBody, escrowSdkArgs, type EscrowArgs } from './encodeRedeemScript';
import { toContractCategory } from './tokenCategory';

export { offerArtifact, escrowArtifact };

export interface OfferParams {
  agentPkh: Uint8Array;
  verifierPk: Uint8Array;
  bondAmount: bigint;
  feeAmount: bigint;
  /** explorer-order hex, fungible category */
  tokenCategory: string;
  network: SellacalidaNetwork;
  maxDeadlineDelta: bigint;
  verifierGraceBlocks: bigint;
}

export interface ChallengeTerms {
  challengerPkh: Uint8Array;
  challengeId: Uint8Array; // 32
  specHash: Uint8Array; // 32
  expiryHeight: bigint;
}

export function networkIdByte(network: SellacalidaNetwork): Uint8Array {
  return Uint8Array.of(NETWORK_IDS[network]);
}

/** App-side sanity checks. The covenant enforces the critical ones on-chain regardless. */
export function validateOfferParams(p: OfferParams): void {
  if (p.agentPkh.length !== 20) throw new Error('agentPkh must be 20 bytes');
  if (p.verifierPk.length !== 33) throw new Error('verifierPk must be a 33-byte compressed pubkey');
  if (p.bondAmount <= 0n) throw new Error('bondAmount must be > 0');
  if (p.feeAmount <= 0n) throw new Error('feeAmount must be > 0');
  if (p.verifierGraceBlocks < BigInt(MIN_VERIFIER_GRACE)) {
    throw new Error(`verifierGraceBlocks must be >= ${MIN_VERIFIER_GRACE}`);
  }
  if (p.maxDeadlineDelta <= p.verifierGraceBlocks) {
    throw new Error('maxDeadlineDelta must be greater than verifierGraceBlocks');
  }
  toContractCategory(p.tokenCategory);
}

export function offerSdkArgs(p: OfferParams) {
  return [
    p.agentPkh,
    p.verifierPk,
    p.bondAmount,
    p.feeAmount,
    toContractCategory(p.tokenCategory),
    networkIdByte(p.network),
    p.maxDeadlineDelta,
    p.verifierGraceBlocks,
    escrowBody(),
  ] as const;
}

export function makeOfferContract(p: OfferParams, provider: NetworkProvider) {
  return new Contract(offerArtifact, [...offerSdkArgs(p)], { provider, contractType: 'p2sh32' });
}

export function escrowArgsFor(offer: OfferParams, terms: ChallengeTerms): EscrowArgs {
  return {
    agentPkh: offer.agentPkh,
    challengerPkh: terms.challengerPkh,
    verifierPk: offer.verifierPk,
    bondAmount: offer.bondAmount,
    feeAmount: offer.feeAmount,
    tokenCategory: toContractCategory(offer.tokenCategory),
    networkId: networkIdByte(offer.network),
    challengeId: terms.challengeId,
    specHash: terms.specHash,
    expiryHeight: terms.expiryHeight,
    verifierGraceBlocks: offer.verifierGraceBlocks,
  };
}

export function makeEscrowContract(args: EscrowArgs, provider: NetworkProvider) {
  return new Contract(escrowArtifact, [...escrowSdkArgs(args)], { provider, contractType: 'p2sh32' });
}

/** App-side window check before building an accept. The covenant bounds it on-chain too. */
export function validateExpiry(offer: OfferParams, expiryHeight: bigint, locktime: number): void {
  if (expiryHeight >= BigInt(MAX_HEIGHT)) throw new Error('expiryHeight must be below MAX_HEIGHT');
  if (expiryHeight <= offer.verifierGraceBlocks) throw new Error('expiryHeight must exceed verifierGraceBlocks');
  if (expiryHeight - offer.maxDeadlineDelta > BigInt(locktime)) {
    throw new Error('expiryHeight is further out than the offer allows (maxDeadlineDelta)');
  }
  if (expiryHeight - offer.verifierGraceBlocks <= BigInt(locktime)) {
    throw new Error('answer deadline would already have passed');
  }
}
