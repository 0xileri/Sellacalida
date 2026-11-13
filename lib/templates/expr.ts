// Parse a typed integer expression ("(-7 * 3) / 2") into the math.exact_result params AST.
// Agent-safe and client-safe: this only builds the tree, it never evaluates it.
import type { MathNode, MathOp } from './public';

const OPS: Record<string, MathOp> = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod' };

export function parseExpr(input: string): MathNode {
  const tokens = input.match(/\d+|[-+*/%()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  function factor(): MathNode {
    const t = take();
    if (t === undefined) throw new Error('expression ends too early');
    if (t === '(') {
      const e = expr();
      if (take() !== ')') throw new Error('missing )');
      return e;
    }
    if (t === '-') {
      const n = take();
      if (n === undefined || !/^\d+$/.test(n)) throw new Error('a minus sign must be followed by a number (write 0 - (...) to negate a group)');
      const v = BigInt(n);
      return v === 0n ? '0' : `-${v}`;
    }
    if (/^\d+$/.test(t)) return BigInt(t).toString();
    throw new Error(`unexpected "${t}"`);
  }

  function term(): MathNode {
    let left = factor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = OPS[take()!];
      left = { op, left, right: factor() };
    }
    return left;
  }

  function expr(): MathNode {
    let left = term();
    while (peek() === '+' || peek() === '-') {
      const op = OPS[take()!];
      left = { op, left, right: term() };
    }
    return left;
  }

  const tree = expr();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}"`);
  if (typeof tree === 'string') throw new Error('use at least one operator, e.g. 6 * 7');
  return tree;
}
