// Canonical spec bytes, template shape rules, accept-time validation, prompts and answer formats.
import { describe, expect, it } from 'vitest';
import { canonicalize, parseCanonical, sha256Hex, specHashOf } from '@/lib/templates/canonical';
import {
  MATH_LIMITS, TEMPLATE_IDS, isWellFormedAnswer, renderMath, renderPrompt, validateSpecShape, type ChallengeSpec,
} from '@/lib/templates/public';
import { validateSpecForAccept } from '@/lib/templates/check';
import { pkhToCashAddress } from '@/lib/bch/address';
import { binToHex } from '@bitauth/libauth';
import { agent } from './helpers';

const TXID = 'ab'.repeat(32);
const CAT = 'cd'.repeat(32);

const valid: Record<string, ChallengeSpec> = {
  count: { templateId: 'bch.output_token_count', version: 1, network: 'chipnet', params: { txid: TXID, category: CAT } },
  sats: {
    templateId: 'bch.total_sats_to_address', version: 1, network: 'chipnet',
    params: { txid: TXID, address: pkhToCashAddress(agent.pkh, 'chipnet') },
  },
  nft: { templateId: 'bch.nft_output_index', version: 1, network: 'chipnet', params: { txid: TXID, category: CAT, commitment: '' } },
  math: {
    templateId: 'math.exact_result', version: 1, network: 'chipnet',
    params: { op: 'div', left: { op: 'mul', left: '-7', right: '3' }, right: '2' },
  },
};

