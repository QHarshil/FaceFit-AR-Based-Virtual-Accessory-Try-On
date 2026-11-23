import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getBounds } from '@gltf-transform/functions';
import { createIO, loadCatalog, measureFront, normalizeModel, worldVertices } from './normalize.mjs';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const ANCHORS = ['bridgeCenter', 'nosePadLeft', 'nosePadRight', 'hingeLeft', 'hingeRight'];
const DIMENSIONS = ['totalWidthMm', 'lensWidthMm', 'lensHeightMm', 'bridgeMm', 'templeLengthMm'];

let catalog;
let io;
before(async () => {
  catalog = await loadCatalog();
  io = await createIO();
});

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
      for (const key of DIMENSIONS) assert.ok(m[key] > 0 && Number.isFinite(m[key]), `${m.slug}.${key}`);
      for (const name of ANCHORS) assert.ok(isVector3(m.anchors[name]), `${m.slug}.anchors.${name}`);
      for (const key of ['title', 'author', 'authorUrl', 'sourceUrl', 'license', 'licenseUrl']) {
        assert.ok(m.attribution[key]?.length > 0, `${m.slug}.attribution.${key}`);
      }
    }
  });

  test('names carry no trademarks', () => {
    for (const m of catalog.models) assert.doesNotMatch(`${m.name} ${m.description}`, /ray.?ban|aviator|wayfarer/i);
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

  test('sources are byte-identical to the models the app loads today', async () => {
    for (const m of catalog.models) {
      const legacy = m.source.replace('source/', '../frontend/public/models/');
      assert.ok((await readFile(here(m.source))).equals(await readFile(here(legacy))), m.source);
    }
  });
});

describe('backend product list', () => {
  // server.js listens on import, so read the array literal instead of requiring the module.
  const source = readFileSync(here('../backend/server.js'), 'utf8');
  const literal = source.slice(source.indexOf('const products = [') + 'const products = '.length, source.indexOf('];') + 1);
  const products = new Function(`return ${literal}`)();

  test('mirrors the catalog and keeps the legacy model paths', () => {
    assert.equal(products.length, catalog.models.length);
    for (const m of catalog.models) {
      const product = products.find((p) => p.id === m.id);
      assert.equal(product.name, m.name);
      assert.equal(product.description, m.description);
      assert.equal(product.modelPath, `/models/glasses${m.id}.glb`);
      assert.deepEqual(product.attribution, m.attribution);
      assert.deepEqual(product.dimensionsMm, {
        total: m.totalWidthMm,
        lensWidth: m.lensWidthMm,
        lensHeight: m.lensHeightMm,
        bridge: m.bridgeMm,
        templeLength: m.templeLengthMm,
      });
      assert.equal(product.dimensionsSource, 'nominal');
    }
  });
});

describe('normalized output', () => {
  const decoded = new Map();
  before(async () => {
    for (const m of catalog.models) decoded.set(m.slug, await io.read(here(`out/${m.slug}.glb`)));
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
      const { width } = measureFront(worldVertices(decoded.get(m.slug)));
      assert.ok(Math.abs(width - m.totalWidthMm) <= 1, `${m.slug}: ${width.toFixed(2)} vs ${m.totalWidthMm}`);
    }
  });

  test('origin sits at the bridge anchor, centred and at the front plane', () => {
    for (const m of catalog.models) {
      const vertices = worldVertices(decoded.get(m.slug));
      assert.deepEqual(m.anchors.bridgeCenter, [0, 0, 0]);
      const front = measureFront(vertices);
      assert.ok(Math.abs(front.centerX) < 0.1, `${m.slug} centerX ${front.centerX}`);
      const nearest = Math.min(...vertices.map((v) => Math.hypot(...v)));
      assert.ok(nearest < 8, `${m.slug}: nearest vertex to the origin is ${nearest.toFixed(1)} mm away`);
      assert.ok(front.zMax > 0 && front.zMax < 6, `${m.slug}: bridge is ${front.zMax} mm behind the front plane`);
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
