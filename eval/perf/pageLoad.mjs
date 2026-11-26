#!/usr/bin/env node
// Lab LCP, CLS and TBT of the catalogue and the try-on page on the
// production build, against the budgets in budgets.json.
//
//   node perf/pageLoad.mjs                           measures and checks; exit 1 over budget
//   node perf/pageLoad.mjs --write --label <name>    also writes results.json (clean tree)
//
// These are lab numbers from one machine and one throttling profile, not
// field data. Each page loads RUNS times in a fresh context, so nothing is
// cached, and the median of each metric is the result. LCP, CLS and FCP come
// from the `web-vitals` library. It has no TBT, so TBT is summed here from
// the Long Tasks API as Lighthouse defines it: the part of each task over
// 50 ms that starts after first contentful paint, within the first WINDOW_MS
// of the load. The try-on runs against the stand-in clip as its camera, and
// its page is also timed to the first frame the overlay draws (`overlayMs`,
// from the app's `renderedPose` probe event) with the CLS accumulated by then
// (`clsToOverlay`), because LCP and the first CLS shifts happen while the
// camera and the model are still loading. Every figure here is a lab number.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem, type } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { API, APP, PRODUCTS, json } from '../e2e/catalogue.mjs';
import { waitForLocalServer } from '../harness/network.mjs';
import { dirtyPaths, gitIn, startCommit } from '../harness/provenance.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
const STANDIN = resolve(process.env.FACEFIT_STANDIN_DIR ?? join(EVAL, '.cache', 'clips', 'standin'));
// The package's exports map hides dist/, so the browser build is read by path.
const WEB_VITALS = join(EVAL, 'node_modules', 'web-vitals', 'dist', 'web-vitals.iife.js');

export const PAGES = { catalogue: '/', tryOn: '/try-on/1' };
export const RUNS = 5;
export const WINDOW_MS = 10_000;
// How long the try-on may take to draw its first overlay before the run fails.
export const OVERLAY_TIMEOUT_MS = 60_000;
// Mid-range phone on a good connection: CPU four times slower than this
// machine and a 9 Mbit/s, 40 ms link, applied through the DevTools protocol.
export const THROTTLE = { cpuSlowdown: 4, latencyMs: 40, downloadBitsPerSecond: 9_000_000, uploadBitsPerSecond: 1_500_000 };

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Total blocking time: the part of each long task over 50 ms that starts after `fcp`, within `windowMs`. */
export const totalBlockingTime = (longTasks, fcp, windowMs = WINDOW_MS) =>
  longTasks
    .filter((task) => task.startTime >= fcp && task.startTime < windowMs)
    .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);

/** The cumulative CLS in force at `atMs`, from `[{ at, value }]` in time order; 0 before the first shift. */
export const clsAt = (series, atMs) => series.filter((point) => point.at <= atMs).at(-1)?.value ?? 0;

/** Time of the first frame the overlay drew, or null when none was. */
export const firstOverlayMs = (events) => events.find((event) => event.stage === 'renderedPose')?.at ?? null;

/** Problems, one line each, for every median over its budget. */
export const overBudget = (medians, budgets) =>
  Object.entries(budgets).filter(([, limits]) => typeof limits === 'object').flatMap(([page, limits]) =>
    Object.entries(limits).flatMap(([key, max]) => {
      const metric = key.replace(/^max/, '').replace(/^./, (c) => c.toLowerCase());
      const value = medians[page]?.[metric];
      return value === undefined || value > max ? [`${page} ${metric}: ${value} > ${max}`] : [];
    }),
  );

const startServer = async () => {
  const server = spawn(process.execPath, [join(EVAL, 'e2e', 'serve.mjs')], {
    env: { ...process.env, FACEFIT_E2E_PORT: new URL(APP).port },
    stdio: 'ignore',
  });
  if (await waitForLocalServer(new URL(APP).port, { attempts: 600, delayMs: 500 })) return server;
  server.kill();
  throw new Error('the preview server did not start');
};

