// Registration gate for CI: pass/fail limits on the geometry metrics of a
// stand-in run, checked against `gate.json`. Timing metrics are not gated,
// because runner hardware changes them without a code change.

const metricOf = (summary, path) => path.split('.').reduce((value, key) => (value == null ? value : value[key]), summary);

/** Largest bridge offset across the translate conditions, in interocular distances. */
export const bridgeOffsetOverInterocular = (registration) => {
  if (!registration?.offsetPxByCondition) return null;
  const offsets = Object.values(registration.offsetPxByCondition).map(([x, y]) => Math.hypot(x, y));
  return Math.max(...offsets) / registration.interocularPx;
};

/**
 * Gated share over the conditions that stay inside the frame at full size
 * (still, roll, dx). The stand-in's zoom 1.33 and dy conditions are gated by
 * the solver at every sample, so the share over all conditions is not zero;
 * this one is.
 */
export const coreGatedShare = (solver) => {
  const core = Object.entries(solver?.byCondition ?? {}).filter(([id]) => /^(still|roll|dx)/.test(id));
  const samples = core.reduce((sum, [, condition]) => sum + condition.samples, 0);
  return samples ? core.reduce((sum, [, condition]) => sum + condition.gated, 0) / samples : null;
};

/** One line per metric outside its `min` or `max`, or missing. */
export const gateProblems = (summary, limits) => {
  const derived = {
    ...summary,
    derived: {
      bridgeOffsetOverInterocular: bridgeOffsetOverInterocular(summary.registration),
      coreGatedShare: coreGatedShare(summary.solver),
    },
  };
  return Object.entries(limits.metrics).flatMap(([path, { min, max }]) => {
    const value = metricOf(derived, path);
    if (typeof value !== 'number' || Number.isNaN(value)) return [`${path}: no value`];
    if (min !== undefined && value < min) return [`${path}: ${value.toFixed(4)} is below ${min}`];
    if (max !== undefined && value > max) return [`${path}: ${value.toFixed(4)} is above ${max}`];
    return [];
  });
};
