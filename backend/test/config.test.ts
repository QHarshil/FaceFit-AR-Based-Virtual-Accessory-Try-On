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

  it('builds the database URL from parts and encodes the password', () => {
    const config = loadConfig({
      POSTGRES_HOST: 'postgres',
      POSTGRES_USER: 'facefit',
      POSTGRES_PASSWORD: 'p@ss:w/rd#1',
      POSTGRES_DB: 'facefit',
    });
    expect(config.databaseUrl).toBe('postgres://facefit:p%40ss%3Aw%2Frd%231@postgres:5432/facefit');
    expect(new URL(config.databaseUrl).password).toBe('p%40ss%3Aw%2Frd%231');
  });

  it('prefers DATABASE_URL over the parts', () => {
    expect(loadConfig({ ...base, POSTGRES_HOST: 'postgres' }).databaseUrl).toBe(base.DATABASE_URL);
  });

  it('asks for the missing parts when DATABASE_URL is unset', () => {
    expect(() => loadConfig({ POSTGRES_HOST: 'postgres' })).toThrow(/POSTGRES_PASSWORD/);
  });
});
