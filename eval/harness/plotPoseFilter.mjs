#!/usr/bin/env node
// Draws docs/pose-filter.svg from runs["pose-filter-sweep"] in
// eval/results.json: jitter against lag, one curve per filter and MediaPipe
// configuration (the Pareto front of its sweep), the unfiltered pose, the
// chosen operating points and the targets.
//
//   node eval/harness/plotPoseFilter.mjs
//   node eval/harness/plotPoseFilter.mjs --dirty   (from eval/.cache/results-dirty.json into eval/.cache)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { positionJitterOf, positionLagOf, rotationJitterOf, rotationLagOf, SWEEP_KEY } from './poseFilterSweep.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(EVAL, '..', 'docs', 'pose-filter.svg');

const PANEL = { width: 420, height: 330, left: 64, top: 40, gap: 90 };
const COLORS = { oneEuro: '#1f6fb4', kalman: '#d2691e' };
const NAMES = { oneEuro: 'One Euro', kalman: 'Kalman' };

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const niceTicks = (lo, hi, count = 5) => {
  const step = 10 ** Math.floor(Math.log10((hi - lo) / count));
  const unit = [1, 2, 5, 10].map((m) => m * step).find((s) => (hi - lo) / s <= count) ?? 10 * step;
  const ticks = [];
  for (let v = Math.ceil(lo / unit) * unit; v <= hi + 1e-9; v += unit) ticks.push(Number(v.toPrecision(6)));
  return ticks;
};
const logTicks = (lo, hi) => {
  const ticks = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e += 1) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(Number(v.toPrecision(6)));
    }
  }
  return ticks;
};

/** One panel: series of { label, color, dashed, points: [[lag, jitter]] }, markers, and target lines. */
const panel = ({ x0, title, xLabel, yLabel, series: allSeries, markers: allMarkers, targets }) => {
  let series = allSeries;
  let markers = allMarkers;
  // Lags past six times the target are off the chart; the fronts flatten there.
  const xMax = targets.x * 6;
  const inRange = ([x, y]) => Number.isFinite(x) && x <= xMax && y > 0;
  series = series.map((s) => ({ ...s, points: s.points.filter(inRange) }));
  markers = markers.filter((m) => inRange(m.point));
  const all = [...series.flatMap((s) => s.points), ...markers.map((m) => m.point)];
  const xMin = Math.min(0, ...all.map(([x]) => x));
  const yMin = Math.min(targets.y, ...all.map(([, y]) => y)) / 1.3;
  const yMax = Math.max(targets.y, ...all.map(([, y]) => y)) * 1.3;
  const sx = (x) => x0 + PANEL.left + ((x - xMin) / (xMax - xMin)) * PANEL.width;
  const sy = (y) => PANEL.top + PANEL.height - ((Math.log(y) - Math.log(yMin)) / (Math.log(yMax) - Math.log(yMin))) * PANEL.height;
  const parts = [];
  parts.push(`<text x="${x0 + PANEL.left}" y="${PANEL.top - 14}" font-weight="bold">${escape(title)}</text>`);
  parts.push(`<rect x="${x0 + PANEL.left}" y="${PANEL.top}" width="${PANEL.width}" height="${PANEL.height}" fill="none" stroke="#888"/>`);
  for (const t of niceTicks(xMin, xMax)) {
    parts.push(`<line x1="${sx(t)}" y1="${PANEL.top + PANEL.height}" x2="${sx(t)}" y2="${PANEL.top + PANEL.height + 4}" stroke="#888"/>`);
    parts.push(`<text x="${sx(t)}" y="${PANEL.top + PANEL.height + 17}" text-anchor="middle">${t}</text>`);
  }
  for (const t of logTicks(yMin, yMax)) {
    parts.push(`<line x1="${x0 + PANEL.left - 4}" y1="${sy(t)}" x2="${x0 + PANEL.left}" y2="${sy(t)}" stroke="#888"/>`);
    parts.push(`<line x1="${x0 + PANEL.left}" y1="${sy(t)}" x2="${x0 + PANEL.left + PANEL.width}" y2="${sy(t)}" stroke="#eee"/>`);
    parts.push(`<text x="${x0 + PANEL.left - 7}" y="${sy(t) + 4}" text-anchor="end">${t}</text>`);
  }
  parts.push(`<text x="${x0 + PANEL.left + PANEL.width / 2}" y="${PANEL.top + PANEL.height + 36}" text-anchor="middle">${escape(xLabel)}</text>`);
  parts.push(`<text transform="translate(${x0 + 16} ${PANEL.top + PANEL.height / 2}) rotate(-90)" text-anchor="middle">${escape(yLabel)}</text>`);
  parts.push(`<line x1="${sx(targets.x)}" y1="${PANEL.top}" x2="${sx(targets.x)}" y2="${PANEL.top + PANEL.height}" stroke="#2a2" stroke-dasharray="2 3"/>`);
  parts.push(`<line x1="${x0 + PANEL.left}" y1="${sy(targets.y)}" x2="${x0 + PANEL.left + PANEL.width}" y2="${sy(targets.y)}" stroke="#2a2" stroke-dasharray="2 3"/>`);
  parts.push(`<text x="${sx(targets.x) + 4}" y="${PANEL.top + 12}" fill="#2a2">target</text>`);
  for (const s of series) {
    const d = s.points.filter(([x, y]) => Number.isFinite(x) && y > 0).map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8"${s.dashed ? ' stroke-dasharray="6 4"' : ''}/>`);
    for (const [x, y] of s.points) if (Number.isFinite(x) && y > 0) parts.push(`<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="2" fill="${s.color}"/>`);
  }
  for (const m of markers) {
    const [x, y] = m.point;
    if (!Number.isFinite(x) || !(y > 0)) continue;
    if (m.shape === 'square') parts.push(`<rect x="${sx(x) - 4}" y="${sy(y) - 4}" width="8" height="8" fill="none" stroke="#333" stroke-width="1.5"/>`);
    else parts.push(`<circle cx="${sx(x)}" cy="${sy(y)}" r="6" fill="none" stroke="${m.color}" stroke-width="2"/>`);
    parts.push(`<text x="${sx(x) + 8}" y="${sy(y) - 6}" fill="${m.color ?? '#333'}">${escape(m.label)}</text>`);
  }
  return parts.join('\n');
};

