// Verifier end to end on mocknet: a real accept creates the escrow, an answer is (or is not)
// committed, and the verifier signs and settles, or waits, refuses, or refunds (spec section 6).
import { describe, expect, it, vi } from 'vitest';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import type { MockNetworkProvider } from 'cashscript';
import { buildAccept } from '@/lib/bch/transactions';
import { escrowArgsFor, makeEscrowContract, type ChallengeTerms } from '@/lib/contracts';
import { AnswerStore } from '@/lib/store/answers';
import { canonicalize, specHashOf } from '@/lib/templates/canonical';
import { computeExpected } from '@/lib/templates/check';
import type { ChallengeSpec } from '@/lib/templates/public';
import { planVerdict, type VerifierChallenge } from '@/lib/verifier/decide';
import { reproduceEvidence, type Evidence } from '@/lib/verifier/evidence';
import { runVerifier, type VerifierDeps } from '@/lib/verifier/run';
import {
  START_HEIGHT, addUtxo, agent, baseOffer, challenger, feeWallet, fundedOffer, newProvider, stranger, verifier,
} from './helpers';
import { CAT_A, makeFixtureTx } from './chainFixture';

const offer = baseOffer(); // bond 100, fee 20, grace 18
const EXPIRY = START_HEIGHT + 100;
const DEADLINE = EXPIRY - 18;
const MATH: ChallengeSpec = {
  templateId: 'math.exact_result', version: 1, network: 'mocknet',
  params: { op: 'div', left: { op: 'mul', left: '-7', right: '3' }, right: '2' }, // = -10
};

let n = 0;
async function setup(spec: ChallengeSpec = MATH, provider: MockNetworkProvider = newProvider()) {
  n += 1;
  const specJson = canonicalize(spec);
  const terms: ChallengeTerms = {
    challengerPkh: challenger.pkh,
    challengeId: sha256.hash(utf8ToBin(`verifier-test-${n}`)),
    specHash: specHashOf(spec),
    expiryHeight: BigInt(EXPIRY),
  };
  const { offerContract, offerUtxo } = fundedOffer(provider, offer);
  const tokenUtxo = addUtxo(provider, challenger.lockHex, 10_000n, { category: offer.tokenCategory, amount: 20n });
  const accept = await buildAccept({
    provider, offer, offerContract, offerUtxo, terms, escrowArgs: escrowArgsFor(offer, terms),
    challengerTokenInput: { utxo: tokenUtxo, unlocker: challenger.template.unlockP2PKH() },
    escrowSatoshis: 5000n, locktime: START_HEIGHT,
  }).send();
  const c: VerifierChallenge = {
    network: 'mocknet', offer, terms, specJson,
    escrow: { txid: accept.txid, vout: 0, satoshis: 5000n },
  };
  const store = new AnswerStore();
  const commit = (canonicalAnswer: string, source: 'ai' | 'fixture' = 'ai') =>
    store.commit(
      {
        challengeId: binToHex(terms.challengeId), templateId: spec.templateId, source,
        modelId: source === 'ai' ? 'test-model-1' : null, rawResponse: `answer: ${canonicalAnswer}`, canonicalAnswer,
      },
      { currentHeight: START_HEIGHT + 1, answerDeadline: DEADLINE },
    );
  const deps: VerifierDeps = { provider, verifierPrivateKey: verifier.priv, checker: vi.fn(computeExpected) };
  return { provider, c, store, commit, deps, terms };
}

async function tokens(provider: MockNetworkProvider, lock: Uint8Array) {
  const u = await provider.getUtxosForLockingBytecode(lock);
  return u.filter((x) => x.token).reduce((a, x) => a + x.token!.amount, 0n);
}

const roundTrip = (e: Evidence) => JSON.parse(JSON.stringify(e)) as Evidence;

describe('verifier: commit before check', () => {
  it('waits, and never runs the checker, while no answer is committed before the deadline', async () => {
    const { c, deps } = await setup();
    const out = await runVerifier(c, null, deps);
    expect(out.kind).toBe('wait');
    expect(deps.checker).not.toHaveBeenCalled();
  });

  it('runs the checker exactly once, only after the answer is committed', async () => {
    const { c, commit, deps } = await setup();
    const answer = commit('-10');
    expect(deps.checker).not.toHaveBeenCalled();
    const out = await runVerifier(c, answer, deps);
    expect(out.kind).toBe('settled');
    expect(deps.checker).toHaveBeenCalledTimes(1);
  });
});

