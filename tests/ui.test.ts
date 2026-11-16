// Spec section 9: fixture attempts are labeled in the UI, not only in the store and evidence.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceBadge, formatUnits } from '@/app/ui/bits';

describe('UI labels', () => {
  it('a fixture answer is badged as not an AI solve; an AI answer shows its model id', () => {
    const fixture = renderToStaticMarkup(createElement(SourceBadge, { source: 'fixture', modelId: null }));
    expect(fixture).toContain('FIXTURE · not an AI solve');
    const ai = renderToStaticMarkup(createElement(SourceBadge, { source: 'ai', modelId: 'anthropic/claude-sonnet-5.5' }));
    expect(ai).toContain('AI · anthropic/claude-sonnet-5.5');
    expect(ai).not.toContain('FIXTURE');
  });

  it('amounts render from integer base units without floating point', () => {
    expect(formatUnits(120n, 2)).toBe('1.20');
    expect(formatUnits('5', 2)).toBe('0.05');
    expect(formatUnits(900719925474099312345n, 2)).toBe('9007199254740993123.45'); // beyond Number precision
    expect(formatUnits(-7n, 2)).toBe('-0.07');
  });
});
