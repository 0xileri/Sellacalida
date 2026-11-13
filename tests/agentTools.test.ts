// The agent's get_transaction tool and the tool loop. The tool returns public chain data decoded
// from raw hex that must hash to the txid; it holds no answer logic. Every call is recorded.
import { describe, expect, it, vi } from 'vitest';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import type { ChatRequest, ChatResult, LlmClient, ToolCall } from '@/lib/agent/llm';
import { openAiCompatibleClient } from '@/lib/agent/llm';
import { MAX_AGENT_TURNS, answerChallenge, askAgent } from '@/lib/agent/runner';
import { GET_TRANSACTION_TOOL, runTool } from '@/lib/agent/tools';
import { buildAccept } from '@/lib/bch/transactions';
import { escrowArgsFor, type ChallengeTerms } from '@/lib/contracts';
import { AnswerStore } from '@/lib/store/answers';
import { canonicalize, sha256Hex, specHashOf } from '@/lib/templates/canonical';
import type { ChallengeSpec } from '@/lib/templates/public';
import { runVerifier } from '@/lib/verifier/run';
import { reproduceEvidence } from '@/lib/verifier/evidence';
import { START_HEIGHT, addUtxo, baseOffer, challenger, fundedOffer, newProvider, verifier } from './helpers';
import { CAT_A, makeFixtureTx } from './chainFixture';

const call = (txid: string, id = 'call-1'): ToolCall => ({
  id, type: 'function', function: { name: 'get_transaction', arguments: JSON.stringify({ txid }) },
});
const reply = (o: Partial<ChatResult>): ChatResult => ({
  content: null, toolCalls: [], finishReason: 'stop', servedModel: 'anthropic/claude-sonnet-5.5', generationId: 'gen', usage: null, ...o,
});

function scripted(...turns: ChatResult[]) {
  const requests: ChatRequest[] = [];
  const client: LlmClient = {
    complete: vi.fn(async (req: ChatRequest) => {
      requests.push(structuredClone(req));
      const next = turns.shift();
      if (!next) throw new Error('script exhausted');
      return next;
    }),
  };
  return { client, requests };
}

describe('get_transaction tool', () => {
  it('returns decoded outputs: plain cashaddr, explorer-order categories, NFT commitments', async () => {
    const provider = newProvider();
    const fx = await makeFixtureTx(provider);
    const out = JSON.parse(await runTool('get_transaction', JSON.stringify({ txid: fx.txid }), { chain: provider, network: 'mocknet' }));
    expect(out.txid).toBe(fx.txid);
    expect(out.outputs).toHaveLength(6);
    expect(out.outputs[0]).toMatchObject({ index: 0, valueSatoshis: '1000', address: fx.addresses.alice, token: { category: CAT_A, amount: '50', nft: null } });
    expect(out.outputs[1].token).toEqual({ category: CAT_A, amount: '0', nft: { capability: 'none', commitment: 'aa' } });
    expect(out.outputs[2]).toMatchObject({ address: fx.addresses.alice, token: null });
    expect(out.outputs[3].address).toBe(fx.addresses.p2sh32);
  });

  it('gives the plain address only, so token-aware equivalence is still the agent\'s job', async () => {
    const provider = newProvider();
    const fx = await makeFixtureTx(provider);
    const out = await runTool('get_transaction', JSON.stringify({ txid: fx.txid }), { chain: provider, network: 'mocknet' });
    expect(out).not.toContain(fx.addresses.aliceTokenAware);
  });

  it.each([
    ['unknown tool', 'get_balance', '{"txid":"00"}', /unknown tool/],
    ['bad JSON', 'get_transaction', '{txid', /must be JSON/],
    ['bad txid', 'get_transaction', '{"txid":"xyz"}', /64 hex/],
    ['missing tx', 'get_transaction', JSON.stringify({ txid: 'ee'.repeat(32) }), /could not fetch/],
  ])('returns an error object for %s', async (_l, name, args, re) => {
    const out = JSON.parse(await runTool(name, args, { chain: newProvider(), network: 'mocknet' }));
    expect(out.error).toMatch(re);
  });

  it('refuses chain data that does not hash to the txid', async () => {
    const provider = newProvider();
    const fx = await makeFixtureTx(provider);
    // version 2 -> 3: still decodes, but no longer hashes to the requested txid
    expect(fx.rawHex.startsWith('02')).toBe(true);
    const lying = { getRawTransaction: async () => '03' + fx.rawHex.slice(2) };
    const out = JSON.parse(await runTool('get_transaction', JSON.stringify({ txid: fx.txid }), { chain: lying, network: 'mocknet' }));
    expect(out.error).toMatch(/hashes to/);
  });
});

