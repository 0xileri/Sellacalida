// Ask the live agent one challenge and print what it said. Nothing is committed or signed.
//
//   npm run agent:try                       built-in sample (math.exact_result)
//   npm run agent:try -- path/to/spec.json  any spec (it is validated first)
//
// Needs LLM_API_KEY and LLM_MODEL_ID in .env.local (LLM_BASE_URL defaults to Orbio).
import { existsSync, readFileSync } from 'node:fs';
import { llmFromEnv } from '../lib/agent/llm';
import { askAgent } from '../lib/agent/runner';
import { renderPrompt, validateSpecShape, type ChallengeSpec } from '../lib/templates/public';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const SAMPLE: ChallengeSpec = {
  templateId: 'math.exact_result', version: 1, network: 'chipnet',
  params: { op: 'mod', left: { op: 'mul', left: '-123456789', right: '987654321' }, right: { op: 'sub', left: '1000', right: '7' } },
};

const file = process.argv[2];
const spec = (file ? JSON.parse(readFileSync(file, 'utf8')) : SAMPLE) as ChallengeSpec;
const errors = validateSpecShape(spec);
if (errors.length) {
  console.error(`invalid spec: ${errors.join('; ')}`);
  process.exit(2);
}

const { client, model } = llmFromEnv();
console.log(`model requested: ${model}\n`);
console.log('--- prompt ---');
console.log(renderPrompt(spec));
const started = Date.now();
const a = await askAgent(spec, client, model);
console.log('\n--- raw reply ---');
console.log(a.rawResponse);
console.log('\n--- result ---');
console.log(`parsed answer: ${a.canonicalAnswer === '' ? '(none: would be committed as "" and fail)' : a.canonicalAnswer}`);
console.log(`served by:     ${a.servedModel}`);
console.log(`generation:    ${a.generationId ?? 'n/a'}`);
if (a.usage) console.log(`tokens:        ${a.usage.promptTokens} in / ${a.usage.completionTokens} out${a.usage.cost !== undefined ? `, cost $${a.usage.cost}` : ''}`);
console.log(`time:          ${Date.now() - started} ms`);
