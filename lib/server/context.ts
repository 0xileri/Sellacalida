// One server context per Node process: config, chain provider, DB, answer store, LLM and keys.
// Tests swap in their own with setServerContext().
import { binToHex, decodePrivateKeyWif, generatePrivateKey, hash160, sha256, utf8ToBin, secp256k1 } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, type NetworkProvider } from 'cashscript';
import { join } from 'node:path';
import { llmFromEnv, type LlmClient } from '../agent/llm';
import { pkhToCashAddress } from '../bch/address';
import { makeProvider } from '../bch/network';
import { p2pkhLockingBytecode } from '../bch/transactions';
import { AnswerStore } from '../store/answers';
import { loadVerifierKeys } from '../verifier/keys';
import { loadConfig, type ServerConfig } from './config';
import { Db } from './db';

export interface KeyPair {
  priv: Uint8Array;
  pk: Uint8Array;
  pkh: Uint8Array;
  lock: Uint8Array;
  address: string;
  template: SignatureTemplate;
}

export interface ServerContext {
  config: ServerConfig;
  provider: NetworkProvider;
  db: Db;
  answers: AnswerStore;
  llm: { client: LlmClient; model: string } | null;
  verifier: { verifierPrivateKey: Uint8Array; verifierPk: Uint8Array; feeWallet?: { template: SignatureTemplate; lock: Uint8Array } } | null;
  agentKey: KeyPair | null;
  /** mocknet only: a throwaway challenger for the dev "simulate accept" route */
  devChallenger: KeyPair | null;
  /** process-wide runtime guards, kept on the shared context (see getServerContext) */
  runtime: { ticking: boolean; inFlight: Set<string>; lastAutoOfferError: number };
}

export function keyPair(priv: Uint8Array, network: ServerConfig['network']): KeyPair {
  const pk = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pk === 'string') throw new Error(pk);
  const pkh = hash160(pk);
  return { priv, pk, pkh, lock: p2pkhLockingBytecode(pkh), address: pkhToCashAddress(pkh, network), template: new SignatureTemplate(priv) };
}

function decodeWif(name: string, wif: string): Uint8Array {
  const d = decodePrivateKeyWif(wif.trim());
  if (typeof d === 'string') throw new Error(`${name}: ${d}`);
  return d.privateKey;
}

export function buildContextFromEnv(env: Record<string, string | undefined> = process.env): ServerContext {
  const config = loadConfig(env);
  const mocknet = config.network === 'mocknet';
  const provider = makeProvider(config.network, config.electrumHostname);
  // mocknet state lives in memory only, so its DB does too; real networks get one file each
  const db = new Db(mocknet ? undefined : join(config.dataDir, `${config.network}-db.json`));
  const answers = new AnswerStore(mocknet ? undefined : join(config.dataDir, `${config.network}-answers.json`));

  let llm: ServerContext['llm'] = null;
  try {
    llm = llmFromEnv(env);
  } catch {
    llm = null; // agent offline: challenges end NORESPONSE at the deadline
  }

  let verifier: ServerContext['verifier'] = null;
  if (env.VERIFIER_PRIVATE_KEY || mocknet) {
    const keys = env.VERIFIER_PRIVATE_KEY
      ? loadVerifierKeys(env)
      : { verifierPrivateKey: sha256.hash(utf8ToBin('sellacalida-mocknet-dev-verifier')), feeWallet: undefined };
    const vpk = secp256k1.derivePublicKeyCompressed(keys.verifierPrivateKey);
    if (typeof vpk === 'string') throw new Error(vpk);
    verifier = { ...keys, verifierPk: vpk };
  }

  const agentPriv = config.agent.wif
    ? decodeWif('AGENT_WIF', config.agent.wif)
    : mocknet
      ? sha256.hash(utf8ToBin('sellacalida-mocknet-dev-agent'))
      : null;
  const agentKey = agentPriv ? keyPair(agentPriv, config.network) : null;
  const devChallenger = mocknet ? keyPair(generatePrivateKey(), config.network) : null;

  const ctx: ServerContext = {
    config, provider, db, answers, llm, verifier, agentKey, devChallenger,
    runtime: { ticking: false, inFlight: new Set(), lastAutoOfferError: 0 },
  };
  if (mocknet) seedMocknet(ctx, provider as MockNetworkProvider);
  return ctx;
}

/** Mocknet dev: give the agent and the dev challenger some BCH and test tokens. */
function seedMocknet(ctx: ServerContext, provider: MockNetworkProvider) {
  provider.setBlockHeight(300_000);
  // play money: enough for a few hundred challenges on a public preview before a restart
  const fund = (k: KeyPair, label: string, tokens: bigint) => {
    const txid = (i: number) => binToHex(sha256.hash(utf8ToBin(`mocknet-seed:${label}:${i}`)));
    provider.addUtxo(binToHex(k.lock), { txid: txid(0), vout: 0, satoshis: 5_000_000n });
    provider.addUtxo(binToHex(k.lock), { txid: txid(1), vout: 0, satoshis: 5_000n, token: { category: ctx.config.tokenCategory, amount: tokens } });
  };
  if (ctx.agentKey) fund(ctx.agentKey, 'agent', 1_000_000n);
  if (ctx.devChallenger) fund(ctx.devChallenger, 'challenger', 100_000n);
}

// Next.js bundles instrumentation.ts (the verifier loop) and the route handlers separately, so a
// module-level singleton would exist twice in one process: two DBs writing one file, and on mocknet
// two different chains. globalThis is shared by every bundle in the process, so the context lives there.
const holder = globalThis as unknown as { __sellacalidaServerContext?: ServerContext | null };

export function getServerContext(): ServerContext {
  if (!holder.__sellacalidaServerContext) holder.__sellacalidaServerContext = buildContextFromEnv();
  return holder.__sellacalidaServerContext;
}

export function setServerContext(ctx: ServerContext | null) {
  holder.__sellacalidaServerContext = ctx;
}
