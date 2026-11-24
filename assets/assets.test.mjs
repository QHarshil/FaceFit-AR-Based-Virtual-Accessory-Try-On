import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getBounds } from '@gltf-transform/functions';
import { createIO, loadCatalog, normalizeModel } from './normalize.mjs';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const TRADEMARKS = /ray.?ban|aviator|wayfarer/i;
const ANCHORS = ['bridgeCenter', 'nosePadLeft', 'nosePadRight', 'hingeLeft', 'hingeRight'];
const DIMENSIONS = ['totalWidthMm', 'lensWidthMm', 'lensHeightMm', 'bridgeMm', 'templeLengthMm'];

let catalog;
let io;
before(async () => {
  catalog = await loadCatalog();
  io = await createIO();
});

// Decoded vertex positions in scene space, written independently of normalize.mjs so a shared bug cannot hide.
function sceneVertices(document) {
  const out = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      for (let i = 0; i < position.getCount(); i++) {
        const [x, y, z] = position.getElement(i, [0, 0, 0]);
        out.push([
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]);
      }
    }
  }
  return out;
}

const isVector3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

describe('catalog schema', () => {
  test('has ids 1 to 4 with unique slugs', () => {
    assert.deepEqual(catalog.models.map((m) => m.id), [1, 2, 3, 4]);
    assert.equal(new Set(catalog.models.map((m) => m.slug)).size, 4);
  });

  test('every field is present and typed', () => {
    for (const m of catalog.models) {
      for (const key of ['slug', 'name', 'description', 'source']) assert.ok(m[key]?.length > 0, `${m.slug}.${key}`);
      assert.ok(isVector3(m.axisCorrection), `${m.slug}.axisCorrection`);
      assert.ok(isVector3(m.bridgeOriginMm), `${m.slug}.bridgeOriginMm`);
      assert.equal(m.dimensionsSource, 'nominal');
      assert.ok(isVector3(m.expectedBoundsMm.min) && isVector3(m.expectedBoundsMm.max), `${m.slug}.expectedBoundsMm`);
      for (const key of DIMENSIONS) assert.ok(m[key] > 0 && Number.isFinite(m[key]), `${m.slug}.${key}`);
      for (const name of ANCHORS) assert.ok(isVector3(m.anchors[name]), `${m.slug}.anchors.${name}`);
      for (const key of ['title', 'author', 'authorUrl', 'sourceUrl', 'license', 'licenseUrl']) {
        assert.ok(m.attribution[key]?.length > 0, `${m.slug}.attribution.${key}`);
      }
    }
  });

  test('names and descriptions carry no trademarks', () => {
    for (const m of catalog.models) assert.doesNotMatch(`${m.name} ${m.description}`, TRADEMARKS);
  });

  test('attribution matches the asset.extras embedded in each source', async () => {
    for (const m of catalog.models) {
      const extras = (await io.read(here(m.source))).getRoot().getAsset().extras;
      assert.equal(extras.title, m.attribution.title);
      assert.ok(extras.author.startsWith(m.attribution.author));
      assert.ok(extras.author.includes(m.attribution.authorUrl));
      assert.equal(extras.source, m.attribution.sourceUrl);
      assert.ok(extras.license.startsWith(m.attribution.license));
    }
  });
});

