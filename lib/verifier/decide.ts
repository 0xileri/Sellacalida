// What the verifier may do right now (spec section 6). Pure: no chain access, no keys, no checker.
// The checker only ever runs on the "check" path, which requires a committed answer.
import { binToHex } from '@bitauth/libauth';
import type { SellacalidaNetwork } from '../constants';
import type { ChallengeTerms, OfferParams } from '../contracts';
import type { AnswerCommitment } from '../store/answers';
import { sha256Hex } from '../templates/canonical';

export interface VerifierChallenge {
  network: SellacalidaNetwork;
  offer: OfferParams;
  terms: ChallengeTerms;
  /** canonical spec JSON whose sha256 is terms.specHash */
  specJson: string;
  escrow: { txid: string; vout: number; satoshis: bigint };
}

export type Plan =
  | { action: 'wait'; reason: string }
  | { action: 'timeout'; reason: string }
  | { action: 'noresponse' }
  | { action: 'check'; commitment: AnswerCommitment }
  | { action: 'refuse'; reason: string };

export function answerDeadlineOf(c: VerifierChallenge): number {
  return Number(c.terms.expiryHeight - c.offer.verifierGraceBlocks);
}

export function planVerdict(c: VerifierChallenge, commitment: AnswerCommitment | null, height: number): Plan {
  const expiry = Number(c.terms.expiryHeight);
  const deadline = answerDeadlineOf(c);
  const challengeId = binToHex(c.terms.challengeId);

  // record integrity: never sign over a spec or challenge the escrow does not commit to
  if (sha256Hex(c.specJson) !== binToHex(c.terms.specHash)) return { action: 'refuse', reason: 'spec JSON does not hash to the escrow specHash' };
  if (c.network !== c.offer.network) return { action: 'refuse', reason: 'challenge and offer networks differ' };
  if (commitment && commitment.challengeId !== challengeId) return { action: 'refuse', reason: 'commitment belongs to another challenge' };

  if (height >= expiry) return { action: 'timeout', reason: `height ${height} >= expiry ${expiry}: refund both sides` };

  if (commitment) {
    if (commitment.committedAtHeight >= deadline) {
      // the store refuses late commits; if one exists anyway, sign nothing and let timeout refund
      return { action: 'refuse', reason: `answer committed at ${commitment.committedAtHeight}, after the deadline ${deadline}` };
    }
    if (commitment.answerHash !== sha256Hex(commitment.canonicalAnswer)) {
      return { action: 'refuse', reason: 'committed answerHash does not match the canonical answer' };
    }
    return { action: 'check', commitment };
  }
  if (height >= deadline) return { action: 'noresponse' };
  return { action: 'wait', reason: `no answer yet; answer deadline is height ${deadline} (now ${height})` };
}
