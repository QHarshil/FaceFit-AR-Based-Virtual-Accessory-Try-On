// Reads 4:2:0 YUV4MPEG2 clips frame by frame and converts frames to RGBA.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const HEADER_LIMIT = 1024;
const FRAME_TAG = 'FRAME';

/** Parses the stream header line; returns null for anything but 8-bit 4:2:0. */
export function parseY4mHeader(line) {
  const fields = line.trim().split(' ');
  if (fields[0] !== 'YUV4MPEG2') return null;
  const header = { width: 0, height: 0, fps: 0, chroma: '420jpeg', fullRange: false };
  for (const field of fields.slice(1)) {
    const value = field.slice(1);
    if (field[0] === 'W') header.width = Number(value);
    else if (field[0] === 'H') header.height = Number(value);
    else if (field[0] === 'F') {
      const [num, den] = value.split(':').map(Number);
      header.fps = num / den;
    } else if (field[0] === 'C') header.chroma = value;
    else if (field === 'XCOLORRANGE=FULL') header.fullRange = true;
  }
  const valid =
    Number.isInteger(header.width) && header.width > 0 && header.width % 2 === 0 &&
    Number.isInteger(header.height) && header.height > 0 && header.height % 2 === 0 &&
    Number.isFinite(header.fps) && header.fps > 0 &&
    ['420', '420jpeg', '420paldv', '420mpeg2'].includes(header.chroma);
  return valid ? header : null;
}

/** Opens a clip and returns its header, frame count and a frame reader for planar I420 bytes. */
export function openY4m(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(HEADER_LIMIT);
    const read = readSync(fd, head, 0, HEADER_LIMIT, 0);
    const end = head.subarray(0, read).indexOf(0x0a);
    if (end < 0) throw new Error(`${path}: no Y4M header line`);
    const header = parseY4mHeader(head.subarray(0, end).toString('latin1'));
    if (!header) throw new Error(`${path}: not an 8-bit 4:2:0 Y4M clip`);
    const frameBytes = (header.width * header.height * 3) / 2;
    const firstFrame = end + 1;
    const tag = Buffer.alloc(HEADER_LIMIT);
    readSync(fd, tag, 0, HEADER_LIMIT, firstFrame);
    const tagEnd = tag.indexOf(0x0a);
    if (tag.subarray(0, FRAME_TAG.length).toString('latin1') !== FRAME_TAG || tagEnd < 0) {
      throw new Error(`${path}: no FRAME tag after the header`);
    }
    // Every frame carries the same tag in clips written by ffmpeg, so frames sit at a fixed stride.
    const stride = tagEnd + 1 + frameBytes;
    const frameCount = Math.floor((fstatSync(fd).size - firstFrame) / stride);
    const frame = Buffer.alloc(frameBytes);
    return {
      header,
      frameCount,
      readFrame(index) {
        if (!(Number.isInteger(index) && index >= 0 && index < frameCount)) throw new Error(`frame ${index} out of range`);
        readSync(fd, frame, 0, frameBytes, firstFrame + index * stride + tagEnd + 1);
        return frame;
      },
      close() {
        closeSync(fd);
      },
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/**
 * Planar I420 to RGBA with BT.601 coefficients. Limited range unless the
 * header says full. The coefficients only change colour slightly, which does
 * not move landmarks by a measurable amount.
 */
export function i420ToRgba(i420, width, height, fullRange = false, rgba = new Uint8ClampedArray(width * height * 4)) {
  const ySize = width * height;
  const cWidth = width / 2;
  const uOffset = ySize;
  const vOffset = ySize + ySize / 4;
  const yScale = fullRange ? 1 : 255 / 219;
  const cScale = fullRange ? 1 : 255 / 224;
  const yBase = fullRange ? 0 : 16;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const y = (i420[row * width + col] - yBase) * yScale;
      const c = (row >> 1) * cWidth + (col >> 1);
      const u = (i420[uOffset + c] - 128) * cScale;
      const v = (i420[vOffset + c] - 128) * cScale;
      const out = 4 * (row * width + col);
      rgba[out] = y + 1.402 * v;
      rgba[out + 1] = y - 0.344136 * u - 0.714136 * v;
      rgba[out + 2] = y + 1.772 * u;
      rgba[out + 3] = 255;
    }
  }
  return rgba;
}
