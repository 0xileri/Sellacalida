// Write-once answer commitments (spec section 5 steps 2-3, section 9 evaluation checklist).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnswerStore, type AnswerCommitInput } from '@/lib/store/answers';
import { sha256Hex } from '@/lib/templates/canonical';

const ID = 'ab'.repeat(32);
const ctx = { currentHeight: 100, answerDeadline: 182 };
const input: AnswerCommitInput = {
  challengeId: ID, templateId: 'math.exact_result', source: 'ai', modelId: 'test-model-1',
  rawResponse: 'The answer is -10.', canonicalAnswer: '-10',
};

describe('AnswerStore', () => {
  it('records the model id, raw response hash and answer hash in one write', () => {
    const s = new AnswerStore();
    const c = s.commit(input, ctx);
    expect(c.rawResponseHash).toBe(sha256Hex('The answer is -10.'));
    expect(c.answerHash).toBe(sha256Hex('-10'));
    expect(c.modelId).toBe('test-model-1');
    expect(c.committedAtHeight).toBe(100);
    expect(c.committedAtWAT).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} WAT$/);
    expect(s.get(ID)).toEqual(c);
  });

  it('is write-once: a second commit for the same challenge is refused', () => {
    const s = new AnswerStore();
    s.commit(input, ctx);
    expect(() => s.commit({ ...input, canonicalAnswer: '-11' }, ctx)).toThrow(/write-once/);
    expect(s.get(ID)?.canonicalAnswer).toBe('-10');
  });

  it('returned records cannot be mutated', () => {
    const s = new AnswerStore();
    const c = s.commit(input, ctx);
    expect(() => {
      (c as { canonicalAnswer: string }).canonicalAnswer = '42';
    }).toThrow();
  });

  it('refuses commits at or after the answer deadline', () => {
    expect(() => new AnswerStore().commit(input, { currentHeight: 182, answerDeadline: 182 })).toThrow(/deadline/);
  });

  it('an ai answer must record its model id; a fixture may not need one', () => {
    expect(() => new AnswerStore().commit({ ...input, modelId: null }, ctx)).toThrow(/model id/);
    const f = new AnswerStore().commit({ ...input, source: 'fixture', modelId: null }, ctx);
    expect(f.source).toBe('fixture');
  });

  it('refuses a malformed answer but accepts an empty (unparseable) one, which simply fails', () => {
    expect(() => new AnswerStore().commit({ ...input, canonicalAnswer: '010' }, ctx)).toThrow(/not a canonical answer/);
    expect(new AnswerStore().commit({ ...input, canonicalAnswer: '' }, ctx).answerHash).toBe(sha256Hex(''));
  });

  it('persists to a JSON file and stays write-once across restarts', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sellacalida-store-')), 'answers.json');
    new AnswerStore(file).commit(input, ctx);
    expect(JSON.parse(readFileSync(file, 'utf8')).answers).toHaveLength(1);
    const reopened = new AnswerStore(file);
    expect(reopened.get(ID)?.canonicalAnswer).toBe('-10');
    expect(() => reopened.commit({ ...input, canonicalAnswer: '1' }, ctx)).toThrow(/write-once/);
  });
});