describe('normalized output', () => {
  const decoded = new Map();
  before(async () => {
    for (const m of catalog.models) decoded.set(m.slug, await io.read(here(`out/${m.slug}.glb`)));
  });

  test('manifest lists every catalog model with the hash of its committed file', async () => {
    // frontend/scripts/vendor-models.mjs serves exactly the manifest entries.
    const manifest = JSON.parse(await readFile(here('out/manifest.json'), 'utf8'));
    assert.deepEqual(manifest.map((entry) => entry.slug).sort(), catalog.models.map((m) => m.slug).sort());
    for (const entry of manifest) {
      const digest = createHash('sha256').update(await readFile(here(`out/${entry.slug}.glb`))).digest('hex');
      assert.equal(digest, entry.sha256, entry.slug);
    }
  });

  test('is deterministic and matches the committed file', async () => {
    for (const m of catalog.models) {
      const first = await normalizeModel(io, m);
      const second = await normalizeModel(io, m);
      assert.ok(Buffer.from(first.bytes).equals(Buffer.from(second.bytes)), `${m.slug} differs between runs`);
      const committed = await readFile(here(`out/${m.slug}.glb`));
      assert.ok(committed.equals(Buffer.from(first.bytes)), `${m.slug} out file is stale, run npm run normalize`);
    }
  });

  test('frame front spans totalWidthMm within 1 mm', () => {
    for (const m of catalog.models) {
      // Front slab ends 3 mm behind the hinge, so splayed temples are excluded.
      const slab = sceneVertices(decoded.get(m.slug)).filter((v) => v[2] >= m.anchors.hingeLeft[2] - 3);
      const xs = slab.map((v) => v[0]);
      const width = Math.max(...xs) - Math.min(...xs);
      assert.ok(Math.abs(width - m.totalWidthMm) <= 1, `${m.slug}: ${width.toFixed(2)} vs ${m.totalWidthMm}`);
    }
  });

  test('scene bounds match the pinned expectedBoundsMm within 1 mm', () => {
    // Pins scale, origin and orientation: a shift, tilt or roll of the model moves at least one face.
    for (const m of catalog.models) {
      const { min, max } = getBounds(decoded.get(m.slug).getRoot().getDefaultScene());
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Math.abs(min[axis] - m.expectedBoundsMm.min[axis]) <= 1, `${m.slug} min[${axis}] ${min[axis].toFixed(2)}`);
        assert.ok(Math.abs(max[axis] - m.expectedBoundsMm.max[axis]) <= 1, `${m.slug} max[${axis}] ${max[axis].toFixed(2)}`);
      }
    }
  });

  test('origin sits at the bridge anchor on the frame front', () => {
    for (const m of catalog.models) {
      const vertices = sceneVertices(decoded.get(m.slug));
      assert.deepEqual(m.anchors.bridgeCenter, [0, 0, 0]);
      const nearest = Math.min(...vertices.map((v) => Math.hypot(...v)));
      assert.ok(nearest < 8, `${m.slug}: nearest vertex to the origin is ${nearest.toFixed(1)} mm away`);
      // The bridge centre is on the rear face of the bridge bar, so the front plane is 1 to 6 mm ahead of it.
      const frontZ = Math.max(...vertices.map((v) => v[2]));
      assert.ok(frontZ > 1 && frontZ < 6, `${m.slug}: front plane at z = ${frontZ.toFixed(2)}`);
      const slab = vertices.filter((v) => v[2] >= m.anchors.hingeLeft[2] - 3).map((v) => v[0]);
      assert.ok(Math.abs((Math.max(...slab) + Math.min(...slab)) / 2) < 0.5, `${m.slug}: front is off-centre in x`);
    }
  });

  test('anchors lie inside the model bounds', () => {
    for (const m of catalog.models) {
      const { min, max } = getBounds(decoded.get(m.slug).getRoot().getDefaultScene());
      for (const name of ANCHORS) {
        m.anchors[name].forEach((value, axis) => {
          assert.ok(value >= min[axis] - 0.5 && value <= max[axis] + 0.5, `${m.slug}.${name}[${axis}]`);
        });
      }
    }
  });

  test('left anchors are +x and mirror the right ones', () => {
    for (const m of catalog.models) {
      const { nosePadLeft, nosePadRight, hingeLeft, hingeRight } = m.anchors;
      for (const [left, right] of [[nosePadLeft, nosePadRight], [hingeLeft, hingeRight]]) {
        assert.ok(left[0] > 0 && right[0] < 0);
        assert.deepEqual([-left[0], left[1], left[2]], right);
      }
      assert.ok(nosePadLeft[0] < hingeLeft[0]);
      assert.ok(Math.abs(hingeLeft[0] - m.totalWidthMm / 2) < 8, `${m.slug} hinge is far from the frame edge`);
    }
  });

  test('temples extend from the hinge along -z by roughly templeLengthMm', () => {
    for (const m of catalog.models) {
      const { min } = getBounds(decoded.get(m.slug).getRoot().getDefaultScene());
      const length = -min[2] + m.anchors.hingeLeft[2];
      assert.ok(Math.abs(length - m.templeLengthMm) / m.templeLengthMm < 0.1, `${m.slug}: length ${length.toFixed(1)}`);
    }
  });

  test('is flat, one mesh per material, meshopt-compressed, and keeps CC BY attribution', () => {
    for (const m of catalog.models) {
      const root = decoded.get(m.slug).getRoot();
      assert.ok(root.listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression'));
      assert.equal(root.getDefaultScene().listChildren().length, root.listNodes().length);
      assert.ok(root.listNodes().every((n) => n.getMesh() && n.listChildren().length === 0));
      assert.equal(root.listNodes().length, root.listMaterials().length, `${m.slug} should be one mesh per material`);
      const asset = root.getAsset();
      assert.equal(asset.extras.license, m.attribution.license);
      assert.equal(asset.extras.author, m.attribution.author);
      assert.equal(asset.extras.sourceUrl, m.attribution.sourceUrl);
      assert.match(asset.copyright, new RegExp(m.attribution.author));
    }
  });
});
