// Server orchestration: offers, challenge preparation, accept confirmation (checked on chain),
// the agent run, and the verifier tick. Route handlers stay thin and call into here.
//
// Order of trust: the chain decides what happened; this module only records it. The browser is
// never trusted for amounts, addresses or escrow terms: accepts are re-checked from the raw tx.
import { binToHex, decodeCashAddress, hexToBin } from '@bitauth/libauth';
import { MockNetworkProvider, TransactionBuilder, type SpendableUtxo } from 'cashscript';
import { answerChallenge } from '../agent/runner';
import { pkhToCashAddress, networkPrefix } from '../bch/address';
import { buildAccept, buildCancel, withFee, DEFAULT_FEE_RATE } from '../bch/transactions';
import { decodeVerified } from '../bch/txSource';
import { MIN_OUTPUT_SATS } from '../constants';
import { escrowArgsFor, makeOfferContract, validateExpiry, validateOfferParams, type ChallengeTerms, type OfferParams } from '../contracts';
import { escrowLockingBytecode } from '../encodeRedeemScript';
import { parseCanonical, specHashOf } from '../templates/canonical';
import { validateSpecForAccept } from '../templates/check';
import { renderPrompt, validateSpecShape, type ChallengeSpec } from '../templates/public';
import { answerDeadlineOf, type VerifierChallenge } from '../verifier/decide';
import { runVerifier } from '../verifier/run';
import {
  offerParamsToWire, termsToWire,
  type AcceptBundle, type AgentView, type ChallengeView, type OfferView, type StatsView,
} from '../wire';
import type { ServerContext } from './context';
import type { ChallengeRecord, OfferRecord } from './db';

export class UserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------
// agents
// ---------------------------------------------------------------------------------------------

export function ensureAgent(ctx: ServerContext) {
  if (!ctx.agentKey) return null;
  const a = ctx.config.agent;
  const existing = ctx.db.agent(a.id);
  const record = {
    id: a.id,
    name: a.name,
    bio: a.bio,
    address: ctx.agentKey.address,
    pkh: binToHex(ctx.agentKey.pkh),
    modelId: ctx.llm?.model ?? 'offline',
    createdAt: existing?.createdAt ?? now(),
  };
  if (!existing || JSON.stringify(existing) !== JSON.stringify(record)) ctx.db.upsertAgent(record);
  return ctx.db.agent(a.id);
}

// ---------------------------------------------------------------------------------------------
// offers (published by the agent's hot wallet)
// ---------------------------------------------------------------------------------------------

