import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { discardClipLandmarks } from './clipLandmarks.mjs';
import { parseMeasureArgs } from './measure.mjs';

describe('discardClipLandmarks', () => {
  it('deletes the cached tracks of the named clips and the folder once it is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'clip-landmarks-'));
    try {
      const cache = join(root, 'clips');
      mkdirSync(cache);
      for (const name of ['rec-static', 'rec-blink', 'other']) writeFileSync(join(cache, `${name}.json`), '{}');
      assert.deepEqual(discardClipLandmarks(['rec-static', 'rec-blink', 'missing'], cache), ['rec-static', 'rec-blink']);
      assert.deepEqual(readdirSync(cache), ['other.json']);
      discardClipLandmarks(['other'], cache);
      assert.equal(existsSync(cache), false);
      assert.deepEqual(discardClipLandmarks(['rec-static'], cache), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('parseMeasureArgs', () => {
  it('discards landmark tracks unless --keep-landmarks is passed', () => {
    assert.equal(parseMeasureArgs(['--clips', '/x']).keepLandmarks, false);
    assert.equal(parseMeasureArgs(['--clips', '/x', '--keep-landmarks']).keepLandmarks, true);
    assert.equal(parseMeasureArgs(['--clips', '/x']).clipsDir, '/x');
    assert.equal(parseMeasureArgs(['--allow-dirty']).allowDirty, true);
  });
});
