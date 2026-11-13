// Cross-cutting guards: dust floor, constants drift, stale artifacts, endianness helpers, and the
// agent-runner import boundary (spec sections 2, 3, 5 and the checklist in section 9).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { binToHex, getDustThreshold, hexToBin, swapEndianness } from '@bitauth/libauth';
import { compileFile } from 'cashc';
import {
  KNOWN_WRONG_PUSD_CATEGORY, MAX_FEE_SATS, MAX_HEIGHT, MIN_OUTPUT_SATS, MIN_VERIFIER_GRACE, PUSD_CATEGORY_MAINNET,
} from '@/lib/constants';
import { ATTEST_OFFSETS, ATTEST_PREFIX } from '@/lib/attestation';
import { fromContractCategory, toContractCategory, toOutpointTxHash } from '@/lib/tokenCategory';
import { escrowLockingBytecode } from '@/lib/encodeRedeemScript';
import { escrowArgsFor } from '@/lib/contracts';
import { baseOffer, baseTerms, challenger } from './helpers';

const root = process.cwd();
const offerSrc = readFileSync(join(root, 'contracts/SellacalidaOffer.cash'), 'utf8');
const escrowSrc = readFileSync(join(root, 'contracts/SellacalidaEscrow.cash'), 'utf8');

describe('dust floor', () => {
  const maxAmount = 9_223_372_036_854_775_807n; // largest fungible amount: worst-case output size
  const category = toContractCategory(PUSD_CATEGORY_MAINNET);
  it('MIN_OUTPUT_SATS covers a token-bearing P2PKH output', () => {
    const dust = getDustThreshold({
      lockingBytecode: challenger.lock,
      valueSatoshis: 0n,
      token: { amount: maxAmount, category },
    });
    expect(dust).toBeLessThanOrEqual(MIN_OUTPUT_SATS);
  });
  it('MIN_OUTPUT_SATS covers a token-bearing P2SH32 escrow output', () => {
    const lock = escrowLockingBytecode(escrowArgsFor(baseOffer(), baseTerms()));
    const dust = getDustThreshold({ lockingBytecode: lock, valueSatoshis: 0n, token: { amount: maxAmount, category } });
    expect(dust).toBeLessThanOrEqual(MIN_OUTPUT_SATS);
  });
});

describe('contract constants match lib/constants.ts', () => {
  const grab = (src: string, name: string) => {
    const m = src.match(new RegExp(`int constant ${name} = ([0-9_]+);`));
    if (!m) throw new Error(`${name} not found`);
    return BigInt(m[1].replaceAll('_', ''));
  };
  it('MIN_OUTPUT_SATS', () => {
    expect(grab(offerSrc, 'MIN_OUTPUT_SATS')).toBe(MIN_OUTPUT_SATS);
    expect(grab(escrowSrc, 'MIN_OUTPUT_SATS')).toBe(MIN_OUTPUT_SATS);
  });
  it('MAX_FEE_SATS', () => {
    expect(grab(escrowSrc, 'MAX_FEE_SATS')).toBe(MAX_FEE_SATS);
  });
  it('MAX_HEIGHT and MIN_VERIFIER_GRACE', () => {
    expect(grab(offerSrc, 'MAX_HEIGHT')).toBe(BigInt(MAX_HEIGHT));
    expect(grab(offerSrc, 'MIN_VERIFIER_GRACE')).toBe(BigInt(MIN_VERIFIER_GRACE));
  });
  it('the escrow parse uses the same prefix and split widths as ATTEST_OFFSETS', () => {
    expect(escrowSrc).toContain(`bytes('${ATTEST_PREFIX}')`);
    const splits = [...escrowSrc.matchAll(/= (?:message|r\d)\.split\((\d+)\);/g)].map((m) => Number(m[1]));
    const o = ATTEST_OFFSETS;
    expect(splits).toEqual([
      o.networkId - o.prefix,
      o.challengeId - o.networkId,
      o.outpointTxid - o.challengeId,
      o.outpointIndex - o.outpointTxid,
      o.specHash - o.outpointIndex,
      o.verdict - o.specHash,
      o.answerHash - o.verdict,
    ]);
    expect(escrowSrc).toContain('require(message.length == 156);');
  });
});

describe('compiled artifacts are up to date (run `npm run compile`)', () => {
  for (const name of ['SellacalidaOffer', 'SellacalidaEscrow']) {
    it(name, () => {
      const fresh = compileFile(join(root, `contracts/${name}.cash`));
      const committed = JSON.parse(readFileSync(join(root, `contracts/artifacts/${name}.json`), 'utf8'));
      expect(committed.bytecode).toBe(fresh.bytecode);
      expect(committed.abi).toEqual(fresh.abi);
      expect(committed.constructorInputs).toEqual(fresh.constructorInputs);
      const twin = readFileSync(join(root, `contracts/artifacts/${name}.ts`), 'utf8');
      expect(twin).toContain(JSON.stringify(committed.bytecode));
    });
  }
});

describe('category and txid byte order helpers', () => {
  it('explorer hex <-> VM bytes round-trips', () => {
    const vm = toContractCategory(PUSD_CATEGORY_MAINNET);
    expect(vm.length).toBe(32);
    expect(binToHex(vm)).toBe(swapEndianness(PUSD_CATEGORY_MAINNET));
    expect(binToHex(vm).startsWith('4425a0e2')).toBe(true); // PUSD id ends ...e2a02544
    expect(fromContractCategory(vm)).toBe(PUSD_CATEGORY_MAINNET);
  });
  it('rejects malformed categories and a 33-byte (NFT capability) value', () => {
    expect(() => toContractCategory('0x' + PUSD_CATEGORY_MAINNET)).toThrow();
    expect(() => toContractCategory(PUSD_CATEGORY_MAINNET.toUpperCase())).toThrow();
    expect(() => fromContractCategory(new Uint8Array(33))).toThrow(/32 bytes/);
  });
  it('outpoint txid helper reverses explorer order', () => {
    expect(binToHex(toOutpointTxHash('00'.repeat(31) + 'ff'))).toBe('ff' + '00'.repeat(31));
  });
  it('the PUSD constant is the verified mainnet-v1 id, not the wrapped token', () => {
    expect(PUSD_CATEGORY_MAINNET).toBe('2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544');
    expect(PUSD_CATEGORY_MAINNET).not.toBe(KNOWN_WRONG_PUSD_CATEGORY);
    expect(hexToBin(PUSD_CATEGORY_MAINNET).length).toBe(32);
  });
});

describe('evaluation integrity: the agent runner cannot reach checkers or the verifier', () => {
  const agentDir = join(root, 'lib/agent');
  const files: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(f)) files.push(p);
    }
  };
  walk(agentDir);
  const forbidden = /(templates\/check|\/verifier|attestation|VERIFIER_PRIVATE_KEY)/;

  it('no file under lib/agent imports lib/templates/check, the verifier, or attestation code', () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      const specifiers = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      return specifiers.some((s) => forbidden.test(s)) || /VERIFIER_PRIVATE_KEY/.test(src);
    });
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});
