// JSON that survives bigint and Uint8Array (offer params, challenge terms, pending escrows).
import { binToHex, hexToBin } from '@bitauth/libauth';

export const jsonReplacer = (_k: string, v: unknown) =>
  typeof v === 'bigint' ? { $bigint: v.toString() } : v instanceof Uint8Array ? { $hex: binToHex(v) } : v;

export const jsonReviver = (_k: string, v: unknown) => {
  if (v && typeof v === 'object' && '$bigint' in v) return BigInt((v as { $bigint: string }).$bigint);
  if (v && typeof v === 'object' && '$hex' in v) return hexToBin((v as { $hex: string }).$hex);
  return v;
};

export const toJson = (v: unknown, space?: number) => JSON.stringify(v, jsonReplacer, space);
export const fromJson = <T>(s: string): T => JSON.parse(s, jsonReviver) as T;
