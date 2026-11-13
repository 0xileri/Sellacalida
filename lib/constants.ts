// Shared protocol constants. Single source of truth for TypeScript.
// The same values are hard-coded in contracts/*.cash; tests/constants.test.ts fails if they drift.

/** Minimum `value` (sats) on every contract-constrained output. >= token dust, see tests/dust.test.ts. */
export const MIN_OUTPUT_SATS = 1000n;

/** expiryHeight must be strictly below this so nLocktime is read as a block height. */
export const MAX_HEIGHT = 500_000_000;

/** Minimum verifierGraceBlocks an agent may commit (about 3 hours of blocks). */
export const MIN_VERIFIER_GRACE = 18;

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
