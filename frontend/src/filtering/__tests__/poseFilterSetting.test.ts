// @vitest-environment node
// The vite config resolves its own path from a file URL, which jsdom does not give it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import viteConfig from '../../../vite.config';
import {
  DEFAULT_POSE_FILTER,
  parsePoseFilterSetting,
  POSE_FILTER_SETTINGS,
} from '../poseFilterSetting';

describe('parsePoseFilterSetting', () => {
  it.each(POSE_FILTER_SETTINGS)('accepts %s', (setting) => {
    expect(parsePoseFilterSetting(setting)).toBe(setting);
  });

  it('selects the default when unset or empty', () => {
    expect(parsePoseFilterSetting(undefined)).toBe(DEFAULT_POSE_FILTER);
    expect(parsePoseFilterSetting('')).toBe(DEFAULT_POSE_FILTER);
  });

  it.each(['Off', 'false', 'none', 'Kalman', 'one_euro', ' off'])('rejects %j', (value) => {
    expect(() => parsePoseFilterSetting(value)).toThrow(/VITE_POSE_FILTER/);
  });
});

describe('vite config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails the build on an unrecognised VITE_POSE_FILTER', () => {
    vi.stubEnv('VITE_POSE_FILTER', 'Off');
    expect(() => viteConfig({ command: 'build', mode: 'production' })).toThrow(/VITE_POSE_FILTER/);
  });

  it('builds with each recognised value', () => {
    for (const setting of POSE_FILTER_SETTINGS) {
      vi.stubEnv('VITE_POSE_FILTER', setting);
      expect(() => viteConfig({ command: 'build', mode: 'production' })).not.toThrow();
    }
  });
});
