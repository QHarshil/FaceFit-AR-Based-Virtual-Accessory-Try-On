// Builds the frontend against the test API origin and serves it with `vite
// preview`, which sends the production CSP. Started by playwright.config.mjs.
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(EVAL, '..', 'frontend');
const DIST = join(EVAL, '.cache', 'e2e-dist');
const API = 'http://localhost:5099';

const env = { ...process.env, VITE_API_URL: API };
execFileSync('npm', ['run', 'build', '--', '--outDir', DIST, '--emptyOutDir'], { cwd: FRONTEND, env, stdio: 'inherit' });
const preview = spawn(
  process.execPath,
  [join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--outDir', DIST, '--port', process.env.FACEFIT_E2E_PORT, '--strictPort'],
  { cwd: FRONTEND, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => preview.kill());
preview.on('exit', (code) => process.exit(code ?? 0));
