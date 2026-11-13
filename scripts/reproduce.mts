// Re-check a published verdict from its evidence file alone:
//   npm run reproduce -- path/to/evidence.json
// Re-runs the checker on the cached raw transaction (verified against its txid), rebuilds the
// 156-byte attestation from the evidence fields, and verifies the verifier's signature.
import { readFileSync } from 'node:fs';
import { reproduceEvidence, type Evidence } from '../lib/verifier/evidence';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run reproduce -- <evidence.json>');
  process.exit(2);
}
const evidence = JSON.parse(readFileSync(file, 'utf8')) as Evidence;
const r = reproduceEvidence(evidence);
console.log(`challenge  ${evidence.challengeId}`);
console.log(`verdict    ${evidence.verdict}   (re-run: ${r.recomputedVerdict ?? 'n/a'})`);
if (r.recomputedExpected !== undefined) console.log(`expected   ${r.recomputedExpected}   answer: ${evidence.answer?.canonicalAnswer}`);
console.log(`settle tx  ${evidence.settleTxid ?? '(not broadcast)'}`);
if (r.ok) {
  console.log('\nOK: checker, attestation and signature all reproduce.');
} else {
  console.log('\nPROBLEMS:');
  for (const p of r.problems) console.log(`  - ${p}`);
  process.exit(1);
}