export const renderPlot = (sweep) => {
  const series = (stage, lagOf, jitterOf) => sweep.configurations.flatMap((c) => ['oneEuro', 'kalman'].map((filter) => ({
    label: `${NAMES[filter]}, numFaces ${c.numFaces}`,
    color: COLORS[filter],
    dashed: c.numFaces !== 1,
    points: c[filter][stage].front.map((p) => [lagOf(p), jitterOf(p)]),
  })));
  const { recommended } = sweep;
  const markers = (stage, lagOf, jitterOf) => sweep.configurations.flatMap((c) => [
    { shape: 'square', label: `none, ${c.numFaces}`, point: [lagOf({ metrics: c.unfiltered }), jitterOf({ metrics: c.unfiltered })] },
    ...(recommended.numFaces === c.numFaces
      ? [{ color: COLORS[recommended.filter], label: 'chosen', point: [lagOf(c[recommended.filter][stage].chosen), jitterOf(c[recommended.filter][stage].chosen)] }]
      : []),
  ]);
  const width = 2 * (PANEL.left + PANEL.width) + PANEL.gap;
  const legendY = PANEL.top + PANEL.height + 62;
  const legend = sweep.configurations.flatMap((c) => ['oneEuro', 'kalman'].map((filter) => ({ filter, numFaces: c.numFaces })))
    .map(({ filter, numFaces }, i) => {
      const x = PANEL.left + i * 210;
      return `<line x1="${x}" y1="${legendY}" x2="${x + 30}" y2="${legendY}" stroke="${COLORS[filter]}" stroke-width="2"${numFaces !== 1 ? ' stroke-dasharray="6 4"' : ''}/><text x="${x + 36}" y="${legendY + 4}">${NAMES[filter]}, numFaces ${numFaces}</text>`;
    });
  const footY = legendY + 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${footY + 10}" font-family="sans-serif" font-size="12">
<rect width="100%" height="100%" fill="white"/>
${panel({ x0: 0, title: 'Position: rec-static jitter against lag', xLabel: 'larger of step lag to 90% and ramp delay, ms', yLabel: 'high-pass jitter of the bridge anchor, px', series: series('translation', positionLagOf, positionJitterOf), markers: markers('translation', positionLagOf, positionJitterOf), targets: { x: sweep.targets.lagMs, y: sweep.targets.positionJitterPx } })}
${panel({ x0: PANEL.left + PANEL.width + PANEL.gap, title: 'Rotation: rec-static jitter against roll delay', xLabel: 'delay on the roll sinusoid, ms', yLabel: 'high-pass rotation jitter, deg', series: series('rotation', rotationLagOf, rotationJitterOf), markers: markers('rotation', rotationLagOf, rotationJitterOf), targets: { x: sweep.targets.lagMs, y: sweep.targets.rotationJitterDeg } })}
${legend.join('\n')}
<text x="${PANEL.left}" y="${footY}" fill="#555">${escape(`Replayed from runs recorded with the filter off (${sweep.configurations.map((c) => c.label).join(', ')}), commit ${sweep.commit.slice(0, 9)}. Square: no filter.`)}</text>
</svg>
`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // --dirty plots a sweep from a dirty tree into eval/.cache instead.
  const dirty = process.argv.includes('--dirty');
  const source = join(EVAL, dirty ? join('.cache', 'results-dirty.json') : 'results.json');
  const out = dirty ? join(EVAL, '.cache', 'pose-filter.svg') : OUT;
  const sweep = JSON.parse(readFileSync(source, 'utf8')).runs[SWEEP_KEY];
  if (!sweep) throw new Error(`no runs["${SWEEP_KEY}"] in ${source}; run poseFilterSweep.mjs`);
  writeFileSync(out, renderPlot(sweep));
  console.log(`wrote ${out}`);
}
