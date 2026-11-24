import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { i420ToRgba, openY4m, parseY4mHeader } from './y4m.mjs';

describe('parseY4mHeader', () => {
  it('reads size, rate, chroma and range', () => {
    assert.deepEqual(parseY4mHeader('YUV4MPEG2 W1280 H720 F30:1 Ip A0:0 C420jpeg XYSCSS=420JPEG'), {
      width: 1280,
      height: 720,
      fps: 30,
      chroma: '420jpeg',
      fullRange: false,
    });
    assert.equal(parseY4mHeader('YUV4MPEG2 W4 H2 F30000:1001 XCOLORRANGE=FULL').fullRange, true);
    assert.ok(Math.abs(parseY4mHeader('YUV4MPEG2 W4 H2 F30000:1001').fps - 29.97) < 0.001);
  });

  it('rejects other formats and odd sizes', () => {
    assert.equal(parseY4mHeader('YUV4MPEG2 W4 H2 F30:1 C422'), null);
    assert.equal(parseY4mHeader('YUV4MPEG2 W5 H2 F30:1'), null);
    assert.equal(parseY4mHeader('RIFF W4 H2 F30:1'), null);
    assert.equal(parseY4mHeader('YUV4MPEG2 W4 H2'), null);
  });
});

describe('openY4m', () => {
  const dir = mkdtempSync(join(tmpdir(), 'y4m-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('counts frames and reads each at its offset', () => {
    const frameBytes = (4 * 2 * 3) / 2;
    const frames = [0, 1, 2].map((k) => Buffer.alloc(frameBytes, 10 + k));
    const path = join(dir, 'clip.y4m');
    writeFileSync(path, Buffer.concat([Buffer.from('YUV4MPEG2 W4 H2 F30:1 C420jpeg\n'), ...frames.flatMap((f) => [Buffer.from('FRAME\n'), f])]));
    const clip = openY4m(path);
    try {
      assert.equal(clip.frameCount, 3);
      assert.deepEqual([...clip.readFrame(2)], [...frames[2]]);
      assert.deepEqual([...clip.readFrame(0)], [...frames[0]]);
      assert.throws(() => clip.readFrame(3));
    } finally {
      clip.close();
    }
  });

  it('refuses a file without a Y4M header', () => {
    const path = join(dir, 'not.y4m');
    writeFileSync(path, 'hello\n');
    assert.throws(() => openY4m(path), /not an 8-bit 4:2:0/);
  });
});

describe('i420ToRgba', () => {
  const solid = (y, u, v) => Buffer.from([y, y, y, y, u, v]);

  it('maps limited-range black, white and grey', () => {
    assert.deepEqual([...i420ToRgba(solid(16, 128, 128), 2, 2).slice(0, 4)], [0, 0, 0, 255]);
    assert.deepEqual([...i420ToRgba(solid(235, 128, 128), 2, 2).slice(0, 4)], [255, 255, 255, 255]);
    assert.deepEqual([...i420ToRgba(solid(128, 128, 128), 2, 2, true).slice(0, 4)], [128, 128, 128, 255]);
  });

  it('recovers a saturated red within rounding', () => {
    // BT.601 limited range: R = 255, G = B = 0 encodes as Y 81, U 90, V 240.
    const [r, g, b] = i420ToRgba(solid(81, 90, 240), 2, 2);
    assert.ok(r >= 253 && g <= 2 && b <= 2, `${r} ${g} ${b}`);
  });
});
