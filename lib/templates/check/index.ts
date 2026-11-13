// Accept-time validation and expected-answer computation. Server side only: the agent runner must
// never import this (tests/boundary.test.ts). The verifier calls computeExpected only after an
// answer hash has been committed.
import { decodeCashAddress } from '@bitauth/libauth';
import { networkPrefix } from '../../bch/address';
import { decodeVerified, fetchVerifiedTx, type RawTxReader } from '../../bch/txSource';
import type { SellacalidaNetwork } from '../../constants';
import { canonicalize, parseCanonical } from '../canonical';
import { validateSpecShape, type ChallengeSpec, type MathNode } from '../public';
import { checkNftOutputIndex, checkOutputTokenCount, checkTotalSatsToAddress, type OutputTrace } from './bchTx';
import { DivisionByZeroError, evaluateMath, type MathStep } from './math';

export type CheckTrace =
  | { kind: 'outputs'; txid: string; outputs: OutputTrace[]; note?: string }
  | { kind: 'math'; steps: MathStep[] };

export interface CheckResult {
  expected: string;
  trace: CheckTrace;
  /** raw hex of the referenced transaction, cached in the evidence for reproduction */
  rawTxHex?: string;
}

/**
 * Full accept-time validation (spec section 9: invalid params are rejected at accept, not at
 * settle). Returns the parsed spec and its canonical JSON. Throws with every problem found.
 */
export function validateSpecForAccept(spec: unknown, escrowNetwork: SellacalidaNetwork): { spec: ChallengeSpec; canonical: string } {
  const errors = validateSpecShape(spec);
  if (errors.length) throw new Error(`invalid challenge spec: ${errors.join('; ')}`);
  const s = spec as ChallengeSpec;
  if (s.network !== escrowNetwork) {
    errors.push(`spec network ${s.network} does not match the escrow network ${escrowNetwork}`);
  }
  if (s.templateId === 'bch.total_sats_to_address') {
    const decoded = decodeCashAddress(s.params.address);
    if (typeof decoded === 'string') errors.push(`params.address is not a valid cashaddr: ${decoded}`);
    else if (decoded.prefix !== networkPrefix(s.network)) {
      errors.push(`params.address prefix ${decoded.prefix} does not match ${s.network} (${networkPrefix(s.network)})`);
    }
  }
  if (s.templateId === 'math.exact_result') {
    try {
      evaluateMath(s.params as MathNode);
    } catch (e) {
      if (e instanceof DivisionByZeroError) errors.push(e.message);
      else throw e;
    }
  }
  if (errors.length) throw new Error(`invalid challenge spec: ${errors.join('; ')}`);
  return { spec: s, canonical: canonicalize(s) };
}

/** Pure: compute the expected answer from a spec and (for BCH templates) the raw tx hex. */
export function computeExpectedFromRaw(spec: ChallengeSpec, rawTxHex?: string): CheckResult {
  if (spec.templateId === 'math.exact_result') {
    const steps: MathStep[] = [];
    const v = evaluateMath(spec.params as MathNode, steps);
    return { expected: v.toString(), trace: { kind: 'math', steps } };
  }
  if (!rawTxHex) throw new Error(`${spec.templateId} needs the raw transaction hex`);
  const tx = decodeVerified(spec.params.txid, rawTxHex);
  switch (spec.templateId) {
    case 'bch.output_token_count': {
      const r = checkOutputTokenCount(tx, spec.params.category);
      return { expected: r.expected, trace: { kind: 'outputs', txid: spec.params.txid, outputs: r.outputs }, rawTxHex };
    }
    case 'bch.total_sats_to_address': {
      const r = checkTotalSatsToAddress(tx, spec.params.address);
      return {
        expected: r.expected, rawTxHex,
        trace: { kind: 'outputs', txid: spec.params.txid, outputs: r.outputs, note: `target locking bytecode ${r.targetLockingBytecode}` },
      };
    }
    case 'bch.nft_output_index': {
      const r = checkNftOutputIndex(tx, spec.params.category, spec.params.commitment);
      return {
        expected: r.expected, rawTxHex,
        trace: { kind: 'outputs', txid: spec.params.txid, outputs: r.outputs, note: `${r.matches} matching NFT output(s)` },
      };
    }
  }
}

/** Fetch what the spec references (verified against its txid), then compute the expected answer. */
export async function computeExpected(spec: ChallengeSpec, chain: RawTxReader): Promise<CheckResult> {
  if (spec.templateId === 'math.exact_result') return computeExpectedFromRaw(spec);
  const { rawHex } = await fetchVerifiedTx(chain, spec.params.txid);
  return computeExpectedFromRaw(spec, rawHex);
}

/** Parse a stored canonical spec string back into a validated spec. */
export function loadCanonicalSpec(json: string, network: SellacalidaNetwork): ChallengeSpec {
  const parsed = parseCanonical(json);
  return validateSpecForAccept(parsed, network).spec;
}
