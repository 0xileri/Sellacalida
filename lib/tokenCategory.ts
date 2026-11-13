// Token category byte-order helpers.
//
// Wallets, explorers, Cauldron, ParyonUSD docs and the CashScript SDK `token.category` field all use
// "explorer order" hex. libauth stores categories in that order and reverses them when serializing
// a transaction (encodeTokenPrefix). VM introspection (OP_UTXOTOKENCATEGORY / OP_OUTPUTTOKENCATEGORY,
// i.e. CashScript `tx.inputs[i].tokenCategory`) returns the serialized, unreversed bytes.
//
// So a category baked into a contract must be swapEndianness(explorerHex).
// Locked by tests/endianness.test.ts on mocknet in both directions.
import { binToHex, hexToBin, swapEndianness } from '@bitauth/libauth';

const HEX64 = /^[0-9a-f]{64}$/;

export function assertExplorerCategory(hex: string): void {
  if (!HEX64.test(hex)) {
    throw new Error(`token category must be 64 lowercase hex chars (explorer order), got "${hex}"`);
  }
}

/** Explorer-order hex -> 32 bytes in VM (contract) order. */
export function toContractCategory(explorerHex: string): Uint8Array {
  assertExplorerCategory(explorerHex);
  return hexToBin(swapEndianness(explorerHex));
}

/** VM (contract) order bytes -> explorer-order hex. */
export function fromContractCategory(vmBytes: Uint8Array): string {
  if (vmBytes.length !== 32) {
    throw new Error(`contract category must be 32 bytes (fungible-only), got ${vmBytes.length}`);
  }
  return swapEndianness(binToHex(vmBytes));
}

/** Explorer-order txid -> the 32 bytes OP_OUTPOINTTXHASH returns (serialized order). */
export function toOutpointTxHash(explorerTxid: string): Uint8Array {
  if (!HEX64.test(explorerTxid)) throw new Error(`txid must be 64 lowercase hex chars, got "${explorerTxid}"`);
  return hexToBin(swapEndianness(explorerTxid));
}
