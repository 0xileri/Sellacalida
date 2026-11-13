// Minimal OpenAI-compatible chat client. Default provider: Orbio's gateway
// (https://api.orbio.so/api/v1), which serves model ids like "anthropic/claude-sonnet-5.5" and
// takes the key as "Authorization: Bearer <key>". Any OpenAI-compatible base URL works.
//
// This file is part of the agent runner: it may never import checkers, the verifier or anything
// that knows an expected answer (tests/boundary.test.ts).

export const DEFAULT_LLM_BASE_URL = 'https://api.orbio.so/api/v1';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  content: string;
  /** model id the provider says actually served the request (falls back to the requested id) */
  servedModel: string;
  /** provider generation id, when given (e.g. "gen-...") */
  generationId: string | null;
  usage: { promptTokens?: number; completionTokens?: number; cost?: number } | null;
}

export interface LlmClient {
  complete(req: ChatRequest): Promise<ChatResult>;
}

export interface OpenAiCompatibleOptions {
  baseUrl?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** retries on 429 / 5xx / network errors, before any answer has been seen */
  retries?: number;
}

export class LlmHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`LLM request failed with HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

export function openAiCompatibleClient(o: OpenAiCompatibleOptions): LlmClient {
  const base = (o.baseUrl ?? DEFAULT_LLM_BASE_URL).replace(/\/+$/, '');
  const doFetch = o.fetchImpl ?? fetch;
  const retries = o.retries ?? 2;

  return {
    async complete(req) {
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        let res: Response;
        try {
          res = await doFetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model: req.model,
              messages: req.messages,
              ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
              ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            }),
            signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
          });
        } catch (e) {
          lastError = e;
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          lastError = new LlmHttpError(res.status, await res.text());
          continue;
        }
        if (!res.ok) throw new LlmHttpError(res.status, await res.text());
        const body = (await res.json()) as {
          id?: string;
          model?: string;
          choices?: { message?: { content?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('LLM response has no choices[0].message.content');
        return {
          content,
          servedModel: body.model || req.model,
          generationId: body.id ?? null,
          usage: body.usage
            ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, cost: body.usage.cost }
            : null,
        };
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
  };
}

/** Server-side config from the environment (.env.local). */
export function llmFromEnv(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL_ID;
  if (!apiKey) throw new Error('LLM_API_KEY is not set (put your Orbio key in .env.local)');
  if (!model) throw new Error('LLM_MODEL_ID is not set (e.g. anthropic/claude-sonnet-5.5)');
  return { client: openAiCompatibleClient({ apiKey, baseUrl: env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL }), model };
}
