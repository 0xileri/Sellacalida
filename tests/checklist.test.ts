// Keeps SECURITY_CHECKLIST.md honest: it must list every item of spec section 9 word for word, and
// every test it cites must still exist under that exact name.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const specSection = read('SELLACALIDA_SPEC.md').split('## 9. Security test checklist')[1].split('\n## 10.')[0];
const specItems = specSection.split('\n').filter((l) => l.startsWith('- [ ] ')).map((l) => l.slice(6));

const doc = read('SECURITY_CHECKLIST.md');
interface Item { done: boolean; text: string; refs: [string, string][]; pending: boolean }
const items: Item[] = [];
for (const line of doc.split('\n')) {
  const box = line.match(/^- \[( |x)\] (.*)$/);
  if (box) {
    items.push({ done: box[1] === 'x', text: box[2], refs: [], pending: false });
    continue;
  }
  const ref = line.match(/^ {2}- `(tests\/[\w.]+\.test\.ts)` › "(.+)"$/);
  if (ref) items.at(-1)!.refs.push([ref[1], ref[2]]);
  if (/^ {2}- Pending: /.test(line)) items.at(-1)!.pending = true;
}

/** True if `name` is a test title in the file (quoted directly, or with escaped apostrophes). */
function hasTest(src: string, name: string) {
  const forms = [`'${name}'`, `"${name}"`, `\`${name}\``, `'${name.replace(/'/g, "\\'")}'`];
  return forms.some((f) => src.includes(`(${f}`));
}

describe('SECURITY_CHECKLIST.md', () => {
  it('lists every spec section 9 item, word for word and in order', () => {
    expect(specItems.length).toBe(43);
    expect(items.map((i) => i.text)).toEqual(specItems);
  });

  it('every ticked item cites at least one test; every open item says what is pending', () => {
    for (const i of items) {
      if (i.done) expect(i.refs.length, i.text).toBeGreaterThan(0);
      else expect(i.pending, i.text).toBe(true);
    }
  });

  it('every cited test exists under exactly that name', () => {
    const missing: string[] = [];
    for (const i of items) {
      for (const [file, name] of i.refs) {
        if (!existsSync(join(ROOT, file)) || !hasTest(read(file), name)) missing.push(`${file} › ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('the status line matches the boxes', () => {
    const done = items.filter((i) => i.done).length;
    expect(doc).toContain(`Status: **${done} of ${items.length} proven by tests.**`);
  });
});