const measureOnce = async (browser, path) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
  try {
    // Playwright runs init scripts inside a function, so the library's `var` is exported by hand.
    await context.addInitScript(`${readFileSync(WEB_VITALS, 'utf8')}\nwindow.webVitals = webVitals;`);
    await context.addInitScript(() => {
      window.__vitals = { lcp: null, cls: 0, clsSeries: [], fcp: null, longTasks: [] };
      window.__events = [];
      window.__facefitProbe = (event) => window.__events.push({ stage: event.stage, at: performance.now() });
      window.webVitals.onLCP((metric) => { window.__vitals.lcp = metric.value; }, { reportAllChanges: true });
      window.webVitals.onCLS((metric) => {
        window.__vitals.cls = metric.value;
        window.__vitals.clsSeries.push({ at: performance.now(), value: metric.value });
      }, { reportAllChanges: true });
      window.webVitals.onFCP((metric) => { window.__vitals.fcp = metric.value; });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__vitals.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
    });
    await context.route(`${API}/api/products`, (route) => route.fulfill(json(PRODUCTS)));
    await context.route(new RegExp(`^${API}/api/products/(\\d+)$`), (route) => {
      const id = Number(route.request().url().split('/').pop());
      return route.fulfill(json(PRODUCTS.find((item) => item.id === id)));
    });
    await context.route(`${API}/api/telemetry`, (route) => route.fulfill(json({ status: 'accepted' }, 202)));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE.cpuSlowdown });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: THROTTLE.latencyMs,
      downloadThroughput: THROTTLE.downloadBitsPerSecond / 8,
      uploadThroughput: THROTTLE.uploadBitsPerSecond / 8,
    });
    await page.goto(`${APP}${path}`);
    if (path === PAGES.tryOn) {
      await page.waitForFunction(() => window.__events.some((event) => event.stage === 'renderedPose'), undefined, { timeout: OVERLAY_TIMEOUT_MS });
    }
    await page.waitForFunction((windowMs) => performance.now() >= windowMs, WINDOW_MS, { timeout: OVERLAY_TIMEOUT_MS, polling: 250 });
    const { events, ...vitals } = await page.evaluate(() => ({ ...window.__vitals, events: window.__events }));
    if (vitals.lcp === null || vitals.fcp === null) throw new Error(`no LCP or FCP on ${path}`);
    const overlayMs = firstOverlayMs(events);
    return {
      ...(path === PAGES.tryOn ? { overlayMs, clsToOverlay: clsAt(vitals.clsSeries, overlayMs) } : {}),
      lcpMs: vitals.lcp,
      cls: vitals.cls,
      fcpMs: vitals.fcp,
      tbtMs: totalBlockingTime(vitals.longTasks, vitals.fcp),
      longTasks: vitals.longTasks.length,
    };
  } finally {
    await context.close();
  }
};

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The artifact keeps the limits, not the prose that explains them.
  const pageLoad = JSON.parse(readFileSync(join(EVAL, 'perf', 'budgets.json'), 'utf8')).pageLoad;
  const budgets = Object.fromEntries(Object.entries(pageLoad).filter(([, limits]) => typeof limits === 'object'));
  const git = gitIn(REPO);
  const write = process.argv.includes('--write');
  const dirty = dirtyPaths(git);
  if (write && dirty.length) throw new Error(`working tree is dirty; commit first\n${dirty.join('\n')}`);
  const server = await startServer();
  let browser;
  let browserVersion;
  const runs = {};
  try {
    browser = await chromium.launch({
      channel: process.env.FACEFIT_CHROME ?? 'chromium',
      args: [
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${join(STANDIN, 'still.y4m')}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    browserVersion = browser.version();
    for (const [name, path] of Object.entries(PAGES)) {
      runs[name] = [];
      for (let run = 0; run < RUNS; run += 1) runs[name].push(await measureOnce(browser, path));
    }
  } finally {
    await browser?.close();
    server.kill();
  }
  const medians = Object.fromEntries(Object.entries(runs).map(([name, samples]) => [
    name,
    Object.fromEntries(['lcpMs', 'cls', 'fcpMs', 'tbtMs', ...(name === 'tryOn' ? ['overlayMs', 'clsToOverlay'] : [])].map((metric) => [metric, Number(median(samples.map((s) => s[metric])).toFixed(4))])),
  ]));
  for (const [name, values] of Object.entries(medians)) console.log(name.padEnd(10), JSON.stringify(values));
  const problems = overBudget(medians, budgets);
  if (write) {
    const results = JSON.parse(readFileSync(join(EVAL, 'results.json'), 'utf8'));
    const label = arg('label') ?? 'page-load';
    results.runs[label] = {
      measuredAt: new Date().toISOString(),
      commit: startCommit(git),
      dirty: false,
      command: `node eval/perf/pageLoad.mjs --write --label ${label}`,
      kind: 'lab',
      method: `median of ${RUNS} cold loads per page in Playwright Chromium; LCP, CLS and FCP from web-vitals; TBT from long tasks after FCP within ${WINDOW_MS} ms; the try-on reads the stand-in clip as its camera, and overlayMs and clsToOverlay are taken at its first renderedPose event; lab numbers`,
      throttle: THROTTLE,
      hardware: { cpu: cpus()[0].model, memoryGB: Math.round(totalmem() / 2 ** 30), os: `${type()} ${release()}`, browser: `Chromium ${browserVersion}`, viewport: [1280, 720] },
      medians,
      runs,
      budgets,
      overBudget: problems,
    };
    writeFileSync(join(EVAL, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log('wrote eval/results.json');
  }
  if (problems.length) {
    console.error(`over budget\n${problems.join('\n')}`);
    process.exit(1);
  }
}
