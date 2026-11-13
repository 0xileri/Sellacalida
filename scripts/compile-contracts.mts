// Compiles contracts/*.cash into contracts/artifacts/*.json.
// Run: npm run compile   (tests/artifacts.test.ts fails if artifacts are stale)
import { compileFile } from 'cashc';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'contracts');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.cash'))) {
  const artifact = compileFile(join(dir, file));
  // updatedAt changes on every compile; drop it so artifacts are reproducible
  const { updatedAt: _ignored, ...stable } = artifact as typeof artifact & { updatedAt?: string };
  const out = join(dir, 'artifacts', file.replace(/\.cash$/, '.json'));
  writeFileSync(out, JSON.stringify(stable, null, 2) + '\n');
  const bytes = artifact.bytecode.split(' ').length;
  console.log(`${file} -> ${out} (${bytes} asm tokens)`);
}
