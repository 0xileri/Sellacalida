// Write-once answer commitments (spec section 5, steps 2-3). One record per challenge, stored in a
// single atomic write; any later attempt to change the answer, raw response or hashes is refused.
// The chain stays the source of truth for money; this store is what proves the answer existed
// before the verifier looked at the expected one.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha256Hex } from '../templates/canonical';
import { isWellFormedAnswer, type TemplateId } from '../templates/public';
import { formatWAT } from '../time';

export type AnswerSource = 'ai' | 'fixture';

export interface AnswerCommitInput {
  challengeId: string; // hex
  templateId: TemplateId;
  source: AnswerSource;
  /** required for source "ai" */
  modelId: string | null;
  rawResponse: string;
  /** the parsed answer; '' when the model's reply could not be parsed (it then simply fails) */
  canonicalAnswer: string;
}

export interface AnswerCommitment {
  challengeId: string;
  templateId: TemplateId;
  source: AnswerSource;
  modelId: string | null;
  rawResponse: string;
  rawResponseHash: string;
  canonicalAnswer: string;
  answerHash: string;
  committedAtHeight: number;
  committedAtWAT: string;
}

export class AnswerStore {
  private answers = new Map<string, AnswerCommitment>();

  /** With no path the store lives in memory (tests); with a path it persists to a JSON file. */
  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as { answers: AnswerCommitment[] };
      for (const a of data.answers) this.answers.set(a.challengeId, Object.freeze(a));
    }
  }

  get(challengeId: string): AnswerCommitment | null {
    return this.answers.get(challengeId) ?? null;
  }

  commit(input: AnswerCommitInput, ctx: { currentHeight: number; answerDeadline: number; now?: Date }): AnswerCommitment {
    if (!/^[0-9a-f]{64}$/.test(input.challengeId)) throw new Error('challengeId must be 32-byte lowercase hex');
    if (this.answers.has(input.challengeId)) {
      throw new Error(`an answer is already committed for ${input.challengeId}; commitments are write-once`);
    }
    if (ctx.currentHeight >= ctx.answerDeadline) {
      throw new Error(`answer deadline ${ctx.answerDeadline} has passed (height ${ctx.currentHeight}); too late to commit`);
    }
    if (input.source === 'ai' && !input.modelId) throw new Error('an ai answer must record its model id');
    if (input.canonicalAnswer !== '' && !isWellFormedAnswer(input.templateId, input.canonicalAnswer)) {
      throw new Error(`"${input.canonicalAnswer}" is not a canonical answer for ${input.templateId}`);
    }
    const record: AnswerCommitment = Object.freeze({
      challengeId: input.challengeId,
      templateId: input.templateId,
      source: input.source,
      modelId: input.modelId,
      rawResponse: input.rawResponse,
      rawResponseHash: sha256Hex(input.rawResponse),
      canonicalAnswer: input.canonicalAnswer,
      answerHash: sha256Hex(input.canonicalAnswer),
      committedAtHeight: ctx.currentHeight,
      committedAtWAT: formatWAT(ctx.now),
    });
    this.answers.set(record.challengeId, record);
    this.persist();
    return record;
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ answers: [...this.answers.values()] }, null, 2));
    renameSync(tmp, this.filePath); // atomic replace: a crash never leaves a half-written record
  }
}
