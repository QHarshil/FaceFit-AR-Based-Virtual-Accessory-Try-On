// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const frontend = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

describe('favicon', () => {
  it('is linked from index.html and served from public/', () => {
    const html = readFileSync(frontend('index.html'), 'utf8');
    for (const icon of ['/favicon.ico', '/favicon.svg']) {
      expect(html).toContain(`href="${icon}"`);
      expect(existsSync(frontend(`public${icon}`))).toBe(true);
    }
  });

  it('serves /favicon.ico as an icon file, not the app shell', () => {
    const ico = readFileSync(frontend('public/favicon.ico'));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  });
});
