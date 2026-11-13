// math.exact_result: exact bigint evaluation of the params AST. Server side only.
import type { MathNode } from '../public';

export interface MathStep {
  expr: string;
  value: string;
}

export class DivisionByZeroError extends Error {
  constructor(path: string) {
    super(`division or modulo by zero at ${path}`);
  }
}

/**
 * BigInt semantics: "/" truncates toward zero, "%" takes the sign of the left operand. These are
 * the rules the agent prompt states (lib/templates/public.ts renderPrompt).
 */
export function evaluateMath(node: MathNode, steps: MathStep[] = [], path = 'params'): bigint {
  if (typeof node === 'string') return BigInt(node);
  const l = evaluateMath(node.left, steps, `${path}.left`);
  const r = evaluateMath(node.right, steps, `${path}.right`);
  let v: bigint;
  switch (node.op) {
    case 'add': v = l + r; break;
    case 'sub': v = l - r; break;
    case 'mul': v = l * r; break;
    case 'div':
      if (r === 0n) throw new DivisionByZeroError(path);
      v = l / r;
      break;
    case 'mod':
      if (r === 0n) throw new DivisionByZeroError(path);
      v = l % r;
      break;
  }
  const sym = { add: '+', sub: '-', mul: '*', div: '/', mod: '%' }[node.op];
  steps.push({ expr: `${l} ${sym} ${r}`, value: v.toString() });
  return v;
}
