import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'pglite://memory' };

describe('loadConfig', () => {
  it('applies defaults and parses the origin allowlist', () => {
    const config = loadConfig({
      ...base,
      CORS_ORIGINS: 'http://localhost:3000, https://app.example.com/',
    });
    expect(config.port).toBe(5055);
    expect(config.corsOrigins).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(config.trustProxy).toBe(false);
  });

  it('defaults to an empty allowlist', () => {
    expect(loadConfig(base).corsOrigins).toEqual([]);
  });

  it('rejects a wildcard or malformed origin', () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: '*' })).toThrow();
    expect(() => loadConfig({ ...base, CORS_ORIGINS: 'not a url' })).toThrow();
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow();
  });
});
