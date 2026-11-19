// Server configuration from the environment (.env.local). Chipnet and mainnet settings can never
// be mixed: the token category, network id, Electrum server and addresses all follow NETWORK.
import { binToHex, decodePrivateKeyWif, sha256, utf8ToBin } from '@bitauth/libauth';
import { KNOWN_WRONG_PUSD_CATEGORY, MAINNET_MAX_BOND, PUSD_CATEGORY_MAINNET, PUSD_DECIMALS, type SellacalidaNetwork } from '../constants';
import { assertExplorerCategory } from '../tokenCategory';
import type { PublicConfig } from '../wire';

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
  links: { deck: string | null; repo: string; emberAddress: string | null; play: string | null; live: string | null };
}

function int(env: Record<string, string | undefined>, key: string, fallback: bigint): bigint {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^[0-9]+$/.test(v)) throw new Error(`${key} must be a non-negative integer (base units), got "${v}"`);
  return BigInt(v);
}

const NETWORKS: readonly string[] = ['mainnet', 'chipnet', 'mocknet'];

/** An https URL or nothing: a typo in a link variable leaves the link out instead of breaking it. */
function httpsUrl(v: string | undefined): string | null {
  const s = (v ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+(\/\S*)?$/.test(s) ? s : null;
}

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
    verifierTickMs: Number(env.VERIFIER_TICK_MS ?? 20_000),
    autoOffers: Number(env.AUTO_OFFERS ?? (network === 'mocknet' ? 3 : 1)),
    publicDevChallenges: {
      enabled: network === 'mocknet' && env.MOCKNET_PUBLIC_CHALLENGES === '1',
      minIntervalMs: Number(env.MOCKNET_CHALLENGE_INTERVAL_MS ?? 15_000),
      maxPerProcess: Number(env.MOCKNET_CHALLENGE_CAP ?? 200),
    },
    links: {
      deck: env.NEXT_PUBLIC_DECK_URL || null,
      repo: env.NEXT_PUBLIC_REPO_URL || 'https://github.com/0xileri/Sellacalida',
      emberAddress: env.NEXT_PUBLIC_EMBER_ADDRESS || null,
      // the two deployments link to each other: mainnet (real PUSD) and a mocknet play-money copy
      play: httpsUrl(env.PLAY_URL),
      live: httpsUrl(env.LIVE_URL),
    },
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
  };
}