describe('verifier: verdicts and payouts', () => {
  it('correct answer: PASS, the agent receives bond + fee, evidence reproduces', async () => {
    const { provider, c, commit, deps } = await setup();
    const out = await runVerifier(c, commit('-10'), deps);
    if (out.kind !== 'settled') throw new Error(JSON.stringify(out));
    expect(out.verdict).toBe('PASS');
    expect(await tokens(provider, agent.lock)).toBe(120n);
    expect(out.evidence.answer?.source).toBe('ai');
    expect(out.evidence.answer?.modelId).toBe('test-model-1');
    expect(out.evidence.check?.expected).toBe('-10');
    expect(out.evidence.settleTxid).toBe(out.txid);
    expect(reproduceEvidence(roundTrip(out.evidence))).toMatchObject({ ok: true, recomputedVerdict: 'PASS' });
  });

  it('wrong answer: FAIL, the challenger receives bond + fee', async () => {
    const { provider, c, commit, deps } = await setup();
    const out = await runVerifier(c, commit('-11'), deps);
    if (out.kind !== 'settled') throw new Error(JSON.stringify(out));
    expect(out.verdict).toBe('FAIL');
    expect(await tokens(provider, challenger.lock)).toBe(120n);
    expect(reproduceEvidence(roundTrip(out.evidence))).toMatchObject({ ok: true, recomputedVerdict: 'FAIL' });
  });

  it('an unparseable answer ("") fails like any wrong answer', async () => {
    const { c, commit, deps } = await setup();
    const out = await runVerifier(c, commit(''), deps);
    expect(out.kind === 'settled' && out.verdict).toBe('FAIL');
  });

  it('no answer by the deadline: NORESPONSE, the challenger is paid, no checker run', async () => {
    const { provider, c, deps } = await setup();
    provider.setBlockHeight(DEADLINE);
    const out = await runVerifier(c, null, deps);
    if (out.kind !== 'settled') throw new Error(JSON.stringify(out));
    expect(out.verdict).toBe('NORESPONSE');
    expect(out.evidence.answer).toBeNull();
    expect(out.evidence.check).toBeNull();
    expect(deps.checker).not.toHaveBeenCalled();
    expect(await tokens(provider, challenger.lock)).toBe(120n);
    expect(reproduceEvidence(roundTrip(out.evidence)).ok).toBe(true);
  });

  it('fixture answers are labeled fixture in the evidence', async () => {
    const { c, commit, deps } = await setup();
    const out = await runVerifier(c, commit('-10', 'fixture'), deps);
    expect(out.kind === 'settled' && out.evidence.answer?.source).toBe('fixture');
    expect(out.kind === 'settled' && out.evidence.answer?.modelId).toBeNull();
  });

  it('with a fee wallet the winner keeps every escrow sat (2-output settle)', async () => {
    const { provider, c, commit, deps } = await setup();
    addUtxo(provider, feeWallet.lockHex, 5000n);
    const out = await runVerifier(c, commit('-10'), { ...deps, feeWallet: { template: feeWallet.template, lock: feeWallet.lock } });
    expect(out.kind).toBe('settled');
    const paid = (await provider.getUtxosForLockingBytecode(agent.lock)).find((u) => u.token);
    expect(paid?.satoshis).toBe(5000n);
  });

  it('a BCH-analysis challenge settles with the raw tx cached in the evidence', async () => {
    const provider = newProvider();
    const fx = await makeFixtureTx(provider);
    const spec: ChallengeSpec = { templateId: 'bch.output_token_count', version: 1, network: 'mocknet', params: { txid: fx.txid, category: CAT_A } };
    const { c, commit, deps } = await setup(spec, provider);
    const out = await runVerifier(c, commit('2'), deps); // true answer is 3
    if (out.kind !== 'settled') throw new Error(JSON.stringify(out));
    expect(out.verdict).toBe('FAIL');
    expect(out.evidence.check?.rawTxHex).toBe(fx.rawHex);
    expect(reproduceEvidence(roundTrip(out.evidence))).toMatchObject({ ok: true, recomputedExpected: '3' });
  });
});

