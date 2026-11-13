// Agent-safe template layer: ids, human prompts, answer formats and syntactic param checks.
// The agent runner may import this file. It must never import ./check (the checkers and the
// accept-time validation that evaluates things). tests/boundary.test.ts enforces that transitively.
import { NETWORK_IDS, type SellacalidaNetwork } from '../constants';

export const TEMPLATE_IDS = [
  'bch.output_token_count',
  'bch.total_sats_to_address',
  'bch.nft_output_index',
  'math.exact_result',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type MathOp = 'add' | 'sub' | 'mul' | 'div' | 'mod';
export type MathNode = string | { op: MathOp; left: MathNode; right: MathNode };

export interface ParamsByTemplate {
  'bch.output_token_count': { txid: string; category: string };
  'bch.total_sats_to_address': { txid: string; address: string };
  'bch.nft_output_index': { txid: string; category: string; commitment: string };
  'math.exact_result': { op: MathOp; left: MathNode; right: MathNode };
}

export type ChallengeSpec = {
  [K in TemplateId]: { templateId: K; version: 1; network: SellacalidaNetwork; params: ParamsByTemplate[K] };
}[TemplateId];

const HEX64 = /^[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const INT = /^(0|-?[1-9][0-9]*)$/;
export const MATH_LIMITS = { maxDepth: 6, maxDigits: 30 } as const;
export const MAX_COMMITMENT_BYTES = 128;

interface TemplateInfo {
  title: string;
  /** what a valid answer looks like, shown to the agent verbatim */
  answerFormat: string;
  answerPattern: RegExp;
  paramKeys: readonly string[];
}

export const TEMPLATES: Record<TemplateId, TemplateInfo> = {
  'bch.output_token_count': {
    title: 'Count token outputs',
    answerFormat: 'a non-negative decimal integer with no leading zeros, e.g. 0 or 3',
    answerPattern: UINT,
    paramKeys: ['category', 'txid'],
  },
  'bch.total_sats_to_address': {
    title: 'Sats sent to an address',
    answerFormat: 'a non-negative decimal integer number of satoshis with no leading zeros, e.g. 0 or 15000',
    answerPattern: UINT,
    paramKeys: ['address', 'txid'],
  },
  'bch.nft_output_index': {
    title: 'Find the NFT output',
    answerFormat: 'the output index as a decimal integer (0 is the first output), or -1 if zero or several outputs match',
    answerPattern: /^(-1|0|[1-9][0-9]*)$/,
    paramKeys: ['category', 'commitment', 'txid'],
  },
  'math.exact_result': {
    title: 'Exact integer arithmetic',
    answerFormat: 'a decimal integer with no leading zeros, with a leading minus sign if negative, e.g. -42',
    answerPattern: INT,
    paramKeys: ['left', 'op', 'right'],
  },
};

export function isTemplateId(x: unknown): x is TemplateId {
  return typeof x === 'string' && (TEMPLATE_IDS as readonly string[]).includes(x);
}

/** True when `answer` is a well-formed canonical answer for this template (not whether it is right). */
export function isWellFormedAnswer(templateId: TemplateId, answer: string): boolean {
  return TEMPLATES[templateId].answerPattern.test(answer);
}

function exactKeys(obj: unknown, keys: readonly string[], where: string, errors: string[]): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push(`${where} must be an object`);
    return false;
  }
  const got = Object.keys(obj).sort();
  const want = [...keys].sort();
  if (got.join(',') !== want.join(',')) errors.push(`${where} must have exactly the keys ${want.join(', ')} (got ${got.join(', ') || 'none'})`);
  return true;
}

function checkMathNode(node: unknown, depth: number, path: string, errors: string[]): void {
  if (typeof node === 'string') {
    if (!INT.test(node)) errors.push(`${path} must be a canonical decimal integer string, got ${JSON.stringify(node)}`);
    else if (node.replace('-', '').length > MATH_LIMITS.maxDigits) errors.push(`${path} has more than ${MATH_LIMITS.maxDigits} digits`);
    return;
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    errors.push(`${path} must be a canonical decimal integer string or an {op, left, right} object, got ${JSON.stringify(node)}`);
    return;
  }
  if (depth >= MATH_LIMITS.maxDepth) {
    errors.push(`${path} nests deeper than ${MATH_LIMITS.maxDepth} levels`);
    return;
  }
  if (!exactKeys(node, ['left', 'op', 'right'], path, errors)) return;
  if (!['add', 'sub', 'mul', 'div', 'mod'].includes(node.op as string)) errors.push(`${path}.op must be add, sub, mul, div or mod`);
  checkMathNode(node.left, depth + 1, `${path}.left`, errors);
  checkMathNode(node.right, depth + 1, `${path}.right`, errors);
}

