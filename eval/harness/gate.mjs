// Registration gate for CI: pass/fail limits on the geometry metrics of a
// stand-in run, checked against `gate.json`. Timing metrics are not gated,
// because runner hardware changes them without a code change.

const metricOf = (summary, path) => path.split('.').reduce((value, key) => (value == null ? value : value[key]), summary);

/**
 * Largest bridge offset across the translate conditions, in interocular
 * distances. Null when a condition has no offset: `Math.hypot(null, null)` is
 * 0, which would read as a perfect registration.
 */
export const bridgeOffsetOverInterocular = (registration) => {
  if (!registration?.offsetPxByCondition) return null;
  const offsets = Object.values(registration.offsetPxByCondition);
  if (!offsets.length || !offsets.every((offset) => Array.isArray(offset) && offset.every(Number.isFinite))) return null;
  return Math.max(...offsets.map(([x, y]) => Math.hypot(x, y))) / registration.interocularPx;
};

/**
 * Gated share over the conditions that keep the face most central (still,
 * roll, dx), where the solver gates nothing on the stand-in. A condition with
 * no pose samples at all has a share of 1, not a missing one.
 */
export const coreGatedShare = (solver) => {
  const core = Object.entries(solver?.byCondition ?? {}).filter(([id]) => /^(still|roll|dx)/.test(id));
  const samples = core.reduce((sum, [, condition]) => sum + condition.samples, 0);
  if (!samples) return core.length ? 1 : null;
  return core.reduce((sum, [, condition]) => sum + condition.gated, 0) / samples;
};

/**
 * Mean over conditions of each condition's gated share. Pooling samples
 * instead lets a slow runner skew the result: a condition the solver gates at
 * every sample still yields frames at the camera rate, while conditions with
 * a face wait on inference. A condition with no pose samples counts as fully
 * gated, so it cannot drop out of the mean.
 */
export const meanConditionGatedShare = (solver) => {
  const conditions = Object.values(solver?.byCondition ?? {});
  if (!conditions.length) return null;
  return conditions.reduce((sum, condition) => sum + (condition.samples > 0 ? condition.gated / condition.samples : 1), 0) / conditions.length;
};

/**
 * Conditions each metric group read, by `summary` path. A condition with fewer
 * than `minShownSamples` shown poses has no usable median, so the group that
 * used it has no value to gate.
 */
const conditionsUsed = (summary) => [
  ['roll', summary.roll?.conditions ?? []],
  ['registration', Object.keys(summary.registration?.offsetPxByCondition ?? {})],
  ['scale', Object.keys(summary.scale ?? {})],
  ['scaleByProduct.product1', Object.keys(summary.scaleByProduct?.product1?.renderedOverFace ?? {})],
];

/** One line per condition a metric used that showed fewer than `minShownSamples` poses. */
export const sparseConditionProblems = (summary, minShownSamples) => {
  if (!Number.isInteger(minShownSamples) || minShownSamples < 1) return ['minShownSamples: not set in the gate limits'];
  const shown = summary.shownSamples ?? {};
  return conditionsUsed(summary).flatMap(([group, ids]) =>
    ids.flatMap((id) => (shown[id] >= minShownSamples ? [] : [`${group}: condition ${id} showed ${shown[id] ?? 0} poses, fewer than ${minShownSamples}`])),
  );
};

/** One line per metric outside its `min` or `max`, or missing. */
export const gateProblems = (summary, limits) => {
  const derived = {
    ...summary,
    derived: {
      bridgeOffsetOverInterocular: bridgeOffsetOverInterocular(summary.registration),
      coreGatedShare: coreGatedShare(summary.solver),
      meanConditionGatedShare: meanConditionGatedShare(summary.solver),
    },
  };
  const sparse = sparseConditionProblems(summary, limits.minShownSamples);
  return [...sparse, ...Object.entries(limits.metrics).flatMap(([path, { min, max }]) => {
    const value = metricOf(derived, path);
    if (typeof value !== 'number' || Number.isNaN(value)) return [`${path}: no value`];
    if (min !== undefined && value < min) return [`${path}: ${value.toFixed(4)} is below ${min}`];
    if (max !== undefined && value > max) return [`${path}: ${value.toFixed(4)} is above ${max}`];
    return [];
  })];
};
