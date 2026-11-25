// Shared by the browser specs: the catalogue as the backend serves it, a
// page whose API calls are answered by route handlers, the CSP and egress
// checks, and axe.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base } from '@playwright/test';
import { offDeviceRequests } from '../harness/network.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
export const STANDIN = resolve(process.env.FACEFIT_STANDIN_DIR ?? join(EVAL, '.cache', 'clips', 'standin'));
export const PORTRAIT = join(STANDIN, 'portrait.jpg');
export const API = 'http://localhost:5099';
const APP = 'http://localhost:4199';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

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

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': APP },
  body: JSON.stringify(body),
});

/**
 * `app` is a page with probe and CSP recording and the API served by route
 * handlers. `requests` lists every URL the page and its workers asked for.
 */
export const test = base.extend({
  app: async ({ page, context }, use) => {
    await context.addInitScript(() => {
      window.__events = [];
      window.__facefitProbe = (event) => window.__events.push({ ...event, at: performance.now() });
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__csp.push(`${event.effectiveDirective} ${event.blockedURI}`);
      });
    });
    const requests = [];
    context.on('request', (request) => requests.push(request.url()));
    await context.route(`${API}/api/products`, (route) => route.fulfill(json(PRODUCTS)));
    await context.route(new RegExp(`^${API}/api/products/(\\d+)$`), (route) => {
      const id = Number(route.request().url().split('/').pop());
      const product = PRODUCTS.find((item) => item.id === id);
      return route.fulfill(product ? json(product) : json({ error: 'Product not found' }, 404));
    });
    await context.route(`${API}/api/telemetry`, (route) => route.fulfill(json({ status: 'accepted' }, 202)));
    await use({ page, context, requests });
  },
});

export { expect };

export const status = (page, name, timeout = 60_000) =>
  page.locator(`[data-status="${name}"]`).waitFor({ timeout });

export const countEvents = (page, stage) =>
  page.evaluate((name) => window.__events.filter((event) => event.stage === name).length, stage);

// axe-core builds its messages with `new Function`, which the production CSP
// reports. Each test checks the CSP before it injects axe into a document.
export const axeViolations = async (page) => {
  await page.evaluate(AXE);
  const { violations } = await page.evaluate(() => window.axe.run(document));
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(', ')}`);
};

export const assertStayedOnDevice = async ({ page, requests }) => {
  expect(offDeviceRequests(requests)).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
};
