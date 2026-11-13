// Minimal OpenAI-compatible chat client with tool calling. Default provider: Orbio's gateway
// (https://api.orbio.so/api/v1), which serves model ids like "anthropic/claude-sonnet-5.5" and
// takes the key as "Authorization: Bearer <key>". Any OpenAI-compatible base URL works.
//
// This file is part of the agent runner: it may never import checkers, the verifier or anything
// that knows an expected answer (tests/boundary.test.ts).

export const DEFAULT_LLM_BASE_URL = 'https://api.orbio.so/api/v1';
export const DEFAULT_LLM_MODEL = 'anthropic/claude-sonnet-5.5';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
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
              ...(req.tools?.length ? { tools: req.tools } : {}),
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
          choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        };
        const choice = body.choices?.[0];
        const content = typeof choice?.message?.content === 'string' ? choice.message.content : null;
        const toolCalls = (choice?.message?.tool_calls ?? []).filter((t) => t?.type === 'function' && t.function?.name);
        if (content === null && toolCalls.length === 0) throw new Error('LLM response has no choices[0].message content or tool calls');
        return {
          content,
          toolCalls,
          finishReason: choice?.finish_reason ?? null,
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
  if (!apiKey) throw new Error('LLM_API_KEY is not set (put your Orbio key in .env.local)');
  return {
    client: openAiCompatibleClient({ apiKey, baseUrl: env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL }),
    model: env.LLM_MODEL_ID || DEFAULT_LLM_MODEL,
  };
}