describe('verifier: refusals, errors and timeout', () => {
  it('a checker failure signs nothing and does not turn into NORESPONSE', async () => {
    const { provider, c, commit, deps } = await setup();
    const out = await runVerifier(c, commit('-10'), { ...deps, checker: async () => { throw new Error('electrum down'); } });
    expect(out).toMatchObject({ kind: 'error', signed: false });
    const escrow = makeEscrowContract(escrowArgsFor(c.offer, c.terms), provider);
    expect(await escrow.getUtxos()).toHaveLength(1);
  });

  it('after expiry it refunds both sides with timeout', async () => {
    const { provider, c, commit, deps } = await setup();
    const answer = commit('-10');
    provider.setBlockHeight(EXPIRY);
    const out = await runVerifier(c, answer, deps);
    expect(out.kind).toBe('timed_out');
    expect(await tokens(provider, agent.lock)).toBe(100n);
    expect(await tokens(provider, challenger.lock)).toBe(20n);
  });

  it('a second run after settle sees the escrow already spent', async () => {
    const { c, commit, deps } = await setup();
    const a = commit('-10');
    await runVerifier(c, a, deps);
    expect((await runVerifier(c, a, deps)).kind).toBe('already_spent');
  });

  it('refuses to sign with a key the escrow does not trust', async () => {
    const { c, commit, deps } = await setup();
    const out = await runVerifier(c, commit('-10'), { ...deps, verifierPrivateKey: stranger.priv });
    expect(out).toMatchObject({ kind: 'refused', reason: expect.stringMatching(/not the one the escrow trusts/) });
  });

  it('refuses a spec that does not hash to the escrow specHash', async () => {
    const { c, commit, deps } = await setup();
    const other = canonicalize({ ...MATH, params: { op: 'add', left: '1', right: '1' } });
    const out = await runVerifier({ ...c, specJson: other }, commit('-10'), deps);
    expect(out).toMatchObject({ kind: 'refused', reason: expect.stringMatching(/specHash/) });
    expect(deps.checker).not.toHaveBeenCalled();
  });

  it('refuses a late commitment rather than signing NORESPONSE over it', () => {
    const c = { network: 'mocknet', offer, specJson: canonicalize(MATH), escrow: { txid: '00'.repeat(32), vout: 0, satoshis: 5000n },
      terms: { challengerPkh: challenger.pkh, challengeId: new Uint8Array(32), specHash: specHashOf(MATH), expiryHeight: BigInt(EXPIRY) } } as VerifierChallenge;
    const late = {
      challengeId: '00'.repeat(32), templateId: 'math.exact_result' as const, source: 'ai' as const, modelId: 'm',
      rawResponse: '-10', rawResponseHash: '', canonicalAnswer: '-10',
      answerHash: binToHex(sha256.hash(utf8ToBin('-10'))), toolCalls: [], committedAtHeight: DEADLINE, committedAtWAT: '',
    };
    expect(planVerdict(c, late, DEADLINE + 1)).toMatchObject({ action: 'refuse' });
  });
});

describe('reproduce catches tampered evidence', () => {
  async function settledEvidence() {
    const { c, commit, deps } = await setup();
    const out = await runVerifier(c, commit('-11'), deps);
    if (out.kind !== 'settled') throw new Error('expected settle');
    return roundTrip(out.evidence);
  }

  it('a flipped verdict', async () => {
    const e = await settledEvidence();
    e.verdict = 'PASS';
    const r = reproduceEvidence(e);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/re-run gives FAIL/);
  });

  it('an edited answer', async () => {
    const e = await settledEvidence();
    e.answer!.canonicalAnswer = '-10';
    expect(reproduceEvidence(e).problems.join(' ')).toMatch(/answerHash does not match/);
  });

  it('a swapped signature', async () => {
    const e = await settledEvidence();
    e.signature = e.signature.slice(0, -2) + (e.signature.endsWith('00') ? '01' : '00');
    expect(reproduceEvidence(e).problems.join(' ')).toMatch(/signature does not verify/);
  });

  it('an edited spec', async () => {
    const e = await settledEvidence();
    e.spec = canonicalize({ ...MATH, params: { op: 'add', left: '1', right: '1' } });
    expect(reproduceEvidence(e).problems.join(' ')).toMatch(/spec does not hash/);
  });
});
