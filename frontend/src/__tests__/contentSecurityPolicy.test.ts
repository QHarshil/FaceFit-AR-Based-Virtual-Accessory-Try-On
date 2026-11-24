import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiOriginOf, contentSecurityPolicy } from '../../csp';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(';').map((part) => {
      const [name = '', ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );

describe('content security policy', () => {
  const production = directives(contentSecurityPolicy({ apiOrigin: 'https://api.example.com' }));

  it('keeps scripts, workers and connections on the app origin plus the API', () => {
    expect(production['default-src']).toEqual(["'self'"]);
    expect(production['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(production['worker-src']).toEqual(["'self'"]);
    expect(production['connect-src']).toEqual(["'self'", 'blob:', 'https://api.example.com']);
    expect(production['frame-ancestors']).toEqual(["'none'"]);
  });

  it('allows no inline or eval script in production', () => {
    const policy = contentSecurityPolicy({ apiOrigin: 'https://api.example.com' });
    expect(policy).not.toMatch(/unsafe-inline|'unsafe-eval'|nonce-|\*/);
  });

  it('adds the dev nonce to scripts and styles only', () => {
    const dev = directives(
      contentSecurityPolicy({ apiOrigin: 'http://localhost:5055', nonce: 'abc' }),
    );
    expect(dev['script-src']).toContain("'nonce-abc'");
    expect(dev['style-src']).toContain("'nonce-abc'");
    expect(dev['connect-src']).not.toContain("'nonce-abc'");
  });

  it('reduces the API URL to its origin', () => {
    expect(apiOriginOf('https://api.example.com:8443/v1/')).toBe('https://api.example.com:8443');
    expect(() => apiOriginOf('not a url')).toThrow();
  });
});

describe('nginx template', () => {
  const nginx = read('../../nginx.conf');

  it('sends the same policy as csp.ts with the API origin filled in at start', () => {
    const match = nginx.match(/set \$csp "([^"]+)";/);
    expect(match?.[1]).toBe(contentSecurityPolicy({ apiOrigin: '${API_ORIGIN}' }));
  });

  it('adds the header in every location, since a location add_header hides the server ones', () => {
    const locations = nginx.split(/\n\s*location /).slice(1);
    expect(locations.length).toBeGreaterThan(0);
    for (const block of locations) {
      expect(block).toContain('add_header Content-Security-Policy $csp always;');
    }
  });

  it('is installed as a template with API_ORIGIN set', () => {
    const dockerfile = read('../../Dockerfile');
    expect(dockerfile).toContain(
      'COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template',
    );
    expect(dockerfile).toMatch(/ENV API_ORIGIN=/);
  });
});
