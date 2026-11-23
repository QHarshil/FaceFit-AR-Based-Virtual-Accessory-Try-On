import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });

const waitFor = (child: ChildProcessByStdio<null, Readable, null>, text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    let seen = '';
    child.stdout.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      if (seen.includes(text)) resolve();
    });
    child.once('exit', () => {
      reject(new Error(`process exited before logging "${text}"`));
    });
  });

it('finishes an in-flight request when SIGTERM arrives twice', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'facefit-signals-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const url = `pglite://${dir}/db`;
  const database = await openDatabase(url);
  await database.migrate();
  await database.close();

  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, DATABASE_URL: url, PORT: String(port), SHUTDOWN_TIMEOUT_MS: '10000' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  cleanups.push(() => {
    child.kill('SIGKILL');
    return Promise.resolve();
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => resolve(code)),
  );
  await waitFor(child, '"msg":"listening"');

  // Send half the body so the server holds the request open while it drains.
  const body = JSON.stringify({ eventType: 'camera_started', payload: { productId: 1 } });
  const half = Math.floor(body.length / 2);
  const socket = createConnection({ port, host: '127.0.0.1' });
  const reply = new Promise<string>((resolve) => {
    let received = '';
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString();
    });
    socket.on('close', () => {
      resolve(received);
    });
    socket.on('error', () => {
      resolve(received);
    });
  });
  socket.write(
    `POST /api/telemetry HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${String(body.length)}\r\nConnection: close\r\n\r\n${body.slice(0, half)}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));

  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 200));
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(child.exitCode).toBeNull();

  socket.write(body.slice(half));
  expect(await reply).toContain('202 Accepted');
  expect(await exited).toBe(0);
});
