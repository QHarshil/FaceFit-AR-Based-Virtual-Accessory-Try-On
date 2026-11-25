// @vitest-environment node
// Contract between the frontend's telemetry and the backend: every event the
// frontend can build passes the schema the backend validates with.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_TELEMETRY_BYTES, telemetryBody, type TelemetryEvent } from '@facefit/contracts';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '../../services/apiClient';
import { CAMERA_FAILURES, PERCEPTION_FAILURES } from '../../tracking/failures';
import { RENDER_FAILURES, telemetryEvents, type TelemetryEventName } from '../events';

const API_FAILURES: readonly ApiFailure[] = [
  'network',
  'timeout',
  'not_found',
  'server_error',
  'invalid_response',
];
const PRODUCT_IDS = [1, 2_147_483_647];
const SESSION_PRODUCT_IDS = [null, ...PRODUCT_IDS];

// A Record over every builder, so a new builder does not compile until it has cases.
const CASES: Record<TelemetryEventName, TelemetryEvent[]> = {
  catalogueLoaded: [0, 4, 1_000].map(telemetryEvents.catalogueLoaded),
  catalogueFailed: API_FAILURES.map(telemetryEvents.catalogueFailed),
  productViewed: PRODUCT_IDS.map(telemetryEvents.productViewed),
  productLoadFailed: [null, ...PRODUCT_IDS].flatMap((id) =>
    API_FAILURES.map((failure) => telemetryEvents.productLoadFailed(id, failure)),
  ),
  cameraStarted: SESSION_PRODUCT_IDS.map(telemetryEvents.cameraStarted),
  cameraError: SESSION_PRODUCT_IDS.flatMap((id) =>
    [...CAMERA_FAILURES, 'ended' as const].map((failure) =>
      telemetryEvents.cameraError(id, failure),
    ),
  ),
  trackingError: SESSION_PRODUCT_IDS.flatMap((id) =>
    PERCEPTION_FAILURES.map((failure) => telemetryEvents.trackingError(id, failure)),
  ),
  renderError: SESSION_PRODUCT_IDS.flatMap((id) =>
    RENDER_FAILURES.map((failure) => telemetryEvents.renderError(id, failure)),
  ),
  faceDetectedChanged: SESSION_PRODUCT_IDS.flatMap((id) =>
    [true, false].map((detected) => telemetryEvents.faceDetectedChanged(id, detected)),
  ),
};

const SRC = fileURLToPath(new URL('../..', import.meta.url));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe('telemetry contract', () => {
  it('has a case for every builder', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(telemetryEvents).sort());
  });

  it.each(Object.entries(CASES))('%s builds events the backend accepts', (_name, events) => {
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const json = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
      expect(json.length).toBeLessThanOrEqual(MAX_TELEMETRY_BYTES);
      const parsed = telemetryBody.safeParse(JSON.parse(json));
      expect(parsed.error?.issues ?? []).toEqual([]);
    }
  });

  it('builds payloads only in telemetry/events.ts', () => {
    const builders = sourceFiles(SRC).filter((path) =>
      /\beventType\s*:/.test(readFileSync(path, 'utf8')),
    );
    expect(builders.map((path) => relative(SRC, path))).toEqual(['telemetry/events.ts']);
  });

  it('sends only events from the builders', () => {
    const callers = sourceFiles(SRC).filter((path) =>
      readFileSync(path, 'utf8').includes('sendTelemetry('),
    );
    expect(callers.length).toBeGreaterThan(0);
    for (const path of callers) {
      if (path.endsWith(join('telemetry', 'client.ts'))) continue;
      expect(readFileSync(path, 'utf8'), relative(SRC, path)).toContain('telemetryEvents.');
    }
  });
});
