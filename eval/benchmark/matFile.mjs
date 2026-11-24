// Minimal reader for MATLAB level 5 MAT-files (the format of the AFLW2000-3D
// annotations). Reads real numeric arrays, compressed or not, in either byte
// order; other classes are skipped. Layout follows MathWorks' "MAT-File
// Format" reference: a 128-byte header, then tagged data elements.
import { inflateSync } from 'node:zlib';

const HEADER_BYTES = 128;
const MI_INT8 = 1;
const MI_UINT32 = 6;
const MI_INT32 = 5;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;

const ELEMENT_READERS = {
  1: { size: 1, read: (view, offset) => view.getInt8(offset) },
  2: { size: 1, read: (view, offset) => view.getUint8(offset) },
  3: { size: 2, read: (view, offset, little) => view.getInt16(offset, little) },
  4: { size: 2, read: (view, offset, little) => view.getUint16(offset, little) },
  5: { size: 4, read: (view, offset, little) => view.getInt32(offset, little) },
  6: { size: 4, read: (view, offset, little) => view.getUint32(offset, little) },
  7: { size: 4, read: (view, offset, little) => view.getFloat32(offset, little) },
  9: { size: 8, read: (view, offset, little) => view.getFloat64(offset, little) },
  12: { size: 8, read: (view, offset, little) => Number(view.getBigInt64(offset, little)) },
  13: { size: 8, read: (view, offset, little) => Number(view.getBigUint64(offset, little)) },
};

const NUMERIC_CLASSES = {
  6: 'double', 7: 'single', 8: 'int8', 9: 'uint8', 10: 'int16', 11: 'uint16', 12: 'int32', 13: 'uint32', 14: 'int64', 15: 'uint64',
};
const COMPLEX_FLAG = 0x0800;

export class MatFileError extends Error {}

/**
 * One tag at `offset`. In the small element format the upper half of the
 * first word is the byte count and the data sits in the second word.
 */
function readTag(view, offset, little) {
  if (offset + 8 > view.byteLength) throw new MatFileError(`truncated tag at byte ${offset}`);
  const first = view.getUint32(offset, little);
  const smallBytes = first >>> 16;
  if (smallBytes !== 0) {
    if (smallBytes > 4) throw new MatFileError(`small element of ${smallBytes} bytes at byte ${offset}`);
    return { type: first & 0xffff, bytes: smallBytes, dataOffset: offset + 4, next: offset + 8, small: true };
  }
  const bytes = view.getUint32(offset + 4, little);
  const dataOffset = offset + 8;
  if (dataOffset + bytes > view.byteLength) throw new MatFileError(`element of ${bytes} bytes overruns the file at byte ${offset}`);
  return { type: first, bytes, dataOffset, next: dataOffset + bytes, small: false };
}

function readNumbers(view, tag, little) {
  const reader = ELEMENT_READERS[tag.type];
  if (!reader) throw new MatFileError(`unsupported numeric element type ${tag.type}`);
  if (tag.bytes % reader.size !== 0) throw new MatFileError(`element of ${tag.bytes} bytes is not a whole number of type ${tag.type}`);
  const values = new Float64Array(tag.bytes / reader.size);
  for (let i = 0; i < values.length; i++) values[i] = reader.read(view, tag.dataOffset + i * reader.size, little);
  return values;
}

/** Sub-elements of a matrix start on 8-byte boundaries. */
const padded = (tag) => (tag.small ? tag.next : tag.dataOffset + Math.ceil(tag.bytes / 8) * 8);

function readMatrix(view, start, end, little) {
  const flagsTag = readTag(view, start, little);
  if (flagsTag.type !== MI_UINT32 || flagsTag.bytes !== 8) throw new MatFileError('matrix without array flags');
  const flags = view.getUint32(flagsTag.dataOffset, little);
  const dimsTag = readTag(view, padded(flagsTag), little);
  if (dimsTag.type !== MI_INT32) throw new MatFileError('matrix without dimensions');
  const dims = Array.from(readNumbers(view, dimsTag, little));
  const nameTag = readTag(view, padded(dimsTag), little);
  if (nameTag.type !== MI_INT8) throw new MatFileError('matrix without a name');
  const name = new TextDecoder('ascii').decode(new Uint8Array(view.buffer, view.byteOffset + nameTag.dataOffset, nameTag.bytes));

  const className = NUMERIC_CLASSES[flags & 0xff];
  if (!className || flags & COMPLEX_FLAG) return { name, variable: null };
  const realTag = readTag(view, padded(nameTag), little);
  if (realTag.next > end) throw new MatFileError(`matrix ${name} overruns its element`);
  const data = readNumbers(view, realTag, little);
  const count = dims.reduce((product, d) => product * d, 1);
  if (data.length !== count) throw new MatFileError(`matrix ${name} has ${data.length} values for dimensions ${dims.join('x')}`);
  return { name, variable: { className, dims, data } };
}

/**
 * Parses a level 5 MAT-file. Returns a Map from variable name to
 * { className, dims, data }, with data in MATLAB's column-major order.
 * Throws MatFileError for anything that is not a well-formed level 5 file.
 */
export function readMatFile(bytes) {
  const buffer = Uint8Array.from(bytes);
  const view = new DataView(buffer.buffer);
  if (view.byteLength < HEADER_BYTES) throw new MatFileError('shorter than the 128-byte header');
  const headerText = new TextDecoder('ascii').decode(buffer.subarray(0, 116));
  if (headerText.startsWith('MATLAB 7.3')) throw new MatFileError('MAT-file 7.3 (HDF5) is not supported');
  const endian = String.fromCharCode(buffer[126], buffer[127]);
  if (endian !== 'IM' && endian !== 'MI') throw new MatFileError('missing endian indicator; not a level 5 MAT-file');
  const little = endian === 'IM';
  if (view.getUint16(124, little) !== 0x0100) throw new MatFileError('unsupported MAT-file version');

  const variables = new Map();
  let offset = HEADER_BYTES;
  while (offset + 8 <= view.byteLength) {
    const tag = readTag(view, offset, little);
    let matrixView = view;
    let matrixTag = tag;
    let matrixLittle = little;
    if (tag.type === MI_COMPRESSED) {
      const inflated = inflateSync(buffer.subarray(tag.dataOffset, tag.next));
      matrixView = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
      matrixTag = readTag(matrixView, 0, matrixLittle);
    }
    if (matrixTag.type === MI_MATRIX) {
      const { name, variable } = readMatrix(matrixView, matrixTag.dataOffset, matrixTag.next, matrixLittle);
      if (variable) variables.set(name, variable);
    }
    offset = tag.type === MI_COMPRESSED ? tag.next : padded(tag);
  }
  return variables;
}
