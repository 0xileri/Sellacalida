// Agent runner: OpenAI-compatible client (Orbio by default), strict answer parsing, and the
// ask-then-commit sequence. Uses a fake fetch; the live call is scripts/agent-try.mts.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LLM_BASE_URL, LlmHttpError, openAiCompatibleClient, type LlmClient } from '@/lib/agent/llm';
import { parseAnswer } from '@/lib/agent/parse';
import { AGENT_SYSTEM_PROMPT, answerChallenge } from '@/lib/agent/runner';
import { AnswerStore } from '@/lib/store/answers';
import { sha256Hex } from '@/lib/templates/canonical';
import { renderPrompt, type ChallengeSpec } from '@/lib/templates/public';

const okBody = (content: string, model = 'anthropic/claude-sonnet-5.5') => ({
  id: 'gen-123', model, object: 'chat.completion',
  choices: [{ message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 50, completion_tokens: 3, cost: 0.00013 },
});

function fakeFetch(...responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const r = queue.shift();
    if (!r) throw new Error('no more fake responses');
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('openAiCompatibleClient', () => {
  it('posts an OpenAI-style chat request to Orbio with a bearer key', async () => {
    const f = fakeFetch({ status: 200, body: okBody('42') });
    const client = openAiCompatibleClient({ apiKey: 'sk-test', fetchImpl: f.fn });
    const r = await client.complete({ model: 'anthropic/claude-sonnet-5.5', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 });
    expect(f.calls[0].url).toBe(`${DEFAULT_LLM_BASE_URL}/chat/completions`);
    expect(DEFAULT_LLM_BASE_URL).toBe('https://api.orbio.so/api/v1');
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      model: 'anthropic/claude-sonnet-5.5', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10,
    });
    expect(r).toEqual({
      content: '42', toolCalls: [], finishReason: null, servedModel: 'anthropic/claude-sonnet-5.5', generationId: 'gen-123',
      usage: { promptTokens: 50, completionTokens: 3, cost: 0.00013 },
    });
  });

  it('records the model the provider actually served', async () => {
    const f = fakeFetch({ status: 200, body: okBody('1', 'anthropic/claude-sonnet-5.5-20261101') });
    const r = await openAiCompatibleClient({ apiKey: 'k', fetchImpl: f.fn }).complete({ model: 'anthropic/claude-sonnet-5.5', messages: [] });
    expect(r.servedModel).toBe('anthropic/claude-sonnet-5.5-20261101');
  });

  it('works with any OpenAI-compatible base URL (trailing slash ok)', async () => {
    const f = fakeFetch({ status: 200, body: okBody('1') });
    await openAiCompatibleClient({ apiKey: 'k', baseUrl: 'https://example.test/v1/', fetchImpl: f.fn }).complete({ model: 'm', messages: [] });
    expect(f.calls[0].url).toBe('https://example.test/v1/chat/completions');
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const f = fakeFetch({ status: 429, body: 'slow down' }, { status: 502, body: 'bad gateway' }, { status: 200, body: okBody('7') });
    const r = await openAiCompatibleClient({ apiKey: 'k', fetchImpl: f.fn, retries: 2 }).complete({ model: 'm', messages: [] });
    expect(r.content).toBe('7');
    expect(f.calls).toHaveLength(3);
  }, 20_000);

  it('does not retry a 4xx such as a bad key', async () => {
    const f = fakeFetch({ status: 401, body: 'invalid key' });
    await expect(openAiCompatibleClient({ apiKey: 'k', fetchImpl: f.fn }).complete({ model: 'm', messages: [] })).rejects.toThrow(LlmHttpError);
    expect(f.calls).toHaveLength(1);
  });

  it('rejects a response without message content', async () => {
    const f = fakeFetch({ status: 200, body: { choices: [] } });
    await expect(openAiCompatibleClient({ apiKey: 'k', fetchImpl: f.fn }).complete({ model: 'm', messages: [] })).rejects.toThrow(/no choices/);
  });
});

