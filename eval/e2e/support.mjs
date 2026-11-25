// Shared by the browser specs: the catalogue as the backend serves it, a
// page whose API calls are answered by route handlers, the CSP and egress
// checks, and axe.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base } from '@playwright/test';
import { offDeviceRequests } from '../harness/network.mjs';
import { API, APP, PRODUCTS, json } from './catalogue.mjs';

export { API, PRODUCTS };

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STANDIN = resolve(process.env.FACEFIT_STANDIN_DIR ?? join(EVAL, '.cache', 'clips', 'standin'));
export const PORTRAIT = join(STANDIN, 'portrait.jpg');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

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

/** Whether this browser can create a WebGL2 context, which the try-on's overlay needs. */
export const hasWebGl = (page) => page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));

/**
 * Whether a worker can create a WebGL2 context on an OffscreenCanvas. Photo
 * detection runs FaceLandmarker in a worker and needs one; WebKit on Linux
 * has WebGL on the page but not in workers.
 */
export const workerHasWebGl = async (context) => {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      () =>
        new Promise((resolve) => {
          const source =
            'self.onmessage = () => { try { postMessage(Boolean(new OffscreenCanvas(4, 4).getContext("webgl2"))); } catch { postMessage(false); } };';
          const worker = new Worker(URL.createObjectURL(new Blob([source])));
          worker.onmessage = (event) => resolve(event.data);
          worker.postMessage(0);
          setTimeout(() => resolve(false), 5000);
        }),
    );
  } finally {
    await page.close();
  }
};
