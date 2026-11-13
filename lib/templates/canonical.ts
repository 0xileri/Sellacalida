// Canonical challenge spec bytes (spec section 5): UTF-8 JSON, object keys sorted, no whitespace.
// specHash = sha256(utf8(canonicalJson)). Locked by tests/canonical.test.ts.
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';

/**
 * Deterministic JSON. Keys are sorted with the default JS sort (UTF-16 code units; every key we
 * use is ASCII). Only strings, safe integers, booleans, null, arrays and plain objects are
 * allowed, so the same value can never serialize two ways.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new Error(`canonical JSON only allows safe integers, got ${value}`);
      return String(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new Error('canonical JSON only allows plain objects');
      const obj = value as Record<string, unknown>;
      const parts = Object.keys(obj)
        .sort()
        .map((k) => {
          if (obj[k] === undefined) throw new Error(`canonical JSON does not allow undefined (key "${k}")`);
          return `${JSON.stringify(k)}:${canonicalize(obj[k])}`;
        });
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`canonical JSON does not allow ${typeof value}`);
  }
}

export function sha256Hex(text: string): string {
  return binToHex(sha256.hash(utf8ToBin(text)));
}

export function specHashOf(spec: unknown): Uint8Array {
  return sha256.hash(utf8ToBin(canonicalize(spec)));
}

/** Parse a canonical spec string and confirm it really is canonical (re-serializes identically). */
export function parseCanonical(json: string): unknown {
  const parsed: unknown = JSON.parse(json);
  if (canonicalize(parsed) !== json) throw new Error('spec JSON is not in canonical form');
  return parsed;
}
