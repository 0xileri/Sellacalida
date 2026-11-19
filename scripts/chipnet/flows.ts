// Chipnet, mainnet and mocknet dry-run flows for the milestone 1 gate: genesis of a fungible test
// token (chipnet / mocknet only), then cancel, accept exact + settle PASS, accept change + settle
// FAIL, NORESPONSE, and timeout. Every scenario funds itself from the agent key in one transaction.
// Signing here uses local throwaway keys (SignatureTemplate); the WizardConnect wallet path is
// exercised by /connect. On mainnet the bond token is PUSD and amounts are cents (MAINNET_AMOUNTS).
import { binToHex, cashAddressToLockingBytecode, decodeCashAddress, decodeTransaction, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';
import {
  MockNetworkProvider,
  TransactionBuilder,
  type NetworkProvider,
  type SignatureTemplate,
  type SpendableUtxo,
} from 'cashscript';
import {
  MAINNET_AGENT_MAX_SATS, MAINNET_AGENT_MAX_TOKENS, MIN_OUTPUT_SATS, PUSD_CATEGORY_MAINNET, type SellacalidaNetwork, type Verdict,
} from '../../lib/constants';
import { lockingBytecodeToAddress, networkPrefix } from '../../lib/bch/address';
import { escrowArgsFor, makeEscrowContract, makeOfferContract, type ChallengeTerms, type OfferParams } from '../../lib/contracts';
import { buildAccept, buildCancel, buildSettle, buildTimeout, p2pkhLockingBytecode, withFee } from '../../lib/bch/transactions';
import { buildAttestation, sha256Utf8, signAttestation } from '../../lib/attestation';
import { explorerTxUrl } from '../../lib/bch/network';

export interface Key {
  label: string;
  priv: Uint8Array;
  pk: Uint8Array;
  pkh: Uint8Array;
  lock: Uint8Array;
  template: SignatureTemplate;
}

export interface FlowContext {
  network: SellacalidaNetwork;
  provider: NetworkProvider;
  agent: Key;
  challenger: Key;
  verifier: Key;
  feeWallet: Key;
  /** explorer-order hex; set after genesis */
  category?: string;
  log: (line: string) => void;
  /** resolves true once the chain height is >= h; false means "not yet, come back later" */
  reachHeight: (h: number) => Promise<boolean>;
  results: StepResult[];
  /** bond / fee sizes; CHIPNET_AMOUNTS when omitted */
  amounts?: Amounts;
}

/** Token base units per scenario. The change amounts exercise the accept change path. */
export interface Amounts {
  bond: bigint;
  fee: bigint;
  failChange: bigint;
  timeoutChange: bigint;
}

export interface StepResult {
  scenario: string;
  step: string;
  txid: string;
  url: string | null;
  note?: string;
}

export const OFFER_SATS = 3000n; // covers a ~1.14 kB cancel and still leaves >= MIN_OUTPUT_SATS
export const ESCROW_SATS = 3000n; // covers a self-funded settle (~0.93 kB) or timeout (~0.78 kB)
export const CHALLENGER_SATS = 4000n; // with OFFER_SATS this covers a ~1.9 kB accept
export const FEE_WALLET_SATS = 3000n;
export const TOKEN_SUPPLY = 1_000_000n;
export const BOND = 100n; // 1.00 in a 2-decimal token
export const FEE = 20n; // 0.20
export const CHIPNET_AMOUNTS: Amounts = { bond: BOND, fee: FEE, failChange: 35n, timeoutChange: 5n };
/** Mainnet uses real PUSD: a 0.05 bond and a 0.01 fee. A full run moves about 0.35 PUSD. */
export const MAINNET_AMOUNTS: Amounts = { bond: 5n, fee: 1n, failChange: 2n, timeoutChange: 1n };

// Mainnet caps for the runner. Bonds stay at cents. The throwaway keys live in a plaintext
// .env.local, so the runner refuses to spend from an agent holding more than the app's own mainnet
// hot-wallet cap (lib/constants.ts: 1,000,000 sats or 20.00 PUSD). Move any excess out with "sweep".
export const MAINNET_MAX_BOND = 10n;
export const MAINNET_MAX_AGENT_SATS = MAINNET_AGENT_MAX_SATS;
export const MAINNET_MAX_AGENT_TOKENS = MAINNET_AGENT_MAX_TOKENS;

function amountsOf(ctx: FlowContext): Amounts {
  return ctx.amounts ?? CHIPNET_AMOUNTS;
}

function record(ctx: FlowContext, scenario: string, step: string, txid: string, note?: string) {
  const r = { scenario, step, txid, url: explorerTxUrl(ctx.network, txid), ...(note ? { note } : {}) };
  ctx.results.push(r);
  ctx.log(`  ${scenario.padEnd(11)} ${step.padEnd(22)} ${txid}${note ? `  (${note})` : ''}`);
  return r;
}

async function utxosOf(ctx: FlowContext, key: Key) {
  return ctx.provider.getUtxosForLockingBytecode(key.lock);
}

async function height(ctx: FlowContext) {
  return ctx.provider.getBlockHeight();
}

function requireCategory(ctx: FlowContext): string {
  if (!ctx.category) throw new Error('no token category yet: run genesis first');
  return ctx.category;
}

// ---------------------------------------------------------------------------------------------
// genesis
// ---------------------------------------------------------------------------------------------

/** Mint TOKEN_SUPPLY of a new fungible category to the agent. Returns the explorer-order category. */
export async function genesis(ctx: FlowContext): Promise<string> {
  if (ctx.network === 'mainnet') throw new Error('mainnet bonds are PUSD only: no test token is minted on mainnet');
  let utxos = (await utxosOf(ctx, ctx.agent)).filter((u) => !u.token);
  let vout0 = utxos.find((u) => u.vout === 0 && u.satoshis >= 3000n);
  if (!vout0) {
    // consolidate into a fresh vout 0
    const total = utxos.reduce((a, u) => a + u.satoshis, 0n);
    if (total < 5000n) throw new Error(`agent has ${total} sats; fund it from the faucet first`);
    const { builder } = withFee((fee) => {
      const b = new TransactionBuilder({ provider: ctx.provider });
      for (const u of utxos) b.addInput(u, ctx.agent.template.unlockP2PKH());
      b.addOutput({ to: ctx.agent.lock, amount: total - fee });
      return b;
    }, 0, 1.1);
    const sent = await builder.send();
    record(ctx, 'genesis', 'make vout0', sent.txid);
    utxos = (await utxosOf(ctx, ctx.agent)).filter((u) => !u.token);
    vout0 = utxos.find((u) => u.vout === 0 && u.txid === sent.txid);
    if (!vout0) throw new Error('vout0 UTXO not visible after consolidation; retry in a few seconds');
  }
  const category = vout0.txid; // genesis: category id = outpoint txid of input 0 (vout 0)
  const others = utxos.filter((u) => u !== vout0);
  const inSats = vout0.satoshis + others.reduce((a, u) => a + u.satoshis, 0n);
  const { builder } = withFee((fee) => {
    const b = new TransactionBuilder({ provider: ctx.provider });
    b.addInput(vout0!, ctx.agent.template.unlockP2PKH());
    for (const u of others) b.addInput(u, ctx.agent.template.unlockP2PKH());
    b.addOutput({ to: ctx.agent.lock, amount: MIN_OUTPUT_SATS, token: { category, amount: TOKEN_SUPPLY } });
    b.addOutput({ to: ctx.agent.lock, amount: inSats - MIN_OUTPUT_SATS - fee });
    return b;
  }, 0, 1.1);
  const sent = await builder.send();
  record(ctx, 'genesis', 'mint test token', sent.txid, `category ${category}`);
  ctx.category = category;
  return category;
}

// ---------------------------------------------------------------------------------------------
// funding: one agent tx creates the offer UTXO (token into P2SH32) and the challenger's inputs
// ---------------------------------------------------------------------------------------------

interface Funding {
  offerUtxo: SpendableUtxo;
  challengerTokenUtxo?: SpendableUtxo;
  feeWalletUtxo?: SpendableUtxo;
}

async function fund(
  ctx: FlowContext,
  scenario: string,
  offer: OfferParams,
  opts: { challengerTokens?: bigint; feeWallet?: boolean },
): Promise<Funding> {
  const category = requireCategory(ctx);
  const offerContract = makeOfferContract(offer, ctx.provider);
  const all = await utxosOf(ctx, ctx.agent);
  const tokenIns = all.filter((u) => u.token?.category === category && !u.token.nft);
  const bchIns = all.filter((u) => !u.token);
  const tokenTotal = tokenIns.reduce((a, u) => a + u.token!.amount, 0n);
  const needTokens = offer.bondAmount + (opts.challengerTokens ?? 0n);
  if (tokenTotal < needTokens) throw new Error(`agent has ${tokenTotal} tokens, needs ${needTokens}`);
  const inSats = [...tokenIns, ...bchIns].reduce((a, u) => a + u.satoshis, 0n);
  const fixedOut =
    OFFER_SATS + (opts.challengerTokens ? CHALLENGER_SATS : 0n) + (opts.feeWallet ? FEE_WALLET_SATS : 0n) +
    (tokenTotal > needTokens ? MIN_OUTPUT_SATS : 0n);

  const { builder } = withFee((fee) => {
    const b = new TransactionBuilder({ provider: ctx.provider });
    for (const u of [...tokenIns, ...bchIns]) b.addInput(u, ctx.agent.template.unlockP2PKH());
    b.addOutput({ to: hexToBin(offerContract.lockingBytecode), amount: OFFER_SATS, token: { category, amount: offer.bondAmount } });
    if (opts.challengerTokens) {
      b.addOutput({ to: ctx.challenger.lock, amount: CHALLENGER_SATS, token: { category, amount: opts.challengerTokens } });
    }
    if (opts.feeWallet) b.addOutput({ to: ctx.feeWallet.lock, amount: FEE_WALLET_SATS });
    if (tokenTotal > needTokens) {
      b.addOutput({ to: ctx.agent.lock, amount: MIN_OUTPUT_SATS, token: { category, amount: tokenTotal - needTokens } });
    }
    b.addOutput({ to: ctx.agent.lock, amount: inSats - fixedOut - fee });
    return b;
  }, 0, 1.1);
  if (inSats - fixedOut < 2000n) throw new Error(`agent is short on BCH (${inSats} sats); top up from the faucet`);
  const sent = await builder.send();
  record(ctx, scenario, 'fund offer (P2SH32)', sent.txid);
  const txid = sent.txid;
  const offerUtxo: SpendableUtxo = {
    txid, vout: 0, satoshis: OFFER_SATS, token: { category, amount: offer.bondAmount },
    lockingBytecode: offerContract.lockingBytecode,
  };
  let vout = 1;
  const f: Funding = { offerUtxo };
  if (opts.challengerTokens) {
    f.challengerTokenUtxo = {
      txid, vout: vout++, satoshis: CHALLENGER_SATS, token: { category, amount: opts.challengerTokens },
      lockingBytecode: binToHex(ctx.challenger.lock),
    };
  }
  if (opts.feeWallet) {
    f.feeWalletUtxo = { txid, vout: vout++, satoshis: FEE_WALLET_SATS, lockingBytecode: binToHex(ctx.feeWallet.lock) };
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------------------------

function offerParams(ctx: FlowContext, short = false): OfferParams {
  const a = amountsOf(ctx);
  if (ctx.network === 'mainnet' && (a.bond > MAINNET_MAX_BOND || a.fee > MAINNET_MAX_BOND)) {
    throw new Error(`mainnet bond and fee are capped at ${MAINNET_MAX_BOND} base units`);
  }
  return {
    agentPkh: ctx.agent.pkh,
    verifierPk: ctx.verifier.pk,
    bondAmount: a.bond,
    feeAmount: a.fee,
    tokenCategory: requireCategory(ctx),
    network: ctx.network,
    // short windows make NORESPONSE (1 block) and timeout (19 blocks) practical on chipnet
    maxDeadlineDelta: short ? 19n : 144n,
    verifierGraceBlocks: 18n,
  };
}

function termsFor(ctx: FlowContext, scenario: string, expiryHeight: number): ChallengeTerms {
  const spec = JSON.stringify({ network: ctx.network, params: { scenario }, templateId: 'math.exact_result', version: 1 });
  return {
    challengerPkh: ctx.challenger.pkh,
    challengeId: sha256.hash(utf8ToBin(`${scenario}:${Date.now()}:${Math.random()}`)),
    specHash: sha256.hash(utf8ToBin(spec)),
    expiryHeight: BigInt(expiryHeight),
  };
}

export async function scenarioCancel(ctx: FlowContext) {
  const offer = offerParams(ctx);
  const { offerUtxo } = await fund(ctx, 'cancel', offer, {});
  const offerContract = makeOfferContract(offer, ctx.provider);
  const b = buildCancel({
    provider: ctx.provider, offer, offerContract, offerUtxo, agentPk: ctx.agent.pk, agentSig: ctx.agent.template,
  });
  record(ctx, 'cancel', 'cancel (agent checkSig)', (await b.send()).txid);
}

/**
 * Cancel any bond still sitting in this runner's offer contracts (the normal and the short-window
 * terms) back to the agent, for example after a run stopped between "fund offer" and "accept".
 * Only coins holding exactly the bond in the bond token can take the cancel path; others are listed
 * and left alone. Returns the cancel txids.
 */
export async function reclaimOffers(ctx: FlowContext): Promise<string[]> {
  const txids: string[] = [];
  for (const short of [false, true]) {
    const offer = offerParams(ctx, short);
    const offerContract = makeOfferContract(offer, ctx.provider);
    for (const u of await offerContract.getUtxos()) {
      if (u.token?.category !== offer.tokenCategory || u.token.amount !== offer.bondAmount || u.token.nft) {
        ctx.log(`  reclaim     skipping ${u.txid}:${u.vout} (${u.satoshis} sats, not exactly the bond)`);
        continue;
      }
      const b = buildCancel({
        provider: ctx.provider, offer, offerContract, offerUtxo: u, agentPk: ctx.agent.pk, agentSig: ctx.agent.template,
      });
      const txid = (await b.send()).txid;
      record(ctx, 'reclaim', 'cancel a leftover offer', txid, `was ${u.txid.slice(0, 12)}...:${u.vout}`);
      txids.push(txid);
    }
  }
  if (txids.length === 0) ctx.log('  reclaim     no leftover offers');
  return txids;
}

export interface PendingEscrow {
  scenario: string;
  kind: 'noresponse' | 'timeout';
  offer: OfferParams;
  terms: ChallengeTerms;
  escrowTxid: string;
  readyAt: number;
}

async function acceptStep(ctx: FlowContext, scenario: string, offer: OfferParams, challengerTokens: bigint, expiryOffset: number, feeWallet = false) {
  const f = await fund(ctx, scenario, offer, { challengerTokens, feeWallet });
  const h = await height(ctx);
  const terms = termsFor(ctx, scenario, h + expiryOffset);
  const escrowArgs = escrowArgsFor(offer, terms);
  const b = buildAccept({
    provider: ctx.provider, offer, offerContract: makeOfferContract(offer, ctx.provider), offerUtxo: f.offerUtxo,
    terms, escrowArgs,
    challengerTokenInput: { utxo: f.challengerTokenUtxo!, unlocker: ctx.challenger.template.unlockP2PKH() },
    escrowSatoshis: ESCROW_SATS, locktime: h,
  });
  const path = challengerTokens === offer.feeAmount ? 'exact' : `change ${challengerTokens - offer.feeAmount}`;
  const sent = await b.send();
  record(ctx, scenario, `accept (${path})`, sent.txid, `expiry ${terms.expiryHeight}`);
  return { terms, escrowArgs, escrowTxid: sent.txid, feeWalletUtxo: f.feeWalletUtxo };
}

async function settleStep(
  ctx: FlowContext, scenario: string, offer: OfferParams, terms: ChallengeTerms, escrowTxid: string,
  verdict: Verdict, opts: { locktime?: number; feeWalletUtxo?: SpendableUtxo } = {},
) {
  const escrowArgs = escrowArgsFor(offer, terms);
  const escrowContract = makeEscrowContract(escrowArgs, ctx.provider);
  const escrowUtxo: SpendableUtxo = {
    txid: escrowTxid, vout: 0, satoshis: ESCROW_SATS,
    token: { category: offer.tokenCategory, amount: offer.bondAmount + offer.feeAmount },
    lockingBytecode: escrowContract.lockingBytecode,
  };
  const message = buildAttestation({
    network: ctx.network, challengeId: terms.challengeId, escrowTxid, escrowVout: 0, specHash: terms.specHash,
    verdict, answerHash: verdict === 'NORESPONSE' ? undefined : sha256Utf8(verdict === 'PASS' ? '7' : '8'),
  });
  const b = buildSettle({
    provider: ctx.provider, escrowContract, escrowUtxo, escrowArgs, tokenCategory: offer.tokenCategory,
    winnerPkh: verdict === 'PASS' ? offer.agentPkh : terms.challengerPkh,
    message, signature: signAttestation(message, ctx.verifier.priv),
    ...(opts.locktime !== undefined ? { locktime: opts.locktime } : {}),
    ...(opts.feeWalletUtxo
      ? {
          feeLockingBytecode: ctx.feeWallet.lock,
          bchFeeInput: { utxo: opts.feeWalletUtxo, unlocker: ctx.feeWallet.template.unlockP2PKH() },
        }
      : {}),
  });
  const shape = opts.feeWalletUtxo ? '2-output' : '1-output';
  record(ctx, scenario, `settle ${verdict} (${shape})`, (await b.send()).txid, `attestation ${binToHex(message).slice(0, 16)}...`);
}

export async function scenarioPass(ctx: FlowContext) {
  const offer = offerParams(ctx);
  const a = await acceptStep(ctx, 'pass', offer, offer.feeAmount, 100);
  await settleStep(ctx, 'pass', offer, a.terms, a.escrowTxid, 'PASS');
}

export async function scenarioFail(ctx: FlowContext) {
  const offer = offerParams(ctx);
  const a = await acceptStep(ctx, 'fail', offer, offer.feeAmount + amountsOf(ctx).failChange, 100, true);
  await settleStep(ctx, 'fail', offer, a.terms, a.escrowTxid, 'FAIL', { feeWalletUtxo: a.feeWalletUtxo });
}

/** Accept with a short window and return what must be finished once the height is reached. */
export async function scenarioStartShort(ctx: FlowContext, kind: 'noresponse' | 'timeout'): Promise<PendingEscrow> {
  const offer = offerParams(ctx, true);
  const a = await acceptStep(ctx, kind, offer, offer.feeAmount + (kind === 'timeout' ? amountsOf(ctx).timeoutChange : 0n), 19);
  const readyAt = kind === 'noresponse'
    ? Number(a.terms.expiryHeight - offer.verifierGraceBlocks)
    : Number(a.terms.expiryHeight);
  ctx.log(`  ${kind.padEnd(11)} waiting for height ${readyAt}`);
  return { scenario: kind, kind, offer, terms: a.terms, escrowTxid: a.escrowTxid, readyAt };
}

/**
 * Wait until the chain reaches `target` (with `wait`), or check once (without). While waiting, a
 * dropped Electrum connection is retried every minute, up to `maxFailures` times in a row, instead
 * of ending the run one block early; a height line is printed only when the height changes.
 */
export async function waitForHeight(
  getHeight: () => Promise<number>,
  target: number,
  opts: { wait: boolean; log: (line: string) => void; sleep?: (ms: number) => Promise<void>; maxFailures?: number },
): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxFailures = opts.maxFailures ?? 10;
  let failures = 0;
  let last: number | null = null;
  for (;;) {
    let now: number;
    try {
      now = await getHeight();
      failures = 0;
    } catch (e) {
      failures += 1;
      if (!opts.wait || failures > maxFailures) throw e;
      opts.log(`  connection to the Electrum server dropped (${e instanceof Error ? e.message : String(e)}); retrying in a minute (${failures}/${maxFailures})`);
      await sleep(60_000);
      continue;
    }
    if (now >= target) return true;
    if (!opts.wait) {
      opts.log(`  height ${now} < ${target}: run "pending" again later (or add --wait)`);
      return false;
    }
    if (now !== last) opts.log(`  height ${now}, waiting for ${target} (${target - now} more block${target - now === 1 ? '' : 's'})...`);
    last = now;
    await sleep(60_000);
  }
}

/** Finish a pending NORESPONSE or timeout. Returns false if the chain is not there yet. */
export async function finishPending(ctx: FlowContext, p: PendingEscrow): Promise<boolean> {
  if (!(await ctx.reachHeight(p.readyAt))) return false;
  if (p.kind === 'noresponse') {
    await settleStep(ctx, p.scenario, p.offer, p.terms, p.escrowTxid, 'NORESPONSE', { locktime: p.readyAt });
    return true;
  }
  const escrowArgs = escrowArgsFor(p.offer, p.terms);
  const escrowContract = makeEscrowContract(escrowArgs, ctx.provider);
  const escrowUtxo: SpendableUtxo = {
    txid: p.escrowTxid, vout: 0, satoshis: ESCROW_SATS,
    token: { category: p.offer.tokenCategory, amount: p.offer.bondAmount + p.offer.feeAmount },
    lockingBytecode: escrowContract.lockingBytecode,
  };
  const b = buildTimeout({
    provider: ctx.provider, escrowContract, escrowUtxo, escrowArgs, tokenCategory: p.offer.tokenCategory,
    locktime: p.readyAt,
  });
  record(ctx, p.scenario, 'timeout refund', (await b.send()).txid);
  return true;
}

// ---------------------------------------------------------------------------------------------
// mainnet safety: hot-wallet caps, a readable summary before each broadcast, and a sweep
// ---------------------------------------------------------------------------------------------

/** Throws unless the agent hot wallet is within the mainnet caps. Returns its balances. */
export async function checkMainnetCaps(ctx: FlowContext) {
  const utxos = await utxosOf(ctx, ctx.agent);
  const sats = utxos.reduce((a, u) => a + u.satoshis, 0n);
  const tokens = utxos.filter((u) => u.token?.category === ctx.category).reduce((a, u) => a + u.token!.amount, 0n);
  if (sats > MAINNET_MAX_AGENT_SATS || tokens > MAINNET_MAX_AGENT_TOKENS) {
    throw new Error(
      `the agent holds ${sats} sats and ${tokens} token base units, over the mainnet runner caps ` +
        `(${MAINNET_MAX_AGENT_SATS} sats, ${MAINNET_MAX_AGENT_TOKENS} base units). Keep this throwaway key tiny: ` +
        'move the excess out with "sweep <your address>" and fund it again with less.',
    );
  }
  return { sats, tokens };
}

/** One line per output, for the y/N prompt before a mainnet broadcast. */
export function describeTx(hex: string, network: SellacalidaNetwork): string {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') return `  (could not decode: ${tx})`;
  const lines = tx.outputs.map((o, i) => {
    let to: string;
    try {
      to = lockingBytecodeToAddress(o.lockingBytecode, network);
    } catch {
      to = `script ${binToHex(o.lockingBytecode).slice(0, 24)}...`;
    }
    let token = '';
    if (o.token) {
      const cat = binToHex(o.token.category);
      const name = cat === PUSD_CATEGORY_MAINNET ? 'PUSD' : `token ${cat.slice(0, 8)}...`;
      token = ` + ${o.token.amount} ${name} base units${o.token.nft ? ' + NFT' : ''}`;
    }
    return `  out ${i}: ${o.valueSatoshis} sats${token} -> ${to}`;
  });
  return [`  ${hex.length / 2} bytes, ${tx.inputs.length} inputs, ${tx.outputs.length} outputs`, ...lines].join('\n');
}

/**
 * Wrap a provider so every broadcast prints its outputs and needs a "y" first. Reads, heights and
 * everything else pass straight through. Every TransactionBuilder in these flows broadcasts through
 * provider.sendRawTransaction, so nothing reaches the network without an answer here.
 */
export function confirmingProvider(
  inner: NetworkProvider,
  network: SellacalidaNetwork,
  ask: (question: string) => Promise<boolean>,
  log: (line: string) => void = console.log,
): NetworkProvider {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'sendRawTransaction') {
        return async (hex: string) => {
          log(`\nAbout to broadcast on ${network.toUpperCase()}:\n${describeTx(hex, network)}`);
          if (!(await ask('Broadcast this transaction? [y/N] '))) throw new Error('broadcast declined; nothing was sent');
          return target.sendRawTransaction(hex);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export interface SweepDestination {
  lock: Uint8Array;
  /** a token-aware (z...) address: the wallet behind it says it can hold CashTokens */
  tokenAware: boolean;
}

/**
 * Validate a sweep destination: a CashAddress on this network, not one of the runner's own
 * throwaway keys (that would leave the money in the plaintext .env.local).
 */
export function parseSweepDestination(address: string, network: SellacalidaNetwork, ownKeys: Key[]): SweepDestination {
  const prefix = networkPrefix(network);
  const full = address.includes(':') ? address : `${prefix}:${address}`;
  const decoded = cashAddressToLockingBytecode(full);
  if (typeof decoded === 'string') throw new Error(`not a CashAddress: ${decoded}`);
  if (decoded.prefix !== prefix) throw new Error(`${address} is not a ${network} address`);
  if (ownKeys.some((k) => binToHex(k.lock) === binToHex(decoded.bytecode))) {
    throw new Error('that is one of the runner\'s own throwaway keys; sweep to your own wallet instead');
  }
  const info = decodeCashAddress(full);
  const tokenAware = typeof info !== 'string' && info.type.endsWith('WithTokens');
  return { lock: decoded.bytecode, tokenAware };
}

/**
 * Send everything the given keys hold (BCH and tokens) to one destination, for example your own
 * wallet at the end of a mainnet run. Escrows that are still open are not swept; finish them first.
 * Tokens only go to a token-aware address: a wallet without CashTokens support can burn them.
 */
export async function sweep(ctx: FlowContext, keys: Key[], to: SweepDestination): Promise<string | null> {
  const toLock = to.lock;
  const ins: { u: SpendableUtxo; k: Key }[] = [];
  for (const k of keys) for (const u of await utxosOf(ctx, k)) ins.push({ u, k });
  if (ins.length === 0) {
    ctx.log('  nothing to sweep');
    return null;
  }
  const fungible = new Map<string, bigint>();
  for (const { u } of ins) {
    if (u.token && !u.token.nft) fungible.set(u.token.category, (fungible.get(u.token.category) ?? 0n) + u.token.amount);
  }
  const nfts = ins.filter((x) => x.u.token?.nft);
  if ((fungible.size > 0 || nfts.length > 0) && !to.tokenAware) {
    throw new Error(
      'there are tokens to sweep: use your wallet\'s token-aware address (bitcoincash:z... on mainnet) so a wallet ' +
        'without CashTokens support cannot burn them',
    );
  }
  const inSats = ins.reduce((a, x) => a + x.u.satoshis, 0n);
  const fixedOut = BigInt(fungible.size + nfts.length) * MIN_OUTPUT_SATS;
  const { builder, fee } = withFee((f) => {
    const b = new TransactionBuilder({ provider: ctx.provider });
    for (const { u, k } of ins) b.addInput(u, k.template.unlockP2PKH());
    for (const [category, amount] of fungible) b.addOutput({ to: toLock, amount: MIN_OUTPUT_SATS, token: { category, amount } });
    for (const { u } of nfts) b.addOutput({ to: toLock, amount: MIN_OUTPUT_SATS, token: u.token! });
    b.addOutput({ to: toLock, amount: inSats - fixedOut - f });
    return b;
  }, 0, 1.1);
  if (inSats - fixedOut - fee < MIN_OUTPUT_SATS) {
    throw new Error(`not enough BCH to sweep: ${inSats} sats in, ${fixedOut} needed for token outputs plus a ${fee} sat fee`);
  }
  const txid = (await builder.send()).txid;
  record(ctx, 'sweep', 'sweep to your wallet', txid, `${ins.length} inputs`);
  return txid;
}

// ---------------------------------------------------------------------------------------------
// mocknet dry run support
// ---------------------------------------------------------------------------------------------

export function seedMocknet(provider: MockNetworkProvider, agent: Key, sats = 100_000n) {
  provider.addUtxo(binToHex(agent.lock), {
    txid: binToHex(sha256.hash(utf8ToBin('mocknet-faucet'))), vout: 0, satoshis: sats,
  });
}

export { p2pkhLockingBytecode };