describe('canonical spec JSON', () => {
  it('sorts keys at every level with no whitespace', () => {
    expect(canonicalize({ b: 1, a: { d: 'x', c: [2, { z: true, y: null }] } })).toBe('{"a":{"c":[2,{"y":null,"z":true}],"d":"x"},"b":1}');
  });

  it('is independent of key insertion order and locks a known specHash', () => {
    const a = { version: 1, templateId: 'math.exact_result', network: 'mainnet', params: { right: '7', op: 'mul', left: '6' } };
    const b = { params: { left: '6', op: 'mul', right: '7' }, network: 'mainnet', templateId: 'math.exact_result', version: 1 };
    const expected = '{"network":"mainnet","params":{"left":"6","op":"mul","right":"7"},"templateId":"math.exact_result","version":1}';
    expect(canonicalize(a)).toBe(expected);
    expect(canonicalize(b)).toBe(expected);
    // cross-checked with `printf '%s' <json> | sha256sum`
    expect(binToHex(specHashOf(a))).toBe('d5c831bfb42a23f5d10fad2b8541edbc1da935f737c3054009ce520126850fd4');
    expect(sha256Hex(expected)).toBe('d5c831bfb42a23f5d10fad2b8541edbc1da935f737c3054009ce520126850fd4');
  });

  it.each([
    ['undefined value', { a: undefined }],
    ['non-integer number', { a: 1.5 }],
    ['NaN', { a: Number.NaN }],
    ['unsafe integer', { a: 2 ** 53 }],
    ['bigint', { a: 1n }],
    ['Date', { a: new Date(0) }],
  ])('rejects %s', (_l, v) => {
    expect(() => canonicalize(v)).toThrow();
  });

  it('parseCanonical refuses JSON that is not already canonical', () => {
    expect(parseCanonical('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
    expect(() => parseCanonical('{"b":2,"a":1}')).toThrow(/canonical/);
    expect(() => parseCanonical('{"a": 1}')).toThrow(/canonical/);
  });
});

describe('template shape validation (agent-safe)', () => {
  it.each(Object.entries(valid))('%s spec is valid', (_l, spec) => {
    expect(validateSpecShape(spec)).toEqual([]);
  });

  it('knows exactly the four v1 templates', () => {
    expect([...TEMPLATE_IDS]).toEqual(['bch.output_token_count', 'bch.total_sats_to_address', 'bch.nft_output_index', 'math.exact_result']);
  });

  const bad: [string, unknown, RegExp][] = [
    ['unknown template', { ...valid.count, templateId: 'free.form' }, /unknown templateId/],
    ['version 2', { ...valid.count, version: 2 }, /version/],
    ['unknown network', { ...valid.count, network: 'testnet' }, /network/],
    ['extra top-level key', { ...valid.count, answer: '3' }, /exactly the keys/],
    ['extra param', { ...valid.count, params: { ...valid.count.params, hint: 'x' } }, /exactly the keys/],
    ['missing param', { ...valid.count, params: { txid: TXID } }, /exactly the keys/],
    ['uppercase txid', { ...valid.count, params: { txid: TXID.toUpperCase(), category: CAT } }, /txid/],
    ['0x txid', { ...valid.count, params: { txid: '0x' + TXID.slice(2), category: CAT } }, /txid/],
    ['short category', { ...valid.count, params: { txid: TXID, category: 'cd' } }, /category/],
    ['odd commitment', { ...valid.nft, params: { txid: TXID, category: CAT, commitment: 'abc' } }, /commitment/],
    ['huge commitment', { ...valid.nft, params: { txid: TXID, category: CAT, commitment: 'aa'.repeat(129) } }, /longer than/],
    ['address without prefix', { ...valid.sats, params: { txid: TXID, address: 'qq1234' } }, /cashaddr/],
    ['leading-zero integer', { ...valid.math, params: { op: 'add', left: '007', right: '1' } }, /canonical decimal/],
    ['negative zero', { ...valid.math, params: { op: 'add', left: '-0', right: '1' } }, /canonical decimal/],
    ['number instead of string', { ...valid.math, params: { op: 'add', left: 7, right: '1' } }, /canonical decimal/],
    ['unknown op', { ...valid.math, params: { op: 'pow', left: '2', right: '3' } }, /op must be/],
    ['too many digits', { ...valid.math, params: { op: 'add', left: '9'.repeat(MATH_LIMITS.maxDigits + 1), right: '1' } }, /digits/],
  ];
  it.each(bad)('rejects %s', (_l, spec, re) => {
    expect(validateSpecShape(spec).join('; ')).toMatch(re);
  });

  it(`rejects nesting deeper than ${MATH_LIMITS.maxDepth}`, () => {
    let node: unknown = '1';
    for (let i = 0; i <= MATH_LIMITS.maxDepth; i++) node = { op: 'add', left: node, right: '1' };
    expect(validateSpecShape({ ...valid.math, params: node }).join(';')).toMatch(/nests deeper/);
  });
});

describe('accept-time validation (server side)', () => {
  it('returns the canonical JSON for a valid spec', () => {
    const r = validateSpecForAccept(valid.math, 'chipnet');
    expect(r.canonical).toBe(canonicalize(valid.math));
  });

  it('rejects a spec for another network than the escrow', () => {
    expect(() => validateSpecForAccept(valid.count, 'mainnet')).toThrow(/does not match the escrow network/);
  });

  it('rejects an address for the wrong network', () => {
    const spec = { ...valid.sats, params: { txid: TXID, address: pkhToCashAddress(agent.pkh, 'mainnet') } };
    expect(() => validateSpecForAccept(spec, 'chipnet')).toThrow(/prefix bitcoincash/);
  });

  it('rejects an address with a bad checksum', () => {
    const good = pkhToCashAddress(agent.pkh, 'chipnet');
    const flipped = good.slice(0, -1) + (good.endsWith('q') ? 'p' : 'q');
    expect(() => validateSpecForAccept({ ...valid.sats, params: { txid: TXID, address: flipped } }, 'chipnet')).toThrow(/not a valid cashaddr/);
  });

  it.each([
    ['div by zero', { op: 'div', left: '5', right: '0' }],
    ['mod by zero', { op: 'mod', left: '5', right: '0' }],
    ['nested zero divisor', { op: 'add', left: '1', right: { op: 'div', left: '4', right: { op: 'sub', left: '3', right: '3' } } }],
  ])('rejects %s at accept time', (_l, params) => {
    expect(() => validateSpecForAccept({ ...valid.math, params }, 'chipnet')).toThrow(/division or modulo by zero/);
  });
});

describe('prompts and answer formats', () => {
  it('math prompt shows the expression and the rounding rules, not the result', () => {
    const p = renderPrompt(valid.math);
    expect(p).toContain(renderMath(valid.math.params as never));
    expect(p).toContain('((-7) * 3) / 2');
    expect(p).toContain('truncates toward zero');
    expect(p).not.toMatch(/-10\b/); // the answer
    expect(p).toContain('Reply with the answer only.');
  });

  it('nft prompt states the -1 sentinel and the any-commitment rule', () => {
    const p = renderPrompt(valid.nft);
    expect(p).toContain('-1');
    expect(p).toContain('(any commitment)');
    const withCommitment: ChallengeSpec = {
      templateId: 'bch.nft_output_index', version: 1, network: 'chipnet', params: { txid: TXID, category: CAT, commitment: 'beef' },
    };
    expect(renderPrompt(withCommitment)).toContain('0xbeef');
  });

  it('bch prompts carry the txid, category and address verbatim', () => {
    expect(renderPrompt(valid.count)).toContain(TXID);
    expect(renderPrompt(valid.count)).toContain(CAT);
    expect(renderPrompt(valid.sats)).toContain((valid.sats.params as { address: string }).address);
  });

  it.each<[string, string, boolean]>([
    ['bch.output_token_count', '0', true],
    ['bch.output_token_count', '12', true],
    ['bch.output_token_count', '012', false],
    ['bch.output_token_count', '-1', false],
    ['bch.total_sats_to_address', '15000', true],
    ['bch.total_sats_to_address', '1.5', false],
    ['bch.nft_output_index', '-1', true],
    ['bch.nft_output_index', '-2', false],
    ['bch.nft_output_index', '3', true],
    ['math.exact_result', '-42', true],
    ['math.exact_result', '-0', false],
    ['math.exact_result', ' 42', false],
  ])('%s answer %j well-formed: %s', (t, a, ok) => {
    expect(isWellFormedAnswer(t as never, a)).toBe(ok);
  });
});
