// Spec section 9, "Wallet, keys, and evaluation": no private keys in the repo, the commit history or
// the client bundle; secrets only in .env.local; token amounts never go through floating point.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  bip39WordListEnglish, decodeBip39Mnemonic, decodePrivateKeyWif, encodePrivateKeyWif, generateBip39Mnemonic, generatePrivateKey,
} from '@bitauth/libauth';

const ROOT = process.cwd();
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 }).toString();

// Base58 strings shaped like a WIF. Only ones that decode with a valid checksum count, so hashes,
// txids and addresses never show up as false positives.
const WIF_SHAPE = /\b[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}\b/g;
const realWifs = (text: string) => (text.match(WIF_SHAPE) ?? []).filter((s) => typeof decodePrivateKeyWif(s) !== 'string');

// Seed phrases: any 12 to 24 consecutive BIP39 words whose checksum is valid.
const BIP39 = new Set(bip39WordListEnglish);
function realMnemonics(text: string): string[] {
  const found: string[] = [];
  const words = text.toLowerCase().split(/[^a-z]+/);
  let run: string[] = [];
  const flush = () => {
    for (const n of [24, 21, 18, 15, 12]) {
      for (let i = 0; i + n <= run.length; i++) {
        const phrase = run.slice(i, i + n).join(' ');
        if (typeof decodeBip39Mnemonic(phrase) !== 'string') found.push(phrase);
      }
    }
    run = [];
  };
  for (const w of words) {
    if (BIP39.has(w)) run.push(w);
    else flush();
  }
  flush();
  return found;
}

// an env-style assignment of a secret with a value on the same line. ".env.example" has names only;
// the spec's "<never commit>" placeholders start with "<", and template or shell references such as
// `AGENT_WIF=${k.AGENT_WIF}` (scripts/keys.mts) start with "$"; neither is a value.
const SECRET_NAMES = 'AGENT_WIF|VERIFIER_PRIVATE_KEY|FEE_WALLET_WIF|LLM_API_KEY|ADMIN_TOKEN|(?:CHIPNET|MAINNET)_[A-Z_]+_WIF';
const SECRET_ASSIGNMENT = new RegExp(`^[ \\t]*(?:export[ \\t]+)?(${SECRET_NAMES})[ \\t]*=[ \\t]*[^\\s#<$]`, 'm');

const TEXT = /\.(ts|tsx|mts|js|mjs|cjs|json|md|cash|css|txt|yml|yaml|toml|example|gitignore|html)$|^[^.]+$/;

function trackedTextFiles(): string[] {
  return git('ls-files', '-z').split('\0').filter((f) => f && TEXT.test(f.split('/').pop()!) && existsSync(join(ROOT, f)));
}