describe('parseAnswer is strict', () => {
  it.each<[ChallengeSpec['templateId'], string, string]>([
    ['bch.output_token_count', '3', '3'],
    ['bch.output_token_count', '  3\n', '3'],
    ['bch.output_token_count', '`3`', '3'],
    ['bch.output_token_count', '```\n3\n```', '3'],
    ['bch.output_token_count', '3.', '3'],
    ['bch.output_token_count', '**3**', '3'], // seen live from Sonnet 5.5
    ['bch.total_sats_to_address', '**4000**', '4000'],
    ['bch.output_token_count', 'The answer is 3', '3'],
    ['bch.output_token_count', 'Output 3 holds it.', '3'],
    ['bch.output_token_count', '03', ''],
    ['bch.output_token_count', 'either 2 or 3', ''],
    ['bch.output_token_count', 'I cannot access the blockchain.', ''],
    ['bch.total_sats_to_address', '15,000', ''],
    ['bch.total_sats_to_address', '15000', '15000'],
    ['bch.total_sats_to_address', '1.5', ''],
    ['bch.nft_output_index', '-1', '-1'],
    ['bch.nft_output_index', 'No unique match, so -1', '-1'],
    ['bch.output_token_count', '-1', ''],
    ['math.exact_result', '-10', '-10'],
    ['math.exact_result', 'Result: -10', '-10'],
    ['math.exact_result', '-7 * 3 / 2 = -10', ''],
    ['math.exact_result', 'v2', ''],
  ])('%s %j -> %j', (t, raw, want) => {
    expect(parseAnswer(t, raw)).toBe(want);
  });
});

const SPEC: ChallengeSpec = {
  templateId: 'math.exact_result', version: 1, network: 'mocknet',
  params: { op: 'div', left: { op: 'mul', left: '-7', right: '3' }, right: '2' },
};
const ID = 'cd'.repeat(32);

function stubClient(content: string, servedModel = 'anthropic/claude-sonnet-5.5'): LlmClient & { complete: ReturnType<typeof vi.fn> } {
  return {
    complete: vi.fn(async () => ({ content, toolCalls: [], finishReason: 'stop', servedModel, generationId: 'gen-1', usage: null })),
  };
}

describe('answerChallenge', () => {
  it('sends only the public prompt, then commits the parsed answer with the served model id', async () => {
    const store = new AnswerStore();
    const client = stubClient('The result is -10.', 'anthropic/claude-sonnet-5.5');
    const { commitment } = await answerChallenge({
      spec: SPEC, challengeId: ID, store, client, model: 'anthropic/claude-sonnet-5.5', currentHeight: 10, answerDeadline: 50,
    });
    const req = client.complete.mock.calls[0][0];
    expect(req.messages).toEqual([
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      { role: 'user', content: renderPrompt(SPEC) },
    ]);
    expect(commitment).toMatchObject({
      source: 'ai', modelId: 'anthropic/claude-sonnet-5.5', canonicalAnswer: '-10',
      rawResponse: 'The result is -10.', rawResponseHash: sha256Hex('The result is -10.'), answerHash: sha256Hex('-10'),
    });
    expect(store.get(ID)).toEqual(commitment);
  });

  it('an unparseable reply is committed as "" (it will fail), with the raw reply kept', async () => {
    const store = new AnswerStore();
    const { commitment } = await answerChallenge({
      spec: SPEC, challengeId: ID, store, client: stubClient('somewhere around -10 or -11'), model: 'm', currentHeight: 1, answerDeadline: 5,
    });
    expect(commitment.canonicalAnswer).toBe('');
    expect(commitment.rawResponse).toBe('somewhere around -10 or -11');
  });

  it('does not call the model when an answer is already committed', async () => {
    const store = new AnswerStore();
    await answerChallenge({ spec: SPEC, challengeId: ID, store, client: stubClient('-10'), model: 'm', currentHeight: 1, answerDeadline: 5 });
    const second = stubClient('-11');
    await expect(answerChallenge({ spec: SPEC, challengeId: ID, store, client: second, model: 'm', currentHeight: 2, answerDeadline: 5 })).rejects.toThrow(/already/);
    expect(second.complete).not.toHaveBeenCalled();
  });

  it('does not call the model after the answer deadline', async () => {
    const client = stubClient('-10');
    await expect(answerChallenge({ spec: SPEC, challengeId: ID, store: new AnswerStore(), client, model: 'm', currentHeight: 5, answerDeadline: 5 })).rejects.toThrow(/deadline/);
    expect(client.complete).not.toHaveBeenCalled();
  });
});
