// Server configuration from the environment (.env.local). Chipnet and mainnet settings can never
// be mixed: the token category, network id, Electrum server and addresses all follow NETWORK.
import { decodeCashAddress, binToHex, decodePrivateKeyWif, sha256, utf8ToBin } from '@bitauth/libauth';
import { explorerTxUrl } from '../bch/network';
import { KNOWN_WRONG_PUSD_CATEGORY, MAINNET_MAX_BOND, PUSD_CATEGORY_MAINNET, PUSD_DECIMALS, type SellacalidaNetwork } from '../constants';
import { assertExplorerCategory } from '../tokenCategory';
import type { PublicConfig, ShowcaseExample } from '../wire';

export interface ServerConfig {
  network: SellacalidaNetwork;
  tokenCategory: string;
  tokenSymbol: string;
  tokenDecimals: number;
  electrumHostname?: string;
  dataDir: string;
  adminToken?: string;
  agent: { id: string; name: string; bio: string; wif?: string };
  /** offer policy used when the agent publishes a bond */
  offerDefaults: { bond: bigint; fee: bigint; maxDeadlineDelta: bigint; verifierGraceBlocks: bigint };
  offerSats: bigint;
  escrowSats: bigint;
  verifierTickMs: number;
  /** the loop keeps this many bonds open, publishing from the agent wallet (0 = manual only) */
  autoOffers: number;
  /** mocknet preview only: anyone may run play challenges through the dev challenger, rate limited */
  publicDevChallenges: { enabled: boolean; minIntervalMs: number; maxPerProcess: number };
  links: { deck: string | null; repo: string; emberAddress: string | null };
  /** mainnet pass/fail/tip transactions to show once the owner has real txids */
  examples: ShowcaseExample[];
}

function int(env: Record<string, string | undefined>, key: string, fallback: bigint): bigint {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^[0-9]+$/.test(v)) throw new Error(`${key} must be a non-negative integer (base units), got "${v}"`);
  return BigInt(v);
}

/** A count or a duration. Rejects blanks-that-aren't-blank, negatives, and "NaN", which would disable a cap. */
function count(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^[0-9]+$/.test(v)) throw new Error(`${key} must be a non-negative integer, got "${v}"`);
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`${key} is too large`);
  return n;
}

