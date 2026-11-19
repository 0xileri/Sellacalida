// Shared protocol constants. Single source of truth for TypeScript.
// The same values are hard-coded in contracts/*.cash; tests/guards.test.ts fails if they drift.

/** Minimum `value` (sats) on every contract-constrained output. >= token dust, see tests/guards.test.ts. */
export const MIN_OUTPUT_SATS = 1000n;

/**
 * Cap on the miner fee an escrow's own sats may pay on an unsigned settle / timeout. With a fee
 * payer (extra output), the winner / refunds must keep every escrow sat. See SellacalidaEscrow.cash.
 */
export const MAX_FEE_SATS = 2000n;

/** expiryHeight must be strictly below this so nLocktime is read as a block height. */
export const MAX_HEIGHT = 500_000_000;

/** Minimum verifierGraceBlocks an agent may commit (about 3 hours of blocks). */
export const MIN_VERIFIER_GRACE = 18;

/**
 * Mainnet app caps (spec sections 8 and 9: tiny bonds, a throwaway agent wallet with a tiny cap,
 * never large public stakes). The app refuses to publish a bond above these.
 */
export const MAINNET_MAX_BOND = 100n; // 1.00 PUSD per bond, and per fee
export const MAINNET_AGENT_MAX_SATS = 1_000_000n;
export const MAINNET_AGENT_MAX_TOKENS = 2_000n; // 20.00 PUSD

/**
 * Mainnet passed this height in 2025; chipnet is far below it. An Electrum server on the wrong
 * network shows up as a height on the wrong side of this line.
 */
export const MAINNET_MIN_HEIGHT = 800_000;

export const NETWORK_IDS = {
  mainnet: 0x00,
  chipnet: 0x01,
  mocknet: 0x02,
} as const;

export type SellacalidaNetwork = keyof typeof NETWORK_IDS;

export const VERDICTS = {
  PASS: 0x01,
  FAIL: 0x02,
  NORESPONSE: 0x03,
} as const;

export type Verdict = keyof typeof VERDICTS;

/**
 * Mainnet ParyonUSD (PUSD) category, explorer / wallet byte order.
 * Verified against ParyonUSD mainnet-v1 docs (see SELLACALIDA_SPEC.md section 2).
 * 2 decimals: 100 base units == 1.00 PUSD.
 */
export const PUSD_CATEGORY_MAINNET =
  '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';

/** NOT PUSD. Labeled "Wraps ParyonUSD" in some explorers. Never use. */
export const KNOWN_WRONG_PUSD_CATEGORY =
  '741dd9a36c0a1d8b6d396b5095880ac942dcf3f634d969a2caa1d2021687519f';

export const PUSD_DECIMALS = 2;
