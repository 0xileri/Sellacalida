// The live agent: ask a real LLM, then commit its answer in one atomic, write-once store record
// (spec section 5, steps 1-3). It sees the public prompt and params and, for BCH templates, a
// get_transaction tool over public chain data. It cannot import the checkers or the verifier, and
// it never sees an expected answer.
import type { RawTxReader } from '../bch/txSource';
import type { AnswerCommitment, AnswerStore, ToolCallRecord } from '../store/answers';
import { sha256Hex } from '../templates/canonical';
import { renderPrompt, type ChallengeSpec } from '../templates/public';
import type { ChatMessage, ChatResult, LlmClient } from './llm';
import { parseAnswer } from './parse';
import { GET_TRANSACTION_TOOL, runTool } from './tools';

export const AGENT_SYSTEM_PROMPT =
  'You are an AI agent taking a bonded test. Your own money is at stake: a correct answer earns the ' +
  "challenger's fee, a wrong one loses your bond. Work carefully, then reply in exactly the requested format.";

/** Model turns allowed, including the final answer. Beyond this the answer is "" (fails). */
export const MAX_AGENT_TURNS = 5;

export interface AgentAnswer {
  rawResponse: string;
  canonicalAnswer: string;
  servedModel: string;
  generationIds: string[];
  toolCalls: ToolCallRecord[];
  usage: { promptTokens: number; completionTokens: number; cost: number | null };
}

export interface AskOptions {
  /** chain access for the get_transaction tool; offered only for BCH templates */
  chain?: RawTxReader;
}

export async function askAgent(spec: ChallengeSpec, client: LlmClient, model: string, opts: AskOptions = {}): Promise<AgentAnswer> {
  const tools = opts.chain && spec.templateId.startsWith('bch.') ? [GET_TRANSACTION_TOOL] : [];
  const messages: ChatMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: renderPrompt(spec) },
  ];
  const toolCalls: ToolCallRecord[] = [];
  const generationIds: string[] = [];
  const usage = { promptTokens: 0, completionTokens: 0, cost: null as number | null };
  let last: ChatResult | null = null;
  let finalText: string | null = null;

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
    last = await client.complete({ model, messages, tools, maxTokens: 2000 });
    if (last.generationId) generationIds.push(last.generationId);
    usage.promptTokens += last.usage?.promptTokens ?? 0;
    usage.completionTokens += last.usage?.completionTokens ?? 0;
    if (last.usage?.cost !== undefined) usage.cost = (usage.cost ?? 0) + last.usage.cost;

    if (last.toolCalls.length === 0 || tools.length === 0) {
      finalText = last.content ?? '';
      break;
    }
    messages.push({ role: 'assistant', content: last.content, tool_calls: last.toolCalls });
    for (const call of last.toolCalls) {
      const result = await runTool(call.function.name, call.function.arguments, { chain: opts.chain!, network: spec.network });
      const error = result.startsWith('{"error"') ? (JSON.parse(result) as { error: string }).error : undefined;
      toolCalls.push({
        name: call.function.name,
        arguments: call.function.arguments,
        ok: error === undefined,
        resultSha256: sha256Hex(result),
        ...(error !== undefined ? { error } : {}),
      });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  // finalText stays null when the model was still calling tools after MAX_AGENT_TURNS: no answer
  return {
    rawResponse: finalText ?? last?.content ?? '',
    canonicalAnswer: finalText === null ? '' : parseAnswer(spec.templateId, finalText),
    servedModel: last?.servedModel ?? model,
    generationIds,
    toolCalls,
    usage,
  };
}

/** Ask the model and commit its answer, recording the model id that actually served it. */
export async function answerChallenge(o: {
  spec: ChallengeSpec;
  challengeId: string;
  store: AnswerStore;
  client: LlmClient;
  model: string;
  currentHeight: number;
  answerDeadline: number;
  chain?: RawTxReader;
}): Promise<{ commitment: AnswerCommitment; answer: AgentAnswer }> {
  if (o.store.get(o.challengeId)) throw new Error(`challenge ${o.challengeId} already has a committed answer`);
  if (o.currentHeight >= o.answerDeadline) throw new Error('answer deadline has passed; not calling the model');
  const answer = await askAgent(o.spec, o.client, o.model, { chain: o.chain });
  const commitment = o.store.commit(
    {
      challengeId: o.challengeId,
      templateId: o.spec.templateId,
      source: 'ai',
      modelId: answer.servedModel,
      rawResponse: answer.rawResponse,
      canonicalAnswer: answer.canonicalAnswer,
      toolCalls: answer.toolCalls,
    },
    { currentHeight: o.currentHeight, answerDeadline: o.answerDeadline },
  );
  return { commitment, answer };
}
