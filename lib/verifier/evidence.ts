// Public evidence for a signed verdict, and an independent re-check of it. Anyone holding an
// evidence file can re-run the checker on the cached raw transaction, rebuild the 156-byte
// attestation and verify the verifier's signature, without trusting this server.
import { binToHex, hexToBin } from '@bitauth/libauth';
import { buildAttestation, verifyAttestation } from '../attestation';
import type { SellacalidaNetwork, Verdict } from '../constants';
import type { AnswerSource, ToolCallRecord } from '../store/answers';
import { parseCanonical, sha256Hex } from '../templates/canonical';
import { computeExpectedFromRaw, validateSpecForAccept, type CheckTrace } from '../templates/check';

export const EVIDENCE_FORMAT = 'sellacalida-evidence-v1';

export interface Evidence {
  format: typeof EVIDENCE_FORMAT;
  network: SellacalidaNetwork;
  challengeId: string;
  escrow: { txid: string; vout: number };
  spec: string;
  specHash: string;
  expiryHeight: number;
  answerDeadline: number;
  answer: null | {
    source: AnswerSource;
    modelId: string | null;
    rawResponseHash: string;
    canonicalAnswer: string;
    answerHash: string;
    /** tool calls the agent made before answering (public chain reads) */
    toolCalls: ToolCallRecord[];
    committedAtHeight: number;
    committedAtWAT: string;
  };
  check: null | { expected: string; trace: CheckTrace; rawTxHex?: string };
  verdict: Verdict;
  attestation: string;
  signature: string;
  verifierPk: string;
  decidedAtHeight: number;
  decidedAtWAT: string;
  settleTxid: string | null;
}

export interface ReproduceReport {
  ok: boolean;
  problems: string[];
  recomputedExpected?: string;
  recomputedVerdict?: Verdict;
}

export function reproduceEvidence(e: Evidence): ReproduceReport {
  const problems: string[] = [];
  if (e.format !== EVIDENCE_FORMAT) problems.push(`unknown evidence format ${e.format}`);
  if (sha256Hex(e.spec) !== e.specHash) problems.push('spec does not hash to specHash');

  let recomputedExpected: string | undefined;
  let recomputedVerdict: Verdict | undefined;
  try {
    const spec = validateSpecForAccept(parseCanonical(e.spec), e.network).spec;
    if (e.verdict === 'NORESPONSE') {
      if (e.answer) problems.push('NORESPONSE evidence must not carry a committed answer');
      if (e.check) problems.push('NORESPONSE evidence must not carry a checker run');
      recomputedVerdict = 'NORESPONSE';
    } else {
      if (!e.answer) problems.push(`${e.verdict} evidence has no committed answer`);
      if (!e.check) problems.push(`${e.verdict} evidence has no checker run`);
      if (e.answer && e.check) {
        if (sha256Hex(e.answer.canonicalAnswer) !== e.answer.answerHash) problems.push('answerHash does not match the canonical answer');
        if (e.answer.committedAtHeight >= e.answerDeadline) problems.push('answer was committed after the deadline');
        const r = computeExpectedFromRaw(spec, e.check.rawTxHex);
        recomputedExpected = r.expected;
        if (r.expected !== e.check.expected) problems.push(`checker now gives ${r.expected}, evidence says ${e.check.expected}`);
        recomputedVerdict = r.expected === e.answer.canonicalAnswer ? 'PASS' : 'FAIL';
        if (recomputedVerdict !== e.verdict) problems.push(`re-run gives ${recomputedVerdict}, evidence says ${e.verdict}`);
      }
    }
  } catch (err) {
    problems.push(`re-run failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const message = buildAttestation({
      network: e.network,
      challengeId: hexToBin(e.challengeId),
      escrowTxid: e.escrow.txid,
      escrowVout: e.escrow.vout,
      specHash: hexToBin(e.specHash),
      verdict: e.verdict,
      answerHash: e.verdict === 'NORESPONSE' ? undefined : hexToBin(e.answer?.answerHash ?? ''),
    });
    if (binToHex(message) !== e.attestation) problems.push('attestation bytes do not match the evidence fields');
    if (!verifyAttestation(hexToBin(e.attestation), hexToBin(e.signature), hexToBin(e.verifierPk))) {
      problems.push('signature does not verify against verifierPk');
    }
  } catch (err) {
    problems.push(`attestation rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { ok: problems.length === 0, problems, recomputedExpected, recomputedVerdict };
}
