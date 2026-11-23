// Turns the Sketchfab source GLBs into the canonical frame described in README.md:
// millimetres, origin at the bridge centre, +x wearer's left, +y up, +z out of the face.
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import {
  cloneDocument, dedup, draco, flatten, join as joinMeshes, meshopt, prune, transformMesh, weld,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { axisCorrectionMatrix, multiply, scaling, transformPoint, translation } from './geometry.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });
}

export async function loadCatalog() {
  return JSON.parse(await readFile(join(here, 'catalog.json'), 'utf8'));
}

// Each primitive gets private accessors so baking one node's transform cannot touch another mesh.
function uniquifyGeometry(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        primitive.setAttribute(semantic, primitive.getAttribute(semantic).clone());
      }
      const indices = primitive.getIndices();
      if (indices) primitive.setIndices(indices.clone());
    }
  }
}

function bakeNodeTransforms(document, correction) {
  const scene = document.getRoot().getDefaultScene();
  for (const node of scene.listChildren()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    const uses = mesh.listParents().filter((parent) => parent.propertyType === 'Node');
    const ownMesh = uses.length > 1 ? mesh.clone() : mesh;
    if (ownMesh !== mesh) node.setMesh(ownMesh);
    transformMesh(ownMesh, multiply(correction, world));
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
}

// Temples splay outward, so the frame width is measured on the front slab only.
export const FRONT_SLAB_FRACTION = 0.15;

export function measureFront(vertices) {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const v of vertices) {
    zMin = Math.min(zMin, v[2]);
    zMax = Math.max(zMax, v[2]);
  }
  const slabStart = zMax - FRONT_SLAB_FRACTION * (zMax - zMin);
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const v of vertices) {
    yMin = Math.min(yMin, v[1]);
    yMax = Math.max(yMax, v[1]);
    if (v[2] < slabStart) continue;
    xMin = Math.min(xMin, v[0]);
    xMax = Math.max(xMax, v[0]);
  }
  return { width: xMax - xMin, centerX: (xMin + xMax) / 2, centerY: (yMin + yMax) / 2, zMax };
}

// Vertex positions in scene space, decoding quantized accessors and node transforms.
export function worldVertices(document) {
  const vertices = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      const v = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, v);
        vertices.push(transformPoint(m, v));
      }
    }
  }
  return vertices;
}

function applyToMeshes(document, matrix) {
  for (const mesh of document.getRoot().listMeshes()) transformMesh(mesh, matrix);
}

function setAttribution(document, spec) {
  const asset = document.getRoot().getAsset();
  const { title, author, authorUrl, sourceUrl, license, licenseUrl } = spec.attribution;
  asset.copyright = `${title} by ${author} (${authorUrl}), ${license} (${licenseUrl}), ${sourceUrl}. Modified: rotated, scaled to millimetres, re-centred and compressed.`;
  asset.extras = { title, author, authorUrl, sourceUrl, license, licenseUrl, normalizedBy: 'FaceFit assets/normalize.mjs' };
}

// Returns the structurally normalized document, before compression.
export async function normalizeStructure(io, spec) {
  const document = await io.read(join(here, spec.source));
  document.setLogger(new Logger(Logger.Verbosity.WARN));
  uniquifyGeometry(document);
  await document.transform(flatten());
  bakeNodeTransforms(document, axisCorrectionMatrix(spec.axisCorrection));

  const corrected = worldVertices(document);
  const frontWidthUnits = measureFront(corrected).width;
  const scale = spec.totalWidthMm / frontWidthUnits;
  applyToMeshes(document, scaling(scale));

  await document.transform(dedup(), joinMeshes(), weld(), prune());

  // Align the frame front to x = 0 and z = 0, then move the bridge centre to the origin.
  const front = measureFront(worldVertices(document));
  applyToMeshes(document, translation([-front.centerX, -front.centerY, -front.zMax]));
  applyToMeshes(document, translation(spec.bridgeOriginMm.map((v) => -v)));
  setAttribution(document, spec);
  return { document, scale };
}

async function encode(io, document, codec) {
  const copy = cloneDocument(document);
  if (codec === 'meshopt') {
    await copy.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  } else if (codec === 'draco') {
    await copy.transform(draco());
  }
  return io.writeBinary(copy);
}

export async function normalizeModel(io, spec) {
  const { document, scale } = await normalizeStructure(io, spec);
  const variants = {};
  for (const codec of ['none', 'meshopt', 'draco']) variants[codec] = await encode(io, document, codec);
  return { scale, variants, bytes: variants.meshopt };
}

async function main() {
  const catalog = await loadCatalog();
  const io = await createIO();
  const outDir = join(here, 'out');
  await mkdir(outDir, { recursive: true });
  const report = [];
  for (const spec of catalog.models) {
    const { scale, variants, bytes } = await normalizeModel(io, spec);
    await writeFile(join(outDir, `${spec.slug}.glb`), bytes);
    const sourceBytes = (await readFile(join(here, spec.source))).byteLength;
    report.push({
      slug: spec.slug,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scaleMmPerUnit: scale,
      sourceBytes,
      sourceBrotliBytes: brotliSync(await readFile(join(here, spec.source))).byteLength,
      bytesByCodec: Object.fromEntries(Object.entries(variants).map(([codec, data]) => [codec, data.byteLength])),
      brotliBytesByCodec: Object.fromEntries(
        Object.entries(variants).map(([codec, data]) => [codec, brotliSync(data).byteLength]),
      ),
    });
  }
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function brotliSync(buffer) {
  return brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
