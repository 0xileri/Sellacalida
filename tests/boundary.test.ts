// Evaluation integrity (spec sections 5 and 9): the agent runner and client components must not be
// able to reach the checkers, the verifier or its keys, even through a chain of imports. This walks
// the real import graph (relative and "@/" imports) from each entry point.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const EXT = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(f)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec.startsWith('@/')) base = join(root, spec.slice(2));
  else return null; // package import
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
  return specs.map((s) => resolveImport(file, s)).filter((p): p is string => !!p);
}

function reachable(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length) {
    const f = queue.shift()!;
    for (const dep of importsOf(f)) {
      if (!seen.has(dep)) {
        seen.set(dep, [...seen.get(f)!, dep]);
        queue.push(dep);
      }
    }
  }
  return seen;
}

const rel = (p: string) => relative(root, p);
const FORBIDDEN_FOR_AGENT = [/^lib\/templates\/check\//, /^lib\/verifier\//];
const FORBIDDEN_FOR_CLIENT = [/^lib\/templates\/check\//, /^lib\/verifier\//, /^lib\/store\//, /^lib\/server\//];

function violations(entries: string[], forbidden: RegExp[]) {
  const out: string[] = [];
  for (const entry of entries) {
    for (const [file, path] of reachable(entry)) {
      if (forbidden.some((re) => re.test(rel(file)))) out.push(path.map(rel).join(' -> '));
    }
  }
  return out;
}

describe('import boundaries', () => {
  it('the resolver sees real edges (sanity check)', () => {
    const r = reachable(join(root, 'lib/verifier/run.ts'));
    expect([...r.keys()].map(rel)).toContain('lib/templates/check/index.ts');
  });

  it('lib/agent, the store and the public template layer cannot reach checkers or the verifier', () => {
    const entries = [
      ...walk(join(root, 'lib/agent')),
      ...walk(join(root, 'lib/store')),
      join(root, 'lib/templates/public.ts'),
      join(root, 'lib/templates/canonical.ts'),
    ];
    expect(violations(entries, FORBIDDEN_FOR_AGENT)).toEqual([]);
  });

  it('client components cannot reach checkers, the verifier, the store or any server module', () => {
    const clientFiles = walk(join(root, 'app')).filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')));
    expect(clientFiles.length).toBeGreaterThan(0);
    expect(violations(clientFiles, FORBIDDEN_FOR_CLIENT)).toEqual([]);
  });

  it('only server code reads VERIFIER_PRIVATE_KEY', () => {
    const readers = [...walk(join(root, 'lib')), ...walk(join(root, 'app'))]
      .filter((f) => readFileSync(f, 'utf8').includes('VERIFIER_PRIVATE_KEY'))
      .map(rel);
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.filter((f) => !/^lib\/(verifier|server)\//.test(f))).toEqual([]);
  });
});