function firstSet(env: Record<string, string | undefined>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

function httpUrl(name: string, raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an http(s) URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} must be an http(s) URL`);
  return raw;
}

/** EMBER2026 votes are a mainnet CashTokens address. Never a key. */
function emberAddress(raw: string | undefined): string | null {
  if (!raw) return null;
  const decoded = decodeCashAddress(raw);
  if (typeof decoded === 'string' || decoded.prefix !== 'bitcoincash') {
    throw new Error('EMBER_ADDRESS must be a mainnet bitcoincash: cash address');
  }
  return raw;
}

const SHOWCASE: readonly { key: string; kind: ShowcaseExample['kind']; label: string }[] = [
  { key: 'SHOWCASE_PASS_TXID', kind: 'pass', label: 'Pass' },
  { key: 'SHOWCASE_FAIL_TXID', kind: 'fail', label: 'Fail' },
  { key: 'SHOWCASE_NORESPONSE_TXID', kind: 'noresponse', label: 'No response' },
  { key: 'SHOWCASE_TIP_TXID', kind: 'tip', label: 'BCH tip' },
];

function showcaseExamples(env: Record<string, string | undefined>): ShowcaseExample[] {
  const out: ShowcaseExample[] = [];
  for (const item of SHOWCASE) {
    const raw = env[item.key]?.trim() ?? '';
    if (!raw) continue;
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`${item.key} must be a 64-character hex transaction id`);
    const txid = raw.toLowerCase();
    const href = explorerTxUrl('mainnet', txid);
    if (!href) throw new Error('mainnet explorer link could not be built');
    out.push({ kind: item.kind, label: item.label, txid, href });
  }
  return out;
}

const NETWORKS: readonly string[] = ['mainnet', 'chipnet', 'mocknet'];

/**
 * A WIF says which network it was made for; refuse a testnet key on mainnet and the reverse, as the
 * runner does. Raw hex keys carry no network. Mocknet takes either. Decode errors are reported where
 * the key is loaded.
 */
function assertKeyNetwork(name: string, value: string | undefined, network: SellacalidaNetwork) {
  if (!value || network === 'mocknet') return;
  const v = value.trim();
  if (/^[0-9a-f]{64}$/i.test(v)) return;
  const d = decodePrivateKeyWif(v);
  if (typeof d === 'string') return;
  const mainnetKey = d.type === 'mainnet' || d.type === 'mainnetUncompressed';
  if (mainnetKey !== (network === 'mainnet')) {
    throw new Error(`${name} is a ${mainnetKey ? 'mainnet' : 'testnet'} key but NETWORK is ${network}`);
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const network = (env.NETWORK || 'chipnet') as SellacalidaNetwork;
  // an explicit list, not `in`: "toString" or "constructor" must not count as a network
  if (!NETWORKS.includes(network)) throw new Error(`NETWORK must be mainnet, chipnet or mocknet, got "${network}"`);
  for (const name of ['AGENT_WIF', 'FEE_WALLET_WIF', 'VERIFIER_PRIVATE_KEY']) assertKeyNetwork(name, env[name], network);

  const fallbackCategory =
    network === 'mainnet' ? PUSD_CATEGORY_MAINNET : network === 'mocknet' ? binToHex(sha256.hash(utf8ToBin('sellacalida-mocknet-token'))) : '';
  const tokenCategory = (env.TOKEN_CATEGORY || fallbackCategory).toLowerCase();
  if (!tokenCategory) throw new Error(`TOKEN_CATEGORY is required on ${network} (explorer-order hex of your test token)`);
  assertExplorerCategory(tokenCategory);
  if (tokenCategory === KNOWN_WRONG_PUSD_CATEGORY) throw new Error('TOKEN_CATEGORY is the wrapped token, not mainnet-v1 PUSD');
  if (network === 'mainnet' && tokenCategory !== PUSD_CATEGORY_MAINNET) throw new Error('on mainnet TOKEN_CATEGORY must be PUSD (mainnet-v1)');
  if (network !== 'mainnet' && tokenCategory === PUSD_CATEGORY_MAINNET) throw new Error(`never use the mainnet PUSD category on ${network}`);

  // the UI shows amounts with these; on mainnet they are PUSD's and cannot be overridden, so a bond
  // can never be displayed as 100 PUSD when it is 1.00
  const decimalsRaw = env.TOKEN_DECIMALS || String(PUSD_DECIMALS);
  if (!/^[0-9]$/.test(decimalsRaw)) throw new Error(`TOKEN_DECIMALS must be a single digit, got "${decimalsRaw}"`);
  const tokenDecimals = Number(decimalsRaw);
  const tokenSymbol = env.TOKEN_SYMBOL || (network === 'mainnet' ? 'PUSD' : 'tPUSD');
  if (network === 'mainnet' && (tokenDecimals !== PUSD_DECIMALS || tokenSymbol !== 'PUSD')) {
    throw new Error('on mainnet the token is PUSD with 2 decimals: remove TOKEN_SYMBOL and TOKEN_DECIMALS or set them to PUSD and 2');
  }

  const offerDefaults = {
    bond: int(env, 'OFFER_BOND', 100n),
    fee: int(env, 'OFFER_FEE', 20n),
    maxDeadlineDelta: int(env, 'OFFER_MAX_DEADLINE_DELTA', 144n),
    verifierGraceBlocks: int(env, 'OFFER_GRACE_BLOCKS', 18n),
  };
  if (network === 'mainnet' && (offerDefaults.bond > MAINNET_MAX_BOND || offerDefaults.fee > MAINNET_MAX_BOND)) {
    throw new Error(`on mainnet OFFER_BOND and OFFER_FEE are capped at ${MAINNET_MAX_BOND} base units (1.00 PUSD)`);
  }

  return {
    network,
    tokenCategory,
    tokenSymbol,
    tokenDecimals,
    electrumHostname: env.ELECTRUM_HOSTNAME || undefined,
    dataDir: env.DATA_DIR || 'data',
    adminToken: env.ADMIN_TOKEN || undefined,
    agent: {
      id: env.AGENT_ID || 'sonnet',
      name: env.AGENT_NAME || 'Sonnet the Analyst',
      bio: env.AGENT_BIO || 'An AI agent that answers BCH transaction questions and exact arithmetic, and bonds its own money on every answer.',
      wif: env.AGENT_WIF || undefined,
    },
    offerDefaults,
    offerSats: int(env, 'OFFER_SATS', 3000n),
    escrowSats: int(env, 'ESCROW_SATS', 3000n),
    verifierTickMs: (() => {
      const ms = count(env, 'VERIFIER_TICK_MS', 20_000);
      if (ms < 1000) throw new Error('VERIFIER_TICK_MS must be at least 1000 so the loop cannot spin');
      return ms;
    })(),
    autoOffers: count(env, 'AUTO_OFFERS', network === 'mocknet' ? 3 : 1),
    publicDevChallenges: {
      enabled: network === 'mocknet' && env.MOCKNET_PUBLIC_CHALLENGES === '1',
      minIntervalMs: count(env, 'MOCKNET_CHALLENGE_INTERVAL_MS', 15_000),
      maxPerProcess: count(env, 'MOCKNET_CHALLENGE_CAP', 200),
    },
    links: {
      deck: httpUrl('DECK_URL', firstSet(env, ['DECK_URL', 'NEXT_PUBLIC_DECK_URL'])),
      repo: httpUrl('REPO_URL', firstSet(env, ['REPO_URL', 'NEXT_PUBLIC_REPO_URL'])) ?? 'https://github.com/0xileri/Sellacalida',
      emberAddress: emberAddress(firstSet(env, ['EMBER_ADDRESS', 'NEXT_PUBLIC_EMBER_ADDRESS'])),
    },
    examples: showcaseExamples(env),
  };
}

/** What the browser may know. Never includes keys or tokens. */
export function publicConfig(c: ServerConfig): PublicConfig {
  return {
    network: c.network,
    tokenCategory: c.tokenCategory,
    tokenSymbol: c.tokenSymbol,
    tokenDecimals: c.tokenDecimals,
    escrowSats: c.escrowSats.toString(),
    featuredAgentId: c.agent.id,
    links: c.links,
    examples: c.examples,
  };
}
