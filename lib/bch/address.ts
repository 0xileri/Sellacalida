// CashAddress helpers. Contracts compare locking bytecode, so address encoding only matters at the
// edges (display, wallet sends, electrum lookups).
import {
  cashAddressToLockingBytecode,
  encodeCashAddress,
  hash160,
  lockingBytecodeToCashAddress,
} from '@bitauth/libauth';
import type { SellacalidaNetwork } from '../constants';

export type CashAddressPrefix = 'bitcoincash' | 'bchtest' | 'bchreg';

export function networkPrefix(network: SellacalidaNetwork): CashAddressPrefix {
  if (network === 'mainnet') return 'bitcoincash';
  if (network === 'chipnet') return 'bchtest';
  return 'bchreg';
}

export function pkhToCashAddress(pkh: Uint8Array, network: SellacalidaNetwork, tokenAware = false): string {
  if (pkh.length !== 20) throw new Error('pkh must be 20 bytes');
  return encodeCashAddress({
    prefix: networkPrefix(network),
    type: tokenAware ? 'p2pkhWithTokens' : 'p2pkh',
    payload: pkh,
  }).address;
}

export function pubkeyToCashAddress(pubkey: Uint8Array, network: SellacalidaNetwork, tokenAware = false): string {
  return pkhToCashAddress(hash160(pubkey), network, tokenAware);
}

export function lockingBytecodeToAddress(
  bytecode: Uint8Array,
  network: SellacalidaNetwork,
  tokenAware = false,
): string {
  const r = lockingBytecodeToCashAddress({ bytecode, prefix: networkPrefix(network), tokenSupport: tokenAware });
  if (typeof r === 'string') throw new Error(r);
  return r.address;
}

/** Accepts token-aware and non-token-aware encodings of the same payload. */
export function addressToLockingBytecode(address: string): Uint8Array {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new Error(r);
  return r.bytecode;
}
