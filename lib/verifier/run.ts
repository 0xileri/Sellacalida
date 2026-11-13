// One verifier step for one challenge (spec section 6): wait, sign PASS / FAIL / NORESPONSE and
// settle, or refund with timeout. Server side only; the agent runner can never import this.
//
// Order is fixed: commitment present -> fetch chain data -> compute expected -> compare -> sign.
// A fetch or checker failure on the PASS/FAIL path signs nothing (and never becomes NORESPONSE).
import { binToHex, hexToBin, secp256k1 } from '@bitauth/libauth';
import type { NetworkProvider, SignatureTemplate, SpendableUtxo } from 'cashscript';
import { buildAttestation, signAttestation, verifyAttestation } from '../attestation';
import { buildSettle, buildTimeout, type UserInput } from '../bch/transactions';
import { MAX_FEE_SATS, MIN_OUTPUT_SATS, type Verdict } from '../constants';

/** fee headroom for a self-funded settle; the contract caps the real fee at MAX_FEE_SATS */
const SELF_SETTLE_FEE_BUDGET = MAX_FEE_SATS / 2n + 200n;
import { escrowArgsFor, makeEscrowContract } from '../contracts';
import type { AnswerCommitment } from '../store/answers';
import { sha256Hex } from '../templates/canonical';
import { computeExpected, loadCanonicalSpec, type CheckResult } from '../templates/check';
import type { ChallengeSpec } from '../templates/public';
import { formatWAT } from '../time';
import { answerDeadlineOf, planVerdict, type VerifierChallenge } from './decide';
import { EVIDENCE_FORMAT, type Evidence } from './evidence';

export interface VerifierDeps {
  provider: NetworkProvider;
  verifierPrivateKey: Uint8Array;
  /** optional BCH fee wallet; without it the escrow pays a capped fee from its own sats */
  feeWallet?: { template: SignatureTemplate; lock: Uint8Array };
  /** injectable for tests; defaults to the real checkers */
  checker?: (spec: ChallengeSpec, chain: NetworkProvider) => Promise<CheckResult>;
  now?: () => Date;
}

export type VerifierOutcome =
  | { kind: 'wait'; reason: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; reason: string; signed: boolean }
  | { kind: 'already_spent' }
  | { kind: 'settled'; verdict: Verdict; txid: string; evidence: Evidence }
  | { kind: 'timed_out'; txid: string };

async function feeInput(deps: VerifierDeps): Promise<UserInput | undefined> {
  if (!deps.feeWallet) return undefined;
  const utxos = await deps.provider.getUtxosForLockingBytecode(deps.feeWallet.lock);
  const u = utxos.filter((x) => !x.token && x.satoshis >= 2n * MIN_OUTPUT_SATS).sort((a, b) => (a.satoshis < b.satoshis ? -1 : 1))[0];
  return u ? { utxo: u, unlocker: deps.feeWallet.template.unlockP2PKH() } : undefined;
}

