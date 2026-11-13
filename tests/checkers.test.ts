// Checkers against a real (mocknet) transaction, decoded from raw hex that is verified against its txid.
import { describe, expect, it } from 'vitest';
import { computeExpected, computeExpectedFromRaw } from '@/lib/templates/check';
import { evaluateMath } from '@/lib/templates/check/math';
import { decodeVerified } from '@/lib/bch/txSource';
import type { ChallengeSpec, MathNode } from '@/lib/templates/public';
import { newProvider } from './helpers';
import { CAT_A, CAT_B, CAT_C, makeFixtureTx } from './chainFixture';

async function fixture() {
  const provider = newProvider();
  return { provider, ...(await makeFixtureTx(provider)) };
}

const spec = <T extends ChallengeSpec['templateId']>(templateId: T, params: unknown) =>
  ({ templateId, version: 1, network: 'mocknet', params }) as ChallengeSpec;

describe('raw transaction integrity', () => {
  it('decodes a raw tx that hashes to its txid', async () => {
    const f = await fixture();
    expect(decodeVerified(f.txid, f.rawHex).outputs).toHaveLength(6);
  });

  it('refuses raw hex that hashes to a different txid', async () => {
    const f = await fixture();
    const tampered = f.rawHex.slice(0, -10) + (f.rawHex.slice(-10, -8) === '00' ? '01' : '00') + f.rawHex.slice(-8);
    expect(() => decodeVerified(f.txid, tampered)).toThrow(/hashes to/);
    expect(() => decodeVerified('00'.repeat(32), f.rawHex)).toThrow(/hashes to/);
  });

  it('refuses non-hex input', () => {
    expect(() => decodeVerified('00'.repeat(32), 'zz')).toThrow(/not hex/);
  });
});

describe('bch.output_token_count', () => {
  it('counts FT and NFT outputs of the category', async () => {
    const f = await fixture();
    const r = computeExpectedFromRaw(spec('bch.output_token_count', { txid: f.txid, category: CAT_A }), f.rawHex);
    expect(r.expected).toBe('3');
    expect(r.trace.kind === 'outputs' && r.trace.outputs.filter((o) => o.matched).map((o) => o.index)).toEqual([0, 1, 3]);
  });

  it('category byte order: explorer-order params match decoded outputs', async () => {
    const f = await fixture();
    const r = computeExpectedFromRaw(spec('bch.output_token_count', { txid: f.txid, category: CAT_B }), f.rawHex);
    expect(r.expected).toBe('1');
    expect(r.trace.kind === 'outputs' && r.trace.outputs[4].tokenCategory).toBe(CAT_B);
  });

  it('returns 0 for a category that is absent', async () => {
    const f = await fixture();
    expect(computeExpectedFromRaw(spec('bch.output_token_count', { txid: f.txid, category: CAT_C }), f.rawHex).expected).toBe('0');
  });

  it('computeExpected fetches through the chain reader and agrees', async () => {
    const f = await fixture();
    const s = spec('bch.output_token_count', { txid: f.txid, category: CAT_A });
    const viaChain = await computeExpected(s, f.provider);
    expect(viaChain.expected).toBe('3');
    expect(viaChain.rawTxHex).toBe(f.rawHex);
  });
});

describe('bch.total_sats_to_address', () => {
  it('sums every output to the address', async () => {
    const f = await fixture();
    expect(computeExpectedFromRaw(spec('bch.total_sats_to_address', { txid: f.txid, address: f.addresses.alice }), f.rawHex).expected).toBe('4000');
  });

  it('token-aware and plain encodings of the same address are the same destination', async () => {
    const f = await fixture();
    expect(computeExpectedFromRaw(spec('bch.total_sats_to_address', { txid: f.txid, address: f.addresses.aliceTokenAware }), f.rawHex).expected).toBe('4000');
  });

  it('works for P2SH32 addresses and counts token outputs at their sat value', async () => {
    const f = await fixture();
    expect(computeExpectedFromRaw(spec('bch.total_sats_to_address', { txid: f.txid, address: f.addresses.p2sh32 }), f.rawHex).expected).toBe('1500');
    expect(computeExpectedFromRaw(spec('bch.total_sats_to_address', { txid: f.txid, address: f.addresses.bob }), f.rawHex).expected).toBe('2000');
  });

  it('returns 0 when nothing goes to the address', async () => {
    const f = await fixture();
    expect(computeExpectedFromRaw(spec('bch.total_sats_to_address', { txid: f.txid, address: f.addresses.nobody }), f.rawHex).expected).toBe('0');
  });
});

describe('bch.nft_output_index', () => {
  it.each([
    ['unique commitment aa', CAT_A, 'aa', '1'],
    ['unique commitment bb on a P2SH32 output', CAT_A, 'bb', '3'],
    ['two NFTs match any commitment -> -1', CAT_A, '', '-1'],
    ['no NFT with that commitment -> -1', CAT_A, 'cc', '-1'],
    ['fungible-only category is not an NFT -> -1', CAT_B, '', '-1'],
    ['absent category -> -1', CAT_C, '', '-1'],
  ])('%s', async (_l, category, commitment, expected) => {
    const f = await fixture();
    const r = computeExpectedFromRaw(spec('bch.nft_output_index', { txid: f.txid, category, commitment }), f.rawHex);
    expect(r.expected).toBe(expected);
  });

  it('a fungible-only output of the category is not counted as an NFT', async () => {
    const f = await fixture();
    const r = computeExpectedFromRaw(spec('bch.nft_output_index', { txid: f.txid, category: CAT_A, commitment: '' }), f.rawHex);
    expect(r.trace.kind === 'outputs' && r.trace.outputs[0].matched).toBe(false);
    expect(r.trace.kind === 'outputs' && r.trace.note).toBe('2 matching NFT output(s)');
  });
});

describe('math.exact_result', () => {
  const m = (params: MathNode) => computeExpectedFromRaw(spec('math.exact_result', params)).expected;

  it.each([
    [{ op: 'add', left: '2', right: '3' }, '5'],
    [{ op: 'sub', left: '2', right: '30' }, '-28'],
    [{ op: 'mul', left: { op: 'add', left: '12', right: '7' }, right: '-3' }, '-57'],
    [{ op: 'div', left: '-7', right: '2' }, '-3'],
    [{ op: 'div', left: '7', right: '-2' }, '-3'],
    [{ op: 'mod', left: '-7', right: '2' }, '-1'],
    [{ op: 'mod', left: '7', right: '-2' }, '1'],
    [{ op: 'mul', left: '123456789012345678901234567890', right: '987654321' }, '121932631124828532112482853211126352690'],
  ] as [MathNode, string][])('%j = %s', (params, expected) => {
    expect(m(params)).toBe(expected);
  });

  it('records one trace step per operation', () => {
    const r = computeExpectedFromRaw(spec('math.exact_result', { op: 'mul', left: { op: 'add', left: '1', right: '2' }, right: '3' }));
    expect(r.trace).toEqual({ kind: 'math', steps: [{ expr: '1 + 2', value: '3' }, { expr: '3 * 3', value: '9' }] });
  });

  it('throws on division by zero (accept-time validation stops these earlier)', () => {
    expect(() => evaluateMath({ op: 'div', left: '1', right: '0' })).toThrow(/by zero/);
  });
});
