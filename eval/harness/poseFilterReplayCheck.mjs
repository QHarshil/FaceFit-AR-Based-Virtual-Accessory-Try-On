#!/usr/bin/env node
// Replays harness runs through both filters' swept operating points and
// records the result under `replayCheck` in the sweep detail file
// (eval/results/pose-filter-sweep.json). A run recorded with a filter on still
// carries every solved pose, so the two points can be compared on the
// landmark noise of more than the run the sweep used. For a run recorded with
// a filter, it also measures how far the replay of that filter is from what
// the run drew, which shows the run used the swept parameters.
//
//   node eval/harness/poseFilterReplayCheck.mjs --runs pose-filter-off,pose-filter
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { oneEuroPose, poseKalman } from '../../packages/cv/src/index.ts';
import {
  evaluate, loadRuns, positionJitterOf, positionLagOf, prepare, readSweepDetail, replayErrorPx, rotationJitterOf, rotationLagOf, SWEEP_DETAIL,
  SWEEP_KEY, TARGETS,
} from './poseFilterSweep.mjs';
import { assertHeadUnchanged, dirtyPaths, gitIn, startCommit } from './provenance.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = join(EVAL, 'results.json');
const FILTERS = { oneEuro: oneEuroPose, kalman: poseKalman };
const SETTING_OF = { 'one-euro': 'oneEuro', kalman: 'kalman' };

/** The quantities the sweep selects on, for one replayed point. */
export const replayedPoint = (metrics) => {
  const point = { metrics };
  return {
    positionJitterPx: positionJitterOf(point),
    rotationJitterDeg: rotationJitterOf(point),
    worstJitterRatio: Math.max(positionJitterOf(point) / TARGETS.positionJitterPx, rotationJitterOf(point) / TARGETS.rotationJitterDeg),
    positionLagMs: positionLagOf(point),
    rotationLagMs: rotationLagOf(point),
    stepOvershootPercent: metrics.stepOvershootPercent,
    blinkShiftPx: metrics.blinkShiftPx,
  };
};

const round = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'number' ? Number(v.toPrecision(4)) : v)));

const main = () => {
  const i = process.argv.indexOf('--runs');
  const labels = (i > 0 ? process.argv[i + 1] : '').split(',').filter(Boolean);
  if (!labels.length) throw new Error('pass --runs <label>[,<label>]');
  const git = gitIn(join(EVAL, '..'));
  const dirty = dirtyPaths(git);
  if (dirty.length) {
    console.error(`working tree is dirty; commit first\n${dirty.join('\n')}`);
    process.exit(1);
  }
  const commit = startCommit(git);
  const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const detail = readSweepDetail(pathToFileURL(RESULTS), results.runs[SWEEP_KEY]);
  const checked = labels.map((label) => {
    const recorded = results.runs[label];
    if (!recorded) throw new Error(`no runs["${label}"] in results.json`);
    const numFaces = Number(/numFaces (\d+)/.exec(recorded.pipeline)[1]);
    const configuration = detail.configurations.find((c) => c.numFaces === numFaces);
    if (!configuration) throw new Error(`the sweep has no numFaces ${numFaces} configuration for ${label}`);
    const runs = loadRuns(label);
    const prepared = prepare(runs);
    const points = Object.fromEntries(Object.entries(FILTERS).map(([name, create]) => {
      const { params } = configuration[name].chosen;
      return [name, replayedPoint(evaluate(runs, prepared, () => create(params)))];
    }));
    const setting = runs['rec-static'].events.find((e) => e.stage === 'glassesPose')?.poseFilter;
    const filter = SETTING_OF[setting];
    const reproductionErrorPx = filter ? replayErrorPx(runs, () => FILTERS[filter](configuration[filter].chosen.params)) : null;
    console.log(`${label}: ${JSON.stringify(points)}`);
    return { label, commit: recorded.commit, numFaces, poseFilter: setting ?? null, reproductionErrorPx, ...points };
  });
  assertHeadUnchanged(git, commit);
  detail.replayCheck = round({
    measuredAt: new Date().toISOString(),
    commit,
    command: `node eval/harness/poseFilterReplayCheck.mjs ${process.argv.slice(2).join(' ')}`.trim(),
    method: 'Each run replayed through the swept One Euro and Kalman operating points for its numFaces, as the sweep replays (eval/harness/poseReplay.mjs). reproductionErrorPx: largest distance between what a filtered run drew and the replay of that filter at its swept point.',
    runs: checked,
  });
  const out = join(EVAL, SWEEP_DETAIL);
  writeFileSync(out, `${JSON.stringify(detail, null, 2)}\n`);
  console.log(`wrote ${out}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
