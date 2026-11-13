// The arena's infix expression input -> math.exact_result params (no evaluation here).
import { describe, expect, it } from 'vitest';
import { parseExpr } from '@/lib/templates/expr';
import { validateSpecShape } from '@/lib/templates/public';
import { computeExpectedFromRaw } from '@/lib/templates/check';

const evalExpr = (s: string) =>
  computeExpectedFromRaw({ templateId: 'math.exact_result', version: 1, network: 'mocknet', params: parseExpr(s) as never }).expected;

describe('parseExpr', () => {
  it('builds the AST with normal precedence and left associativity', () => {
    expect(parseExpr('1 + 2 * 3')).toEqual({ op: 'add', left: '1', right: { op: 'mul', left: '2', right: '3' } });
    expect(parseExpr('10 - 3 - 2')).toEqual({ op: 'sub', left: { op: 'sub', left: '10', right: '3' }, right: '2' });
    expect(parseExpr('(-7 * 3) / 2')).toEqual({ op: 'div', left: { op: 'mul', left: '-7', right: '3' }, right: '2' });
  });

  it.each([
    ['(-7 * 3) / 2', '-10'],
    ['(123456789 * -987654321) % 993', '-717'],
    ['2 * (3 + 4) - 5', '9'],
    ['-0 + 007', '7'],
  ])('%s evaluates to %s', (s, v) => {
    expect(evalExpr(s)).toBe(v);
  });

  it('produces specs that pass shape validation', () => {
    expect(validateSpecShape({ templateId: 'math.exact_result', version: 1, network: 'chipnet', params: parseExpr('(1+2)*3') })).toEqual([]);
  });

  it.each([
    ['', /ends too early/],
    ['7', /at least one operator/],
    ['(1 + 2', /missing \)/],
    ['1 + + 2', /unexpected/],
    ['-(1 + 2)', /minus sign must be followed by a number/],
    ['2 ^ 3', /unexpected/],
    ['1 + 2)', /unexpected/],
  ])('rejects %j', (s, re) => {
    expect(() => parseExpr(s)).toThrow(re);
  });
});