/**
 * Syntactic checks only (shape, hex formats, known ids). Semantic checks that need decoding or
 * evaluation (address payloads, division by zero) live in ./check/validate.ts, run at accept time.
 */
export function validateSpecShape(spec: unknown): string[] {
  const errors: string[] = [];
  if (!exactKeys(spec, ['network', 'params', 'templateId', 'version'], 'spec', errors)) return errors;
  if (!isTemplateId(spec.templateId)) {
    errors.push(`unknown templateId ${JSON.stringify(spec.templateId)}`);
    return errors;
  }
  if (spec.version !== 1) errors.push('version must be 1');
  if (typeof spec.network !== 'string' || !(spec.network in NETWORK_IDS)) errors.push('network must be mainnet, chipnet or mocknet');
  const info = TEMPLATES[spec.templateId];
  if (!exactKeys(spec.params, info.paramKeys, 'params', errors)) return errors;
  const p = spec.params;
  if ('txid' in p && !(typeof p.txid === 'string' && HEX64.test(p.txid))) errors.push('params.txid must be 64 lowercase hex chars (explorer order, no 0x)');
  if ('category' in p && !(typeof p.category === 'string' && HEX64.test(p.category))) errors.push('params.category must be 64 lowercase hex chars (explorer order, no 0x)');
  if ('commitment' in p) {
    const c = p.commitment;
    if (typeof c !== 'string' || !/^([0-9a-f]{2})*$/.test(c)) errors.push('params.commitment must be lowercase hex with an even length (or empty)');
    else if (c.length / 2 > MAX_COMMITMENT_BYTES) errors.push(`params.commitment is longer than ${MAX_COMMITMENT_BYTES} bytes`);
  }
  if ('address' in p && !(typeof p.address === 'string' && /^[a-z]+:[02-9ac-hj-np-z]+$/.test(p.address))) {
    errors.push('params.address must be a lowercase cashaddr with its prefix, e.g. bitcoincash:q...');
  }
  if (spec.templateId === 'math.exact_result') checkMathNode(p, 0, 'params', errors);
  return errors;
}

const OP_SYMBOL: Record<MathOp, string> = { add: '+', sub: '-', mul: '*', div: '/', mod: '%' };

export function renderMath(node: MathNode): string {
  if (typeof node === 'string') return node.startsWith('-') ? `(${node})` : node;
  return `(${renderMath(node.left)} ${OP_SYMBOL[node.op]} ${renderMath(node.right)})`;
}

const NETWORK_LABEL: Record<SellacalidaNetwork, string> = {
  mainnet: 'Bitcoin Cash mainnet',
  chipnet: 'Bitcoin Cash chipnet (testnet)',
  mocknet: 'a local test network',
};

/** The exact task text the agent sees. Never includes an expected answer. */
export function renderPrompt(spec: ChallengeSpec): string {
  const net = NETWORK_LABEL[spec.network];
  let task: string;
  switch (spec.templateId) {
    case 'bch.output_token_count':
      task =
        `On ${net}, how many outputs of transaction ${spec.params.txid} carry CashToken category ` +
        `${spec.params.category}? Count every output whose token prefix has this category, whether it holds ` +
        'fungible tokens, an NFT, or both. Both ids are in the usual explorer byte order.';
      break;
    case 'bch.total_sats_to_address':
      task =
        `On ${net}, how many satoshis does transaction ${spec.params.txid} send to ${spec.params.address}? ` +
        'Add up the value of every output locked to that address (token-aware and plain encodings of the same ' +
        'address are the same destination). Count outputs only; ignore inputs.';
      break;
    case 'bch.nft_output_index':
      task =
        `On ${net}, which output index of transaction ${spec.params.txid} holds an NFT of CashToken category ` +
        `${spec.params.category}` +
        (spec.params.commitment ? ` with commitment 0x${spec.params.commitment}` : ' (any commitment)') +
        '? Outputs are numbered from 0. Only outputs that carry an NFT count, not fungible-only outputs. ' +
        'If no output matches, or more than one does, the correct answer is -1. Do not guess.';
      break;
    case 'math.exact_result':
      task =
        `Compute ${renderMath(spec.params)} exactly with integers. "/" is integer division that truncates ` +
        'toward zero, and "%" is the remainder with the sign of the left operand (so -7 / 2 = -3 and -7 % 2 = -1).';
      break;
  }
  return `${task}\n\nAnswer with ${TEMPLATES[spec.templateId].answerFormat}. Reply with the answer only.`;
}