export async function createOffer(
  ctx: ServerContext,
  overrides: Partial<{ bond: bigint; fee: bigint; maxDeadlineDelta: bigint; verifierGraceBlocks: bigint }> = {},
): Promise<OfferRecord> {
  const agent = ensureAgent(ctx);
  if (!agent || !ctx.agentKey) throw new UserError('no agent wallet configured (AGENT_WIF)', 503);
  if (!ctx.verifier) throw new UserError('no verifier key configured (VERIFIER_PRIVATE_KEY)', 503);
  const given = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  const d = { ...ctx.config.offerDefaults, ...given };
  const params: OfferParams = {
    agentPkh: ctx.agentKey.pkh,
    verifierPk: ctx.verifier.verifierPk,
    bondAmount: d.bond,
    feeAmount: d.fee,
    tokenCategory: ctx.config.tokenCategory,
    network: ctx.config.network,
    maxDeadlineDelta: d.maxDeadlineDelta,
    verifierGraceBlocks: d.verifierGraceBlocks,
  };
  validateOfferParams(params);

  const category = params.tokenCategory;
  const utxos = await ctx.provider.getUtxosForLockingBytecode(ctx.agentKey.lock);
  const tokenIns: SpendableUtxo[] = [];
  let tokens = 0n;
  for (const u of utxos.filter((x) => x.token?.category === category && !x.token.nft).sort((a, b) => (b.token!.amount > a.token!.amount ? 1 : -1))) {
    if (tokens >= params.bondAmount) break;
    tokenIns.push(u);
    tokens += u.token!.amount;
  }
  if (tokens < params.bondAmount) throw new UserError(`agent wallet holds ${tokens} of the token; the bond needs ${params.bondAmount}`, 409);
  const bchIns: SpendableUtxo[] = [];
  let sats = tokenIns.reduce((a, u) => a + u.satoshis, 0n);
  const need = ctx.config.offerSats + MIN_OUTPUT_SATS + 3000n;
  for (const u of utxos.filter((x) => !x.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))) {
    if (sats >= need) break;
    bchIns.push(u);
    sats += u.satoshis;
  }
  if (sats < need) throw new UserError(`agent wallet has ${sats} sats; publishing an offer needs about ${need}`, 409);

  const offerContract = makeOfferContract(params, ctx.provider);
  const tokenChange = tokens - params.bondAmount;
  const fixed = ctx.config.offerSats + (tokenChange > 0n ? MIN_OUTPUT_SATS : 0n);
  const ins = [...tokenIns, ...bchIns];
  const { builder } = withFee((fee) => {
    const b = new TransactionBuilder({ provider: ctx.provider });
    for (const u of ins) b.addInput(u, ctx.agentKey!.template.unlockP2PKH());
    b.addOutput({ to: hexToBin(offerContract.lockingBytecode), amount: ctx.config.offerSats, token: { category, amount: params.bondAmount } });
    if (tokenChange > 0n) b.addOutput({ to: ctx.agentKey!.lock, amount: MIN_OUTPUT_SATS, token: { category, amount: tokenChange } });
    const change = sats - fixed - fee;
    if (change >= 546n) b.addOutput({ to: ctx.agentKey!.lock, amount: change });
    return b;
  }, 0, DEFAULT_FEE_RATE);
  const { txid } = await builder.send();

  const record: OfferRecord = {
    id: `${txid}:0`, agentId: agent.id, network: params.network, params, txid, vout: 0,
    satoshis: ctx.config.offerSats, status: 'open', challengeId: null, closeTxid: null, createdAt: now(), updatedAt: now(),
  };
  ctx.db.insertOffer(record);
  return record;
}

function offerUtxo(o: OfferRecord, lockingBytecode: string): SpendableUtxo {
  return {
    txid: o.txid, vout: o.vout, satoshis: o.satoshis, lockingBytecode,
    token: { category: o.params.tokenCategory, amount: o.params.bondAmount },
  };
}

async function isLive(ctx: ServerContext, o: OfferRecord): Promise<boolean> {
  const c = makeOfferContract(o.params, ctx.provider);
  const utxos = await ctx.provider.getUtxosForLockingBytecode(c.lockingBytecode);
  return utxos.some((u) => u.txid === o.txid && u.vout === o.vout);
}

export async function cancelOffer(ctx: ServerContext, offerId: string): Promise<OfferRecord> {
  const o = ctx.db.offer(offerId);
  if (!o) throw new UserError('no such offer', 404);
  if (o.status !== 'open') throw new UserError(`offer is ${o.status}`, 409);
  if (!ctx.agentKey || binToHex(ctx.agentKey.pkh) !== binToHex(o.params.agentPkh)) throw new UserError('this server does not hold the agent key for that offer', 403);
  const c = makeOfferContract(o.params, ctx.provider);
  const b = buildCancel({
    provider: ctx.provider, offer: o.params, offerContract: c, offerUtxo: offerUtxo(o, c.lockingBytecode),
    agentPk: ctx.agentKey.pk, agentSig: ctx.agentKey.template,
  });
  const { txid } = await b.send();
  return ctx.db.updateOffer(o.id, { status: 'cancelled', closeTxid: txid });
}

/** Mark open offers whose UTXO is gone (accepted or cancelled elsewhere). */
export async function refreshOffers(ctx: ServerContext) {
  for (const o of ctx.db.offers.filter((x) => x.status === 'open')) {
    if (!(await isLive(ctx, o))) ctx.db.updateOffer(o.id, { status: 'spent' });
  }
}

