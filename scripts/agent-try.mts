// Ask the live agent one challenge and print what it said. Nothing is committed or signed.
//
//   npm run agent:try                       built-in sample (math.exact_result)
//   npm run agent:try -- path/to/spec.json  any spec (it is validated first)
//
// Needs LLM_API_KEY and LLM_MODEL_ID in .env.local (LLM_BASE_URL defaults to Orbio).
import { existsSync, readFileSync } from 'node:fs';
import { llmFromEnv } from '../lib/agent/llm';
import { makeProvider } from '../lib/bch/network';
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
// BCH templates get the get_transaction tool over a real Electrum connection for the spec's network
const chain =
  spec.templateId.startsWith('bch.') && spec.network !== 'mocknet'
    ? makeProvider(spec.network, process.env.ELECTRUM_HOSTNAME)
    : undefined;
const a = await askAgent(spec, client, model, { chain });
console.log('\n--- raw reply ---');
console.log(a.rawResponse);
console.log('\n--- result ---');
console.log(`parsed answer: ${a.canonicalAnswer === '' ? '(none: would be committed as "" and fail)' : a.canonicalAnswer}`);
console.log(`served by:     ${a.servedModel}`);
console.log(`generations:   ${a.generationIds.join(', ') || 'n/a'}`);
for (const t of a.toolCalls) console.log(`tool call:     ${t.name}(${t.arguments}) ${t.ok ? 'ok' : `error: ${t.error}`}`);
const cost = a.usage.cost !== null ? `, cost $${a.usage.cost.toFixed(6)}` : '';
console.log(`tokens:        ${a.usage.promptTokens} in / ${a.usage.completionTokens} out${cost}`);
console.log(`time:          ${Date.now() - started} ms`);
process.exit(0);
