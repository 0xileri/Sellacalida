// JSON wire format shared by the API and the browser. Bigints travel as decimal strings and bytes
// as hex, so nothing here depends on server-only code.
import { binToHex, hexToBin } from '@bitauth/libauth';
import type { SellacalidaNetwork, Verdict } from './constants';
import type { ChallengeTerms, OfferParams } from './contracts';
import type { TemplateId } from './templates/public';

/** What the browser may know about the server config. Never includes keys or tokens. */
export interface PublicConfig {
  network: SellacalidaNetwork;
  tokenCategory: string;
  tokenSymbol: string;
  tokenDecimals: number;
  escrowSats: string;
  featuredAgentId: string;
  links: { deck: string | null; repo: string; emberAddress: string | null };
}

export interface OfferParamsWire {
  agentPkh: string;
  verifierPk: string;
  bondAmount: string;
  feeAmount: string;
  tokenCategory: string;
  network: SellacalidaNetwork;
  maxDeadlineDelta: string;
  verifierGraceBlocks: string;
}

export const offerParamsToWire = (p: OfferParams): OfferParamsWire => ({
  agentPkh: binToHex(p.agentPkh),
  verifierPk: binToHex(p.verifierPk),
  bondAmount: p.bondAmount.toString(),
  feeAmount: p.feeAmount.toString(),
  tokenCategory: p.tokenCategory,
  network: p.network,
  maxDeadlineDelta: p.maxDeadlineDelta.toString(),
  verifierGraceBlocks: p.verifierGraceBlocks.toString(),
});

export const offerParamsFromWire = (w: OfferParamsWire): OfferParams => ({
  agentPkh: hexToBin(w.agentPkh),
  verifierPk: hexToBin(w.verifierPk),
  bondAmount: BigInt(w.bondAmount),
  feeAmount: BigInt(w.feeAmount),
  tokenCategory: w.tokenCategory,
  network: w.network,
  maxDeadlineDelta: BigInt(w.maxDeadlineDelta),
  verifierGraceBlocks: BigInt(w.verifierGraceBlocks),
});

export interface TermsWire {
  challengerPkh: string;
  challengeId: string;
  specHash: string;
  expiryHeight: string;
}

export const termsToWire = (t: ChallengeTerms): TermsWire => ({
  challengerPkh: binToHex(t.challengerPkh),
  challengeId: binToHex(t.challengeId),
  specHash: binToHex(t.specHash),
  expiryHeight: t.expiryHeight.toString(),
});

export const termsFromWire = (w: TermsWire): ChallengeTerms => ({
  challengerPkh: hexToBin(w.challengerPkh),
  challengeId: hexToBin(w.challengeId),
  specHash: hexToBin(w.specHash),
  expiryHeight: BigInt(w.expiryHeight),
});

export interface OfferView {
  id: string;
  agentId: string;
  agentName: string;
  network: SellacalidaNetwork;
  txid: string;
  vout: number;
  satoshis: string;
  status: 'open' | 'accepted' | 'cancelled' | 'spent';
  params: OfferParamsWire;
  challengeId: string | null;
  closeTxid: string | null;
  createdAt: string;
}

export interface AnswerView {
  source: 'ai' | 'fixture';
  modelId: string | null;
  canonicalAnswer: string;
  rawResponse: string;
  rawResponseHash: string;
  answerHash: string;
  toolCalls: { name: string; arguments: string; ok: boolean; resultSha256: string | null; error?: string }[];
  committedAtHeight: number;
  committedAtWAT: string;
}

/** The parts of a verifier evidence file the pages render (full file: /api/challenges/[id]/evidence). */
export interface EvidenceView {
  verdict: Verdict;
  attestation: string;
  signature: string;
  verifierPk: string;
  decidedAtHeight: number;
  decidedAtWAT: string;
  check: null | {
    expected: string;
    trace:
      | { kind: 'math'; steps: { expr: string; value: string }[] }
      | {
          kind: 'outputs';
          txid: string;
          note?: string;
          outputs: {
            index: number; valueSatoshis: string; lockingBytecode: string; tokenCategory: string | null;
            tokenAmount: string | null; nftCapability: string | null; nftCommitment: string | null; matched: boolean;
          }[];
        };
  };
}

export interface ChallengeView {
  id: string;
  status: 'awaiting_accept' | 'accepted' | 'answered' | 'settled' | 'timed_out' | 'abandoned';
  network: SellacalidaNetwork;
  templateId: TemplateId;
  spec: unknown;
  specJson: string;
  prompt: string;
  offerId: string;
  agentId: string;
  agentName: string;
  challengerAddress: string;
  bondAmount: string;
  feeAmount: string;
  tokenCategory: string;
  expiryHeight: number;
  answerDeadline: number;
  acceptTxid: string | null;
  escrow: { txid: string; vout: number; satoshis: string } | null;
  answer: AnswerView | null;
  verdict: Verdict | null;
  settleTxid: string | null;
  timeoutTxid: string | null;
  evidence: EvidenceView | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptBundle {
  challengeId: string;
  offer: { txid: string; vout: number; satoshis: string; params: OfferParamsWire };
  terms: TermsWire;
  locktime: number;
  escrowSatoshis: string;
}

export interface StatsView {
  network: SellacalidaNetwork;
  height: number | null;
  openOffers: number;
  challenges: { total: number; live: number; pass: number; fail: number; noResponse: number; timeout: number };
}

export interface AgentView {
  id: string;
  name: string;
  bio: string;
  address: string;
  modelId: string;
  record: { challenges: number; pass: number; fail: number; noResponse: number; timeout: number; live: number };
  policy: { bondAmount: string; feeAmount: string; maxDeadlineDelta: string; verifierGraceBlocks: string } | null;
  openOffers: OfferView[];
  recent: ChallengeView[];
}
