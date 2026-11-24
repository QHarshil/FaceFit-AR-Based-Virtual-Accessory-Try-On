import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';
import { MatFileError, readMatFile } from './matFile.mjs';

// Fixtures are written byte by byte from MathWorks' "MAT-File Format"
// reference, not taken from the dataset.
const MI = { INT8: 1, UINT8: 2, INT32: 5, UINT32: 6, SINGLE: 7, DOUBLE: 9, MATRIX: 14, COMPRESSED: 15 };
const MX = { CHAR: 4, DOUBLE: 6, SINGLE: 7 };
const SIZES = { [MI.INT8]: 1, [MI.UINT8]: 1, [MI.INT32]: 4, [MI.UINT32]: 4, [MI.SINGLE]: 4, [MI.DOUBLE]: 8 };

const encode = (type, values, little) => {
  const size = SIZES[type];
  const view = new DataView(new ArrayBuffer(values.length * size));
  values.forEach((v, i) => {
    const offset = i * size;
    if (type === MI.INT8) view.setInt8(offset, v);
    else if (type === MI.UINT8) view.setUint8(offset, v);
    else if (type === MI.INT32) view.setInt32(offset, v, little);
    else if (type === MI.UINT32) view.setUint32(offset, v, little);
    else if (type === MI.SINGLE) view.setFloat32(offset, v, little);
    else view.setFloat64(offset, v, little);
  });
  return new Uint8Array(view.buffer);
};

/** A data element: small format when it fits in four bytes, else an 8-byte tag and data padded to 8 bytes. */
const element = (type, payload, little, { forceLong = false } = {}) => {
  const tag = new DataView(new ArrayBuffer(8));
  if (payload.length <= 4 && !forceLong) {
    tag.setUint32(0, (payload.length << 16) | type, little);
    const out = new Uint8Array(8);
    out.set(new Uint8Array(tag.buffer));
    out.set(payload, 4);
    return out;
  }
  tag.setUint32(0, type, little);
  tag.setUint32(4, payload.length, little);
  const out = new Uint8Array(8 + Math.ceil(payload.length / 8) * 8);
  out.set(new Uint8Array(tag.buffer));
  out.set(payload, 8);
  return out;
};

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const matrix = ({ name, classId, dims, storedAs, values, little = true, longName = false }) =>
  element(
    MI.MATRIX,
    concat([
      element(MI.UINT32, encode(MI.UINT32, [classId, 0], little), little),
      element(MI.INT32, encode(MI.INT32, dims, little), little),
      element(MI.INT8, new TextEncoder().encode(name), little, { forceLong: longName }),
      element(storedAs, encode(storedAs, values, little), little),
    ]),
    little,
  );

const compressed = (bytes, little = true) => {
  const deflated = deflateSync(bytes);
  const tag = new DataView(new ArrayBuffer(8));
  tag.setUint32(0, MI.COMPRESSED, little);
  tag.setUint32(4, deflated.length, little);
  return concat([new Uint8Array(tag.buffer), deflated]);
};

const header = ({ little = true, text = 'MATLAB 5.0 MAT-file, fixture written from the format reference' } = {}) => {
  const out = new Uint8Array(128).fill(0x20);
  out.set(new TextEncoder().encode(text));
  out.fill(0, 116, 124);
  new DataView(out.buffer).setUint16(124, 0x0100, little);
  out.set(new TextEncoder().encode(little ? 'IM' : 'MI'), 126);
  return out;
};

const POSE = [0.1, -0.5, 0.25, 210.5, 190.25, 0, 0.0012];

describe('readMatFile', () => {
  it('reads an uncompressed double row vector', () => {
    const file = concat([header(), matrix({ name: 'Pose_Para', classId: MX.DOUBLE, dims: [1, 7], storedAs: MI.DOUBLE, values: POSE })]);
    const pose = readMatFile(file).get('Pose_Para');
    assert.equal(pose.className, 'double');
    assert.deepEqual(pose.dims, [1, 7]);
    assert.deepEqual(Array.from(pose.data), POSE);
  });

  it('keeps column-major order in a compressed 3x2 matrix', () => {
    // MATLAB [1 4; 2 5; 3 6] is stored as 1, 2, 3, 4, 5, 6.
    const file = concat([header(), compressed(matrix({ name: 'pt3d_68', classId: MX.DOUBLE, dims: [3, 2], storedAs: MI.DOUBLE, values: [1, 2, 3, 4, 5, 6] }))]);
    const points = readMatFile(file).get('pt3d_68');
    assert.deepEqual(points.dims, [3, 2]);
    assert.deepEqual(Array.from(points.data), [1, 2, 3, 4, 5, 6]);
  });

  it('reads several variables, small and long names, compacted storage and singles', () => {
    const file = concat([
      header(),
      matrix({ name: 'roi', classId: MX.DOUBLE, dims: [1, 3], storedAs: MI.UINT8, values: [1, 2, 250] }),
      compressed(matrix({ name: 'Exp_Para', classId: MX.SINGLE, dims: [2, 2], storedAs: MI.SINGLE, values: [0.5, -1.25, 3, 8] })),
      matrix({ name: 'tilt', classId: MX.DOUBLE, dims: [1, 1], storedAs: MI.DOUBLE, values: [Math.PI], longName: true }),
    ]);
    const variables = readMatFile(file);
    assert.deepEqual([...variables.keys()], ['roi', 'Exp_Para', 'tilt']);
    assert.deepEqual(Array.from(variables.get('roi').data), [1, 2, 250]);
    assert.equal(variables.get('Exp_Para').className, 'single');
    assert.deepEqual(Array.from(variables.get('Exp_Para').data), [0.5, -1.25, 3, 8]);
    assert.equal(variables.get('tilt').data[0], Math.PI);
  });

  it('reads a big-endian file', () => {
    const file = concat([header({ little: false }), matrix({ name: 'Pose_Para', classId: MX.DOUBLE, dims: [1, 7], storedAs: MI.DOUBLE, values: POSE, little: false })]);
    assert.deepEqual(Array.from(readMatFile(file).get('Pose_Para').data), POSE);
  });

  it('skips a char array and still reads the next variable', () => {
    const file = concat([
      header(),
      matrix({ name: 'label', classId: MX.CHAR, dims: [1, 2], storedAs: MI.UINT8, values: [104, 105] }),
      matrix({ name: 'Pose_Para', classId: MX.DOUBLE, dims: [1, 7], storedAs: MI.DOUBLE, values: POSE }),
    ]);
    assert.deepEqual([...readMatFile(file).keys()], ['Pose_Para']);
  });

  it('rejects HDF5 files, a missing endian mark, truncation and a size mismatch', () => {
    const good = concat([header(), matrix({ name: 'Pose_Para', classId: MX.DOUBLE, dims: [1, 7], storedAs: MI.DOUBLE, values: POSE })]);
    assert.throws(() => readMatFile(header({ text: 'MATLAB 7.3 MAT-file, Platform: x' })), MatFileError);
    const noEndian = Uint8Array.from(good);
    noEndian.fill(0x20, 126, 128);
    assert.throws(() => readMatFile(noEndian), MatFileError);
    assert.throws(() => readMatFile(good.subarray(0, good.length - 16)), MatFileError);
    assert.throws(() => readMatFile(good.subarray(0, 100)), MatFileError);
    const wrongDims = concat([header(), matrix({ name: 'Pose_Para', classId: MX.DOUBLE, dims: [1, 8], storedAs: MI.DOUBLE, values: POSE })]);
    assert.throws(() => readMatFile(wrongDims), MatFileError);
  });
});
