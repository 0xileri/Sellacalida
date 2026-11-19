// Print fresh mainnet app keys once, to a terminal, and nowhere else.
import { formatAppKeys, generateAppKeys } from '../lib/server/appKeys';

function main() {
  if (!process.stdout.isTTY) {
    process.stderr.write(
      'Refusing to print private keys because stdout is not a terminal.\n' +
        'Run npm run keys in a terminal and paste them straight into Railway. Nothing is written to disk.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(formatAppKeys(generateAppKeys()));
}

// vitest imports this module only if a test asks; a direct `tsx scripts/app-keys.mts` prints
if (process.argv[1]?.includes('app-keys.mts')) main();
