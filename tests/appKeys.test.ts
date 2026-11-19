// The Railway key command must mint mainnet keys and must not persist them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePrivateKeyWif } from '@bitauth/libauth';
import { formatAppKeys, generateAppKeys } from '@/lib/server/appKeys';

describe('npm run keys', () => {
  it('mints mainnet agent, verifier and fee-wallet keys plus an admin token, and prints them only as text', () => {
    const a = generateAppKeys();
    const b = generateAppKeys();
    for (const wif of [a.agentWif, a.verifierWif, a.feeWalletWif]) {
      const decoded = decodePrivateKeyWif(wif);
      expect(typeof decoded).not.toBe('string');
      if (typeof decoded === 'string') continue;
      expect(decoded.type === 'mainnet' || decoded.type === 'mainnetUncompressed').toBe(true);
    }
    expect(a.agentAddress.startsWith('bitcoincash:')).toBe(true);
    expect(a.agentTokenAddress.startsWith('bitcoincash:')).toBe(true);
    expect(a.feeWalletAddress.startsWith('bitcoincash:')).toBe(true);
    expect(a.verifierPk).toMatch(/^[0-9a-f]{66}$/);
    expect(a.adminToken).toMatch(/^[0-9a-f]{64}$/);
    expect(b.agentWif).not.toBe(a.agentWif);
    const text = formatAppKeys(a);
    expect(text).toContain(a.agentWif);
    expect(text).toContain('Not written to disk');
    expect(text).toContain('OFFER_BOND=100');
    expect(text).toContain('OFFER_FEE=20');
  });

  it('the script never writes a file and refuses a redirected stdout', () => {
    const src = readFileSync(new URL('../scripts/app-keys.mts', import.meta.url), 'utf8');
    const lib = readFileSync(new URL('../lib/server/appKeys.ts', import.meta.url), 'utf8');
    expect(src + lib).not.toMatch(/writeFile|appendFile|createWriteStream|mkdir/);
    expect(src).toContain('isTTY');
    expect(src).toContain('app-keys.mts');
  });
});
