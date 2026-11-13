// The live agent: ask a real LLM, then commit its answer in one atomic, write-once store record
// (spec section 5, steps 1-3). It sees only the public prompt and params. It cannot import the
// checkers or the verifier, and it never sees an expected answer.
import type { AnswerCommitment, AnswerStore } from '../store/answers';
import { renderPrompt, type ChallengeSpec } from '../templates/public';
import type { ChatResult, LlmClient } from './llm';
import { parseAnswer } from './parse';

export const AGENT_SYSTEM_PROMPT =
  'You are an AI agent taking a bonded test. Your own money is at stake: a correct answer earns the ' +
  "challenger's fee, a wrong one loses your bond. Work carefully, then reply in exactly the requested format.";

export interface AgentAnswer {
  rawResponse: string;
  canonicalAnswer: string;
  servedModel: string;
  generationId: string | null;
  usage: ChatResult['usage'];
}

export async function askAgent(spec: ChallengeSpec, client: LlmClient, model: string): Promise<AgentAnswer> {
  const r = await client.complete({
    model,
    messages: [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      { role: 'user', content: renderPrompt(spec) },
    ],
    maxTokens: 2000,
  });
  return {
    rawResponse: r.content,
    canonicalAnswer: parseAnswer(spec.templateId, r.content),
    servedModel: r.servedModel,
    generationId: r.generationId,
    usage: r.usage,
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
}): Promise<{ commitment: AnswerCommitment; answer: AgentAnswer }> {
  if (o.store.get(o.challengeId)) throw new Error(`challenge ${o.challengeId} already has a committed answer`);
  if (o.currentHeight >= o.answerDeadline) throw new Error('answer deadline has passed; not calling the model');
  const answer = await askAgent(o.spec, o.client, o.model);
  const commitment = o.store.commit(
    {
      challengeId: o.challengeId,
      templateId: o.spec.templateId,
      source: 'ai',
      modelId: answer.servedModel,
      rawResponse: answer.rawResponse,
      canonicalAnswer: answer.canonicalAnswer,
    },
    { currentHeight: o.currentHeight, answerDeadline: o.answerDeadline },
  );
  return { commitment, answer };
}