export async function runVerifier(c: VerifierChallenge, commitment: AnswerCommitment | null, deps: VerifierDeps): Promise<VerifierOutcome> {
  const { provider } = deps;
  const now = deps.now ?? (() => new Date());
  const escrowArgs = escrowArgsFor(c.offer, c.terms);
  const escrowContract = makeEscrowContract(escrowArgs, provider);
  const height = await provider.getBlockHeight();

  const live = (await provider.getUtxosForLockingBytecode(escrowContract.lockingBytecode)).find(
    (u) => u.txid === c.escrow.txid && u.vout === c.escrow.vout,
  );
  if (!live) return { kind: 'already_spent' };
  const escrowUtxo: SpendableUtxo = { ...live, lockingBytecode: escrowContract.lockingBytecode };

  const plan = planVerdict(c, commitment, height);
  if (plan.action === 'wait') return { kind: 'wait', reason: plan.reason };
  if (plan.action === 'refuse') return { kind: 'refused', reason: plan.reason };

  const fee = await feeInput(deps);

  if (plan.action === 'timeout') {
    try {
      const b = buildTimeout({
        provider, escrowContract, escrowUtxo, escrowArgs, tokenCategory: c.offer.tokenCategory,
        locktime: Number(c.terms.expiryHeight),
        ...(fee ? { bchFeeInput: fee, feeLockingBytecode: deps.feeWallet!.lock } : {}),
      });
      return { kind: 'timed_out', txid: (await b.send()).txid };
    } catch (e) {
      return { kind: 'error', reason: `timeout broadcast failed: ${String(e instanceof Error ? e.message : e)}`, signed: false };
    }
  }

  // ---- decide the verdict ----
  let verdict: Verdict;
  let check: CheckResult | null = null;
  if (plan.action === 'noresponse') {
    verdict = 'NORESPONSE';
  } else {
    let spec: ChallengeSpec;
    try {
      spec = loadCanonicalSpec(c.specJson, c.network);
      check = await (deps.checker ?? computeExpected)(spec, provider);
    } catch (e) {
      return { kind: 'error', reason: `checker failed, nothing signed: ${String(e instanceof Error ? e.message : e)}`, signed: false };
    }
    verdict = check.expected === plan.commitment.canonicalAnswer ? 'PASS' : 'FAIL';
  }

  // ---- sign ----
  const verifierPk = secp256k1.derivePublicKeyCompressed(deps.verifierPrivateKey);
  if (typeof verifierPk === 'string') throw new Error(verifierPk);
  if (binToHex(verifierPk) !== binToHex(c.offer.verifierPk)) {
    return { kind: 'refused', reason: 'this verifier key is not the one the escrow trusts' };
  }
  const message = buildAttestation({
    network: c.network,
    challengeId: c.terms.challengeId,
    escrowTxid: c.escrow.txid,
    escrowVout: c.escrow.vout,
    specHash: c.terms.specHash,
    verdict,
    answerHash: commitment && verdict !== 'NORESPONSE' ? hexToBin(commitment.answerHash) : undefined,
  });
  const signature = signAttestation(message, deps.verifierPrivateKey);
  if (!verifyAttestation(message, signature, verifierPk)) throw new Error('self-check failed: signature does not verify');

  const deadline = answerDeadlineOf(c);
  const evidence: Evidence = {
    format: EVIDENCE_FORMAT,
    network: c.network,
    challengeId: binToHex(c.terms.challengeId),
    escrow: { txid: c.escrow.txid, vout: c.escrow.vout },
    spec: c.specJson,
    specHash: sha256Hex(c.specJson),
    expiryHeight: Number(c.terms.expiryHeight),
    answerDeadline: deadline,
    answer:
      verdict === 'NORESPONSE' || !commitment
        ? null
        : {
            source: commitment.source,
            modelId: commitment.modelId,
            rawResponseHash: commitment.rawResponseHash,
            canonicalAnswer: commitment.canonicalAnswer,
            answerHash: commitment.answerHash,
            committedAtHeight: commitment.committedAtHeight,
            committedAtWAT: commitment.committedAtWAT,
          },
    check: check ? { expected: check.expected, trace: check.trace, ...(check.rawTxHex ? { rawTxHex: check.rawTxHex } : {}) } : null,
    verdict,
    attestation: binToHex(message),
    signature: binToHex(signature),
    verifierPk: binToHex(verifierPk),
    decidedAtHeight: height,
    decidedAtWAT: formatWAT(now()),
    settleTxid: null,
  };

  // ---- settle ----
  try {
    // a self-funded settle (~1 kB) needs room for its fee and still MIN_OUTPUT_SATS for the winner
    if (!fee && escrowUtxo.satoshis < MIN_OUTPUT_SATS + SELF_SETTLE_FEE_BUDGET) {
      throw new Error(`escrow holds ${escrowUtxo.satoshis} sats and no fee wallet UTXO is available`);
    }
    const b = buildSettle({
      provider, escrowContract, escrowUtxo, escrowArgs, tokenCategory: c.offer.tokenCategory,
      winnerPkh: verdict === 'PASS' ? c.offer.agentPkh : c.terms.challengerPkh,
      message, signature,
      ...(verdict === 'NORESPONSE' ? { locktime: deadline } : {}),
      ...(fee ? { bchFeeInput: fee, feeLockingBytecode: deps.feeWallet!.lock } : {}),
    });
    const sent = await b.send();
    evidence.settleTxid = sent.txid;
    return { kind: 'settled', verdict, txid: sent.txid, evidence };
  } catch (e) {
    // the verdict is deterministic, so a retry re-signs the same message
    return { kind: 'error', reason: `settle broadcast failed: ${String(e instanceof Error ? e.message : e)}`, signed: true };
  }
}