describe('no private keys in the repo or its history', () => {
  it('the WIF detector finds a real key and ignores look-alikes (sanity check)', () => {
    // generated at run time: a WIF written into this file would trip the scans below
    for (const net of ['mainnet', 'testnet'] as const) {
      const k = encodePrivateKeyWif(generatePrivateKey(), net);
      expect(realWifs(`x ${k} y`)).toEqual([k]);
      const broken = k.slice(0, -1) + (k.endsWith('a') ? 'b' : 'a');
      expect(realWifs(`x ${broken} y`)).toEqual([]); // broken checksum
    }
  });

  it('the seed phrase detector finds a real mnemonic and ignores a bad checksum (sanity check)', () => {
    const phrase = generateBip39Mnemonic();
    // "zzz" is not a BIP39 word, so the run is exactly the phrase ("seed" would be, and could add a window)
    expect(realMnemonics(`zzz: "${phrase}".`)).toEqual([phrase]);
    expect(realMnemonics('abandon '.repeat(12))).toEqual([]); // twelve words, wrong checksum
  });

  it('no tracked file contains a valid seed phrase', () => {
    const hits = trackedTextFiles().filter((f) => realMnemonics(readFileSync(join(ROOT, f), 'utf8')).length > 0);
    expect(hits).toEqual([]);
  });

  it('no tracked file contains a valid WIF private key', () => {
    const hits = trackedTextFiles().flatMap((f) => realWifs(readFileSync(join(ROOT, f), 'utf8')).map((w) => `${f}: ${w.slice(0, 6)}...`));
    expect(hits).toEqual([]);
  });

  it('no tracked file assigns a value to a secret env var', () => {
    const hits = trackedTextFiles().filter((f) => SECRET_ASSIGNMENT.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
    expect(SECRET_ASSIGNMENT.test('VERIFIER_PRIVATE_KEY=abcd')).toBe(true);
    expect(SECRET_ASSIGNMENT.test('VERIFIER_PRIVATE_KEY=\nNEXT=1')).toBe(false);
    expect(SECRET_ASSIGNMENT.test('LLM_API_KEY=<never commit>')).toBe(false);
    expect(SECRET_ASSIGNMENT.test('  AGENT_WIF=${k.AGENT_WIF}')).toBe(false);
    expect(SECRET_ASSIGNMENT.test('  AGENT_WIF=L1realLookingValue')).toBe(true);
  });

  it('no commit in the history ever contained a valid WIF', () => {
    const history = git('log', '--all', '-p', '--no-color', '--no-ext-diff');
    expect(history.length).toBeGreaterThan(1000);
    expect(realWifs(history)).toEqual([]);
    expect(realMnemonics(history)).toEqual([]);
  });

  it('.env files and the data directory are ignored by git', () => {
    for (const p of ['.env', '.env.local', '.env.production', 'data/mainnet-state.json', 'data/mainnet-db.json']) {
      expect(() => git('check-ignore', '-q', p), p).not.toThrow();
    }
    expect(() => git('check-ignore', '-q', '.env.example')).toThrow(); // the names-only template stays tracked
  });
});

describe('the client bundle carries no secrets', () => {
  const STATIC = join(ROOT, '.next', 'static');
  const built = existsSync(STATIC);

  // Runs after `next build`; CI without a build skips it. The import-boundary test in
  // boundary.test.ts covers the same risk from the source side on every run.
  it.skipIf(!built)('no WIF and no secret env var name in any built client chunk', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walk(STATIC);
    expect(files.length).toBeGreaterThan(5);
    const names = new RegExp(`\\b(${SECRET_NAMES})\\b`);
    const hits = files.flatMap((f) => {
      const src = readFileSync(f, 'utf8');
      return [...realWifs(src).map(() => `${f}: WIF`), ...(names.test(src) ? [`${f}: ${src.match(names)![0]}`] : [])];
    });
    expect(hits).toEqual([]);
  });
});

describe('token amounts stay integers (no Number / float math on amounts)', () => {
  const sources: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(p)) sources.push(p);
    }
  };
  for (const d of ['lib', 'app', 'scripts']) walk(join(ROOT, d));

  const AMOUNT = '[^)]*(?:amount|Amount|bond|Bond|fee\\b|Fee\\b|feeAmount|sats|Sats|satoshis|token|Token)';
  const rules: [string, RegExp][] = [
    ['parseFloat', /\bparseFloat\(/],
    ['toFixed on an amount', /(?:amount|Amount|bond|Bond|fee|Fee|sats|Sats|token|Token)\w*\)?\.toFixed\(/],
    ['Number(...) of an amount', new RegExp(`\\bNumber\\(${AMOUNT}`)],
    ['parseInt(...) of an amount', new RegExp(`\\bparseInt\\(${AMOUNT}`)],
    ['Math rounding of an amount', new RegExp(`\\bMath\\.(?:round|floor|ceil|trunc)\\(${AMOUNT}`)],
  ];

  it('scans the real source tree (sanity check)', () => {
    expect(sources.length).toBeGreaterThan(40);
    expect(rules[2][1].test('Number(offer.bondAmount)')).toBe(true);
    expect(rules[2][1].test('Number(c.terms.expiryHeight)')).toBe(false);
  });

  it.each(rules)('no %s anywhere in lib/, app/ or scripts/', (_name, re) => {
    const hits = sources.flatMap((f) =>
      readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (re.test(line) ? [`${f.slice(ROOT.length + 1)}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
