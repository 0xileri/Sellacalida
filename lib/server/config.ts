// Server configuration from the environment (.env.local). Chipnet and mainnet settings can never
// be mixed: the token category, network id, Electrum server and addresses all follow NETWORK.
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { KNOWN_WRONG_PUSD_CATEGORY, NETWORK_IDS, PUSD_CATEGORY_MAINNET, type SellacalidaNetwork } from '../constants';
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
  links: { deck: string | null; repo: string; emberAddress: string | null };
}

function int(env: Record<string, string | undefined>, key: string, fallback: bigint): bigint {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^[0-9]+$/.test(v)) throw new Error(`${key} must be a non-negative integer (base units), got "${v}"`);
  return BigInt(v);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const network = (env.NETWORK || 'chipnet') as SellacalidaNetwork;
  if (!(network in NETWORK_IDS)) throw new Error(`NETWORK must be mainnet, chipnet or mocknet, got "${network}"`);

  const fallbackCategory =
    network === 'mainnet' ? PUSD_CATEGORY_MAINNET : network === 'mocknet' ? binToHex(sha256.hash(utf8ToBin('sellacalida-mocknet-token'))) : '';
  const tokenCategory = (env.TOKEN_CATEGORY || fallbackCategory).toLowerCase();
  if (!tokenCategory) throw new Error(`TOKEN_CATEGORY is required on ${network} (explorer-order hex of your test token)`);
  assertExplorerCategory(tokenCategory);
  if (tokenCategory === KNOWN_WRONG_PUSD_CATEGORY) throw new Error('TOKEN_CATEGORY is the wrapped token, not mainnet-v1 PUSD');
  if (network === 'mainnet' && tokenCategory !== PUSD_CATEGORY_MAINNET) throw new Error('on mainnet TOKEN_CATEGORY must be PUSD (mainnet-v1)');
  if (network !== 'mainnet' && tokenCategory === PUSD_CATEGORY_MAINNET) throw new Error(`never use the mainnet PUSD category on ${network}`);

  return {
    network,
    tokenCategory,
    tokenSymbol: env.TOKEN_SYMBOL || (network === 'mainnet' ? 'PUSD' : 'tPUSD'),
    tokenDecimals: Number(env.TOKEN_DECIMALS ?? 2),
    electrumHostname: env.ELECTRUM_HOSTNAME || undefined,
    dataDir: env.DATA_DIR || 'data',
    adminToken: env.ADMIN_TOKEN || undefined,
    agent: {
      id: env.AGENT_ID || 'sonnet',
      name: env.AGENT_NAME || 'Sonnet the Analyst',
      bio: env.AGENT_BIO || 'An AI agent that answers BCH transaction questions and exact arithmetic, and bonds its own money on every answer.',
      wif: env.AGENT_WIF || undefined,
    },
    offerDefaults: {
      bond: int(env, 'OFFER_BOND', 100n),
      fee: int(env, 'OFFER_FEE', 20n),
      maxDeadlineDelta: int(env, 'OFFER_MAX_DEADLINE_DELTA', 144n),
      verifierGraceBlocks: int(env, 'OFFER_GRACE_BLOCKS', 18n),
    },
    offerSats: int(env, 'OFFER_SATS', 3000n),
    escrowSats: int(env, 'ESCROW_SATS', 3000n),
    verifierTickMs: Number(env.VERIFIER_TICK_MS ?? 20_000),
    links: {
      deck: env.NEXT_PUBLIC_DECK_URL || null,
      repo: env.NEXT_PUBLIC_REPO_URL || 'https://github.com/0xileri/Sellacalida',
      emberAddress: env.NEXT_PUBLIC_EMBER_ADDRESS || null,
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