// ---------------------------------------------------------------------------------------------
// challenges
// ---------------------------------------------------------------------------------------------

function randomBytes32(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

function challengerPkhFromAddress(ctx: ServerContext, address: string): Uint8Array {
  const d = decodeCashAddress(address.trim());
  if (typeof d === 'string') throw new UserError(`challenger address: ${d}`);
  if (d.prefix !== networkPrefix(ctx.config.network)) throw new UserError(`challenger address is for ${d.prefix}, this app runs on ${ctx.config.network}`);
  if (d.type !== 'p2pkh' && d.type !== 'p2pkhWithTokens') throw new UserError('challenger address must be a P2PKH (wallet) address');
  return d.payload;
}

/**
 * Validate the challenger's spec (spec section 9: invalid params are rejected at accept, not at
 * settle), fix the deadline from the offer policy, and hand back everything the wallet needs to
 * build the one-transaction accept.
 */
export async function prepareChallenge(
  ctx: ServerContext,
  input: { offerId: string; spec: unknown; challengerAddress: string },
): Promise<{ challenge: ChallengeRecord; bundle: AcceptBundle }> {
  const o = ctx.db.offer(input.offerId);
  if (!o) throw new UserError('no such offer', 404);
  if (o.status !== 'open') throw new UserError(`offer is ${o.status}`, 409);
  if (!(await isLive(ctx, o))) {
    ctx.db.updateOffer(o.id, { status: 'spent' });
    throw new UserError('offer was just taken', 409);
  }
  let canonical: string;
  try {
    canonical = validateSpecForAccept(input.spec, ctx.config.network).canonical;
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }
  const challengerPkh = challengerPkhFromAddress(ctx, input.challengerAddress);
  const height = await ctx.provider.getBlockHeight();
  const expiryHeight = BigInt(height) + o.params.maxDeadlineDelta;
  validateExpiry(o.params, expiryHeight, height);
  const terms: ChallengeTerms = {
    challengerPkh, challengeId: randomBytes32(), specHash: specHashOf(JSON.parse(canonical)), expiryHeight,
  };
  const spec = JSON.parse(canonical) as ChallengeSpec;
  const record: ChallengeRecord = {
    id: binToHex(terms.challengeId), offerId: o.id, agentId: o.agentId, network: o.network, templateId: spec.templateId,
    spec: canonical, challengerAddress: pkhToCashAddress(challengerPkh, ctx.config.network), terms, locktime: height,
    escrowSatoshis: ctx.config.escrowSats, status: 'awaiting_accept', acceptTxid: null, escrow: null, verdict: null,
    settleTxid: null, timeoutTxid: null, evidence: null, lastError: null, createdAt: now(), updatedAt: now(),
  };
  ctx.db.insertChallenge(record);
  return {
    challenge: record,
    bundle: {
      challengeId: record.id,
      offer: { txid: o.txid, vout: o.vout, satoshis: o.satoshis.toString(), params: offerParamsToWire(o.params) },
      terms: termsToWire(terms),
      locktime: height,
      escrowSatoshis: ctx.config.escrowSats.toString(),
    },
  };
}

/** The challenger broadcast the accept. Re-check it from the raw tx before recording anything. */
export async function confirmAccept(ctx: ServerContext, challengeId: string, txid: string): Promise<ChallengeRecord> {
  const c = ctx.db.challenge(challengeId);
  if (!c) throw new UserError('no such challenge', 404);
  if (c.status !== 'awaiting_accept') {
    if (c.acceptTxid === txid) return c; // idempotent
    throw new UserError(`challenge is ${c.status}`, 409);
  }
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new UserError('txid must be 64 lowercase hex chars');
  const o = ctx.db.offer(c.offerId)!;
  let raw: string | undefined;
  try {
    raw = await ctx.provider.getRawTransaction(txid);
  } catch {
    raw = undefined;
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new UserError('accept transaction not found yet; retry in a few seconds', 404);
  }
  const tx = decodeVerified(txid, raw);
  const in0 = tx.inputs[0];
  if (!in0 || binToHex(in0.outpointTransactionHash) !== o.txid || in0.outpointIndex !== o.vout) {
    throw new UserError('that transaction does not spend this offer');
  }
  const want = binToHex(escrowLockingBytecode(escrowArgsFor(o.params, c.terms)));
  const out0 = tx.outputs[0];
  const total = o.params.bondAmount + o.params.feeAmount;
  if (
    !out0 || binToHex(out0.lockingBytecode) !== want || !out0.token || out0.token.nft ||
    binToHex(out0.token.category) !== o.params.tokenCategory || out0.token.amount !== total ||
    out0.valueSatoshis !== c.escrowSatoshis
  ) {
    throw new UserError('output 0 is not the escrow for this challenge');
  }
  const updated = ctx.db.updateChallenge(c.id, {
    status: 'accepted', acceptTxid: txid, escrow: { txid, vout: 0, satoshis: out0.valueSatoshis },
  });
  ctx.db.updateOffer(o.id, { status: 'accepted', challengeId: c.id, closeTxid: txid });
  for (const other of ctx.db.challenges.filter((x) => x.offerId === o.id && x.id !== c.id && x.status === 'awaiting_accept')) {
    ctx.db.updateChallenge(other.id, { status: 'abandoned', lastError: 'another challenger accepted this offer first' });
  }
  return updated;
}

// ---------------------------------------------------------------------------------------------
// agent + verifier
// ---------------------------------------------------------------------------------------------

const inFlight = new Set<string>();

/** Ask the live agent and commit its answer. Never computes or sees an expected answer. */
export async function runAgent(ctx: ServerContext, challengeId: string): Promise<void> {
  const c = ctx.db.challenge(challengeId);
  if (!c || c.status !== 'accepted' || ctx.answers.get(c.id) || inFlight.has(c.id)) return;
  if (!ctx.llm) {
    ctx.db.updateChallenge(c.id, { lastError: 'agent offline (no LLM key); this will end as no-response at the deadline' });
    return;
  }
  inFlight.add(c.id);
  try {
    const spec = parseCanonical(c.spec) as ChallengeSpec;
    if (validateSpecShape(spec).length) throw new Error('stored spec is invalid');
    const height = await ctx.provider.getBlockHeight();
    await answerChallenge({
      spec, challengeId: c.id, store: ctx.answers, client: ctx.llm.client, model: ctx.llm.model,
      currentHeight: height, answerDeadline: Number(c.terms.expiryHeight - ctx.db.offer(c.offerId)!.params.verifierGraceBlocks),
      chain: ctx.provider,
    });
    ctx.db.updateChallenge(c.id, { status: 'answered', lastError: null });
  } catch (e) {
    ctx.db.updateChallenge(c.id, { lastError: `agent: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    inFlight.delete(c.id);
  }
}

function verifierChallenge(ctx: ServerContext, c: ChallengeRecord): VerifierChallenge {
  const o = ctx.db.offer(c.offerId)!;
  return { network: c.network, offer: o.params, terms: c.terms, specJson: c.spec, escrow: c.escrow! };
}

let ticking = false;

/** One pass over live challenges: settle, refund, or wait. Safe to call often. */
export async function verifierTick(ctx: ServerContext, onlyId?: string): Promise<void> {
  if (ticking || !ctx.verifier) return;
  ticking = true;
  try {
    const live = ctx.db.challenges.filter((c) => (c.status === 'accepted' || c.status === 'answered') && c.escrow && (!onlyId || c.id === onlyId));
    for (const c of live) {
      if (c.status === 'accepted' && !ctx.answers.get(c.id)) void runAgent(ctx, c.id);
      const out = await runVerifier(verifierChallenge(ctx, c), ctx.answers.get(c.id), {
        provider: ctx.provider, verifierPrivateKey: ctx.verifier.verifierPrivateKey, feeWallet: ctx.verifier.feeWallet,
      });
      switch (out.kind) {
        case 'settled':
          ctx.db.updateChallenge(c.id, { status: 'settled', verdict: out.verdict, settleTxid: out.txid, evidence: out.evidence, lastError: null });
          break;
        case 'timed_out':
          ctx.db.updateChallenge(c.id, { status: 'timed_out', timeoutTxid: out.txid, lastError: null });
          break;
        case 'refused':
        case 'error':
          ctx.db.updateChallenge(c.id, { lastError: `verifier: ${out.reason}` });
          break;
        case 'already_spent':
          ctx.db.updateChallenge(c.id, { lastError: 'escrow already spent; check the explorer' });
          break;
        case 'wait':
          break;
      }
    }
    // prepared challenges nobody accepted within an hour are dropped from the arena
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const c of ctx.db.challenges.filter((x) => x.status === 'awaiting_accept' && Date.parse(x.createdAt) < cutoff)) {
      ctx.db.updateChallenge(c.id, { status: 'abandoned' });
    }
  } finally {
    ticking = false;
  }
}

/** After an accept: let the agent answer, then let the verifier settle right away. */
export async function afterAccept(ctx: ServerContext, challengeId: string) {
  await runAgent(ctx, challengeId);
  await verifierTick(ctx, challengeId);
}

// ---------------------------------------------------------------------------------------------
// mocknet dev helper: simulate a challenger's wallet (never on chipnet or mainnet)
// ---------------------------------------------------------------------------------------------

export async function devSimulateAccept(ctx: ServerContext, offerId: string, spec: unknown): Promise<ChallengeRecord> {
  if (ctx.config.network !== 'mocknet' || !ctx.devChallenger || !(ctx.provider instanceof MockNetworkProvider)) {
    throw new UserError('dev accept only exists on mocknet', 403);
  }
  const ch = ctx.devChallenger;
  const { challenge, bundle } = await prepareChallenge(ctx, { offerId, spec, challengerAddress: ch.address });
  const o = ctx.db.offer(offerId)!;
  const c = makeOfferContract(o.params, ctx.provider);
  const utxos = await ctx.provider.getUtxosForLockingBytecode(ch.lock);
  const tokenUtxo = utxos.find((u) => u.token?.category === o.params.tokenCategory && u.token.amount >= o.params.feeAmount);
  if (!tokenUtxo) throw new UserError('dev challenger is out of tokens; restart the dev server', 409);
  // like a wallet: use the token UTXO's own sats first, add a BCH-only input only when needed
  const bch = utxos.filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
  const base = {
    provider: ctx.provider, offer: o.params, offerContract: c, offerUtxo: offerUtxo(o, c.lockingBytecode),
    terms: challenge.terms, escrowArgs: escrowArgsFor(o.params, challenge.terms),
    challengerTokenInput: { utxo: tokenUtxo, unlocker: ch.template.unlockP2PKH() },
    escrowSatoshis: BigInt(bundle.escrowSatoshis), locktime: bundle.locktime,
  };
  let b;
  try {
    b = buildAccept(base);
  } catch (e) {
    if (!bch || !(e instanceof Error) || !e.message.startsWith('not enough BCH')) throw e;
    b = buildAccept({ ...base, bchFeeInput: { utxo: bch, unlocker: ch.template.unlockP2PKH() } });
  }
  const { txid } = await b.send();
  return confirmAccept(ctx, challenge.id, txid);
}

// ---------------------------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------------------------

export function offerView(ctx: ServerContext, o: OfferRecord): OfferView {
  return {
    id: o.id, agentId: o.agentId, agentName: ctx.db.agent(o.agentId)?.name ?? o.agentId, network: o.network,
    txid: o.txid, vout: o.vout, satoshis: o.satoshis.toString(), status: o.status, params: offerParamsToWire(o.params),
    challengeId: o.challengeId, closeTxid: o.closeTxid, createdAt: o.createdAt,
  };
}

export function challengeView(ctx: ServerContext, c: ChallengeRecord): ChallengeView {
  const o = ctx.db.offer(c.offerId)!;
  const a = ctx.answers.get(c.id);
  const spec = JSON.parse(c.spec) as ChallengeSpec;
  return {
    id: c.id, status: c.status, network: c.network, templateId: c.templateId, spec, specJson: c.spec, prompt: renderPrompt(spec),
    offerId: c.offerId, agentId: c.agentId, agentName: ctx.db.agent(c.agentId)?.name ?? c.agentId,
    challengerAddress: c.challengerAddress, bondAmount: o.params.bondAmount.toString(), feeAmount: o.params.feeAmount.toString(),
    tokenCategory: o.params.tokenCategory, expiryHeight: Number(c.terms.expiryHeight),
    answerDeadline: answerDeadlineOf({ network: c.network, offer: o.params, terms: c.terms, specJson: c.spec, escrow: { txid: '', vout: 0, satoshis: 0n } }),
    acceptTxid: c.acceptTxid,
    escrow: c.escrow ? { txid: c.escrow.txid, vout: c.escrow.vout, satoshis: c.escrow.satoshis.toString() } : null,
    answer: a
      ? {
          source: a.source, modelId: a.modelId, canonicalAnswer: a.canonicalAnswer, rawResponse: a.rawResponse,
          rawResponseHash: a.rawResponseHash, answerHash: a.answerHash, toolCalls: a.toolCalls ?? [],
          committedAtHeight: a.committedAtHeight, committedAtWAT: a.committedAtWAT,
        }
      : null,
    verdict: c.verdict, settleTxid: c.settleTxid, timeoutTxid: c.timeoutTxid, evidence: c.evidence, lastError: c.lastError,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

const visible = (c: ChallengeRecord) => c.status !== 'awaiting_accept' && c.status !== 'abandoned';

function tally(list: readonly ChallengeRecord[]) {
  const shown = list.filter(visible);
  return {
    total: shown.length,
    live: shown.filter((c) => c.status === 'accepted' || c.status === 'answered').length,
    pass: shown.filter((c) => c.verdict === 'PASS').length,
    fail: shown.filter((c) => c.verdict === 'FAIL').length,
    noResponse: shown.filter((c) => c.verdict === 'NORESPONSE').length,
    timeout: shown.filter((c) => c.status === 'timed_out').length,
  };
}

export async function statsView(ctx: ServerContext): Promise<StatsView> {
  let height: number | null = null;
  try {
    height = await ctx.provider.getBlockHeight();
  } catch {
    height = null;
  }
  return {
    network: ctx.config.network, height,
    openOffers: ctx.db.offers.filter((o) => o.status === 'open').length,
    challenges: tally(ctx.db.challenges),
  };
}

export function recentChallenges(ctx: ServerContext, limit = 30): ChallengeView[] {
  return [...ctx.db.challenges].filter(visible).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((c) => challengeView(ctx, c));
}

export function agentView(ctx: ServerContext, id: string): AgentView | null {
  const a = ctx.db.agent(id);
  if (!a) return null;
  const mine = ctx.db.challenges.filter((c) => c.agentId === id);
  const t = tally(mine);
  const open = ctx.db.offers.filter((o) => o.agentId === id && o.status === 'open');
  const latest = [...ctx.db.offers].filter((o) => o.agentId === id).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  return {
    id: a.id, name: a.name, bio: a.bio, address: a.address, modelId: a.modelId,
    record: { challenges: t.total, pass: t.pass, fail: t.fail, noResponse: t.noResponse, timeout: t.timeout, live: t.live },
    policy: latest
      ? {
          bondAmount: latest.params.bondAmount.toString(), feeAmount: latest.params.feeAmount.toString(),
          maxDeadlineDelta: latest.params.maxDeadlineDelta.toString(), verifierGraceBlocks: latest.params.verifierGraceBlocks.toString(),
        }
      : null,
    openOffers: open.map((o) => offerView(ctx, o)),
    recent: mine.filter(visible).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 20).map((c) => challengeView(ctx, c)),
  };
}
