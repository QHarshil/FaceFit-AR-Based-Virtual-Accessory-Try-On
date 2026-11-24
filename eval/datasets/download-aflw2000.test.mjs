import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { aflw2000Samples, unsafeEntries } from './download-aflw2000.mjs';

describe('unsafeEntries', () => {
  it('accepts the archive layout and rejects paths that leave AFLW2000/', () => {
    assert.deepEqual(unsafeEntries(['AFLW2000/', 'AFLW2000/image00002.jpg', 'AFLW2000/Code/readme.txt']), []);
    const bad = ['../evil', 'AFLW2000/../../evil', '/etc/passwd', 'other/image.jpg', 'AFLW2000\\..\\evil'];
    assert.deepEqual(unsafeEntries(bad), bad);
  });
});

describe('aflw2000Samples', () => {
  it('lists only images that have a label file, sorted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aflw-'));
    try {
      for (const name of ['image00004.jpg', 'image00004.mat', 'image00002.jpg', 'image00002.mat', 'image00006.jpg', 'Model_Exp.mat']) {
        writeFileSync(join(dir, name), '');
      }
      assert.deepEqual(aflw2000Samples(dir), ['image00002', 'image00004']);
      assert.deepEqual(aflw2000Samples(join(dir, 'missing')), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
