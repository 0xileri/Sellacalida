// Turn a model's raw reply into the canonical answer that gets committed. Deliberately strict:
// the parser never "helps" the agent. Anything ambiguous becomes '' (which then fails as a wrong
// answer) rather than a guess.
import { isWellFormedAnswer, type TemplateId } from '../templates/public';

export function parseAnswer(templateId: TemplateId, raw: string): string {
  let s = raw.trim();
  // tolerate light wrapping: code fences, backticks, quotes, a trailing period
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  s = s.replace(/^[`"']+|[`"']+$/g, '').trim();
  s = s.replace(/\.$/, '').trim();
  if (isWellFormedAnswer(templateId, s)) return s;

  // otherwise accept exactly one integer token in the reply; zero or several means no answer
  const tokens = s.match(/-?\d+/g) ?? [];
  if (tokens.length === 1 && isWellFormedAnswer(templateId, tokens[0])) {
    // reject numbers glued to letters or separators, e.g. "15,000" or "v2"
    const glued = new RegExp(`[\\w,.]${tokens[0].replace('-', '\\-')}|${tokens[0].replace('-', '\\-')}[\\w,]`);
    if (!glued.test(s)) return tokens[0];
  }
  return '';
}