describe('tool loop', () => {
  it('offers the tool for BCH templates, runs it, and feeds the result back', async () => {
    const provider = newProvider();
    const fx = await makeFixtureTx(provider);
    const spec: ChallengeSpec = { templateId: 'bch.output_token_count', version: 1, network: 'mocknet', params: { txid: fx.txid, category: CAT_A } };
    const { client, requests } = scripted(reply({ toolCalls: [call(fx.txid)] }), reply({ content: '3' }));
    const a = await askAgent(spec, client, 'anthropic/claude-sonnet-5.5', { chain: provider });
    expect(requests[0].tools).toEqual([GET_TRANSACTION_TOOL]);
    expect(requests).toHaveLength(2);
    const toolMsg = requests[1].messages.find((m) => m.role === 'tool');
    expect(toolMsg && JSON.parse(toolMsg.content).outputs).toHaveLength(6);
    expect(a.canonicalAnswer).toBe('3');
    expect(a.toolCalls).toEqual([
      { name: 'get_transaction', arguments: JSON.stringify({ txid: fx.txid }), ok: true, resultSha256: sha256Hex(toolMsg!.content) },
    ]);
  });

  it('never offers tools for math', async () => {
    const spec: ChallengeSpec = { templateId: 'math.exact_result', version: 1, network: 'mocknet', params: { op: 'add', left: '1', right: '2' } };
    const { client, requests } = scripted(reply({ content: '3' }));
    await askAgent(spec, client, 'm', { chain: newProvider() });
    expect(requests[0].tools).toEqual([]);
  });

  it('an agent still calling tools after the turn cap has no answer', async () => {
    const provider = newProvider();
    const fx = await makeFixtureTx(provider);
    const spec: ChallengeSpec = { templateId: 'bch.output_token_count', version: 1, network: 'mocknet', params: { txid: fx.txid, category: CAT_A } };
    const turns = Array.from({ length: MAX_AGENT_TURNS }, (_, i) => reply({ content: i === MAX_AGENT_TURNS - 1 ? '3' : null, toolCalls: [call(fx.txid, `c${i}`)] }));
    const { client } = scripted(...turns);
    const a = await askAgent(spec, client, 'm', { chain: provider });
    expect(a.canonicalAnswer).toBe('');
    expect(a.toolCalls).toHaveLength(MAX_AGENT_TURNS);
  });

  it('the OpenAI client sends tools and parses tool_calls', async () => {
    const tc = call('ab'.repeat(32));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'gen-9', model: 'anthropic/claude-sonnet-5.5',
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [tc] } }],
    }))) as unknown as typeof fetch;
    const r = await openAiCompatibleClient({ apiKey: 'k', fetchImpl }).complete({ model: 'm', messages: [], tools: [GET_TRANSACTION_TOOL] });
    const sent = JSON.parse(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    expect(sent.tools).toEqual([GET_TRANSACTION_TOOL]);
    expect(r).toMatchObject({ content: null, toolCalls: [tc], finishReason: 'tool_calls' });
  });
});

describe('tool calls reach the commitment and the evidence', () => {
  it('end to end: agent uses the tool, answers wrong, verifier FAILs, evidence lists the call', async () => {
    const provider = newProvider();
    const fx = await makeFixtureTx(provider);
    const offer = baseOffer();
    const spec: ChallengeSpec = { templateId: 'bch.output_token_count', version: 1, network: 'mocknet', params: { txid: fx.txid, category: CAT_A } };
    const terms: ChallengeTerms = {
      challengerPkh: challenger.pkh, challengeId: sha256.hash(utf8ToBin('tool-e2e')), specHash: specHashOf(spec),
      expiryHeight: BigInt(START_HEIGHT + 100),
    };
    const { offerContract, offerUtxo } = fundedOffer(provider, offer);
    const tok = addUtxo(provider, challenger.lockHex, 10_000n, { category: offer.tokenCategory, amount: 20n });
    const acc = await buildAccept({
      provider, offer, offerContract, offerUtxo, terms, escrowArgs: escrowArgsFor(offer, terms),
      challengerTokenInput: { utxo: tok, unlocker: challenger.template.unlockP2PKH() }, escrowSatoshis: 5000n, locktime: START_HEIGHT,
    }).send();

    const store = new AnswerStore();
    const { client } = scripted(reply({ toolCalls: [call(fx.txid)] }), reply({ content: 'I count 2 outputs, so: 2' }));
    const { commitment } = await answerChallenge({
      spec, challengeId: binToHex(terms.challengeId), store, client, model: 'anthropic/claude-sonnet-5.5',
      currentHeight: START_HEIGHT + 1, answerDeadline: START_HEIGHT + 82, chain: provider,
    });
    expect(commitment.toolCalls).toHaveLength(1);
    expect(commitment.canonicalAnswer).toBe('');

    const out = await runVerifier(
      { network: 'mocknet', offer, terms, specJson: canonicalize(spec), escrow: { txid: acc.txid, vout: 0, satoshis: 5000n } },
      commitment, { provider, verifierPrivateKey: verifier.priv },
    );
    if (out.kind !== 'settled') throw new Error(JSON.stringify(out));
    expect(out.verdict).toBe('FAIL');
    expect(out.evidence.answer?.toolCalls).toEqual(commitment.toolCalls);
    expect(reproduceEvidence(JSON.parse(JSON.stringify(out.evidence))).ok).toBe(true);
  });
});
