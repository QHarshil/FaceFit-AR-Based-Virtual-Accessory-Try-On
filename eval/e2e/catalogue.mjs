// The catalogue as the backend serves it (backend/src/db/seed.ts), and the
// JSON response the route handlers in the browser tests and the page-load
// measurement answer with. The origins are the ones the test server and the
// stubbed API use.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const API = 'http://localhost:5099';
export const APP = 'http://localhost:4199';

export const PRODUCTS = JSON.parse(readFileSync(join(REPO, 'assets', 'catalog.json'), 'utf8')).models.map(
  (model) => ({
    id: model.id,
    slug: model.slug,
    name: model.name,
    description: model.description,
    category: 'glasses',
    type: 'glasses',
    modelPath: `/models/${model.slug}.glb`,
    dimensionsMm: {
      total: model.totalWidthMm,
      lensWidth: model.lensWidthMm,
      lensHeight: model.lensHeightMm,
      bridge: model.bridgeMm,
      templeLength: model.templeLengthMm,
    },
    dimensionsSource: model.dimensionsSource,
    bridgeOriginMm: model.bridgeOriginMm,
    anchors: model.anchors,
    attribution: model.attribution,
  }),
);

export const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': APP, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

