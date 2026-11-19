// The deployed app's key command: what it prints is exactly what the app accepts.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { makeAppKeys } from '../scripts/appKeys';
import { loadConfig } from '@/lib/server/config';
import { buildContextFromEnv } from '@/lib/server/context';

describe('npm run keys', () => {
  it('mainnet keys load in a mainnet config, and the printed addresses are the ones the app uses', () => {
    const k = makeAppKeys('mainnet');
    expect(k.agentTokenAddress).toMatch(/^bitcoincash:z/);
    expect(k.agentAddress).toMatch(/^bitcoincash:q/);
    const env = {
      NETWORK: 'mainnet', AGENT_WIF: k.AGENT_WIF, VERIFIER_PRIVATE_KEY: k.VERIFIER_PRIVATE_KEY, FEE_WALLET_WIF: k.FEE_WALLET_WIF,
      DATA_DIR: mkdtempSync(join(tmpdir(), 'sellacalida-keys-')),
    };
    expect(loadConfig(env).network).toBe('mainnet');
    const ctx = buildContextFromEnv(env);
    expect(ctx.agentKey?.address).toBe(k.agentAddress);
    expect(binToHex(ctx.verifier!.verifierPk)).toBe(k.verifierPk);
  });

  it('every run makes new keys, and chipnet keys are refused by a mainnet config', () => {
    const a = makeAppKeys('mainnet');
    const b = makeAppKeys('mainnet');
    expect(new Set([a.AGENT_WIF, b.AGENT_WIF, a.VERIFIER_PRIVATE_KEY, b.VERIFIER_PRIVATE_KEY]).size).toBe(4);
    const chip = makeAppKeys('chipnet');
    expect(chip.agentTokenAddress).toMatch(/^bchtest:z/);
    expect(() => loadConfig({ NETWORK: 'mainnet', AGENT_WIF: chip.AGENT_WIF })).toThrow(/testnet key but NETWORK is mainnet/);
  });
});
