// Renders normalized models from front, top and side with anchor markers so axes and
// anchors can be checked by eye. Everything loads from the local static server.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startStaticServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const VIEWS = ['front', 'top', 'side'];

function parseArgs(argv) {
  const options = { out: join(here, 'renders'), glbs: [], withAnchors: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') options.out = argv[++i];
    else if (argv[i] === '--glb') options.glbs.push(argv[++i]);
    else if (argv[i] === '--no-anchors') options.withAnchors = false;
  }
  return options;
}

export async function renderModels(targets, outDir) {
  await mkdir(outDir, { recursive: true });
  const { server, port } = await startStaticServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const written = [];
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    page.on('pageerror', (error) => { throw error; });
    for (const { name, glb, anchors } of targets) {
      for (const view of VIEWS) {
        const query = new URLSearchParams({ glb: `/${glb}`, view, anchors: JSON.stringify(anchors) });
        await page.goto(`http://127.0.0.1:${port}/viewer.html?${query}`);
        await page.waitForFunction('window.renderDone === true', null, { timeout: 30000 });
        const file = join(outDir, `${name}-${view}.png`);
        await page.locator('canvas').screenshot({ path: file });
        written.push(file);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const catalog = JSON.parse(await readFile(join(here, 'catalog.json'), 'utf8'));
  const targets = options.glbs.length
    ? options.glbs.map((glb) => ({ name: glb.replace(/^.*\//, '').replace(/\.glb$/, ''), glb, anchors: {} }))
    : catalog.models.map((model) => ({
        name: model.slug,
        glb: `out/${model.slug}.glb`,
        anchors: options.withAnchors ? model.anchors : {},
      }));
  for (const file of await renderModels(targets, options.out)) console.log(relative(process.cwd(), file));
}
