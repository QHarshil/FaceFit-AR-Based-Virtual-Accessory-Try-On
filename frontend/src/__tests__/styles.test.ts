// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (name: string) => readFileSync(new URL(`../styles/${name}`, import.meta.url), 'utf8');

describe('global styles', () => {
  it('stops animations and transitions for reduced motion', () => {
    const app = css('App.css');
    const block = app.slice(app.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation-duration: 0.01ms !important');
    expect(block).toContain('transition-duration: 0.01ms !important');
  });

  it('keeps keyboard focus visible', () => {
    expect(css('App.css')).toMatch(/:focus-visible\s*{\s*outline: 3px solid/);
  });

  // Every stylesheet is global. The try-on header once shared .product-info
  // with the catalogue cards and turned their text grey on white.
  it('keeps try-on header styles off the catalogue cards', () => {
    expect(css('TryOn.css')).not.toContain('.product-info');
  });
});
