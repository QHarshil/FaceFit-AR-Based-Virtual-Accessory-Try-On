import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardOutcome, leavesDevice, offDeviceRequests, sawWorkerFetch, waitForLocalServer } from './network.mjs';

test('localhost requests on any port stay on the device', () => {
  for (const url of [
    'http://localhost:4177/assets/index.js',
    'http://localhost:5077/api/products/1',
    'http://127.0.0.1:4177/',
    'http://[::1]:4177/',
    'ws://localhost:3000/',
  ]) {
    assert.equal(leavesDevice(url), false, url);
  }
});

test('blob and data URLs never reach the network', () => {
  assert.equal(leavesDevice('blob:http://localhost:4177/9b1f2c'), false);
  assert.equal(leavesDevice('data:image/png;base64,AAAA'), false);
});

test('any other host, scheme or unparsable URL leaves the device', () => {
  for (const url of [
    'https://odml.pa.googleapis.com/v1/log',
    'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js',
    'http://localhost.example.com/',
    'http://192.168.1.5:4177/',
    'ftp://localhost/file',
    'not a url',
  ]) {
    assert.equal(leavesDevice(url), true, url);
  }
});

test('offDeviceRequests lists each leaking URL once', () => {
  const urls = [
    'http://localhost:4177/',
    'https://odml.pa.googleapis.com/v1/log',
    'https://odml.pa.googleapis.com/v1/log',
  ];
  assert.deepEqual(offDeviceRequests(urls), ['https://odml.pa.googleapis.com/v1/log']);
  assert.deepEqual(offDeviceRequests(['http://localhost:4177/']), []);
});

test('guardOutcome tells a blocked attempt from a recorded request and a miss', () => {
  const url = 'https://guard-selftest.invalid/xhr';
  const local = ['http://localhost:4177/assets/index.js'];
  assert.equal(guardOutcome(url, { blocked: [url], requests: local }), 'blocked');
  assert.equal(guardOutcome(url, { blocked: [], requests: [...local, url] }), 'detected');
  assert.equal(guardOutcome(url, { blocked: ['https://guard-selftest.invalid/fetch'], requests: local }), 'missed');
});

test('sawWorkerFetch finds the model request the worker makes', () => {
  assert.equal(
    sawWorkerFetch(['http://localhost:4177/mediapipe/face_landmarker/float16/1/face_landmarker.task']),
    true,
  );
  assert.equal(sawWorkerFetch(['http://localhost:4177/assets/index.js']), false);
});

test('a server on one loopback address is found whichever address localhost resolves to', async () => {
  const { createServer } = await import('node:http');
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer((_, response) => response.end('ok'));
    const listening = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(0, host, () => resolve(true));
    });
    if (!listening) continue;
    try {
      assert.equal(await waitForLocalServer(server.address().port, { attempts: 3, delayMs: 10 }), true);
    } finally {
      server.close();
    }
  }
});

test('waiting on a port nothing listens on gives up', async () => {
  assert.equal(await waitForLocalServer(1, { attempts: 2, delayMs: 10 }), false);
});
