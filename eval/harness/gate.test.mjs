import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bridgeOffsetOverInterocular, coreGatedShare, gateProblems, meanConditionGatedShare } from './gate.mjs';

const limits = {
  metrics: {
    'roll.renderedPerFaceDeg': { min: 0.9, max: 1.1 },
    'registration.gainX': { min: 0.9, max: 1.1 },
    'derived.meanConditionGatedShare': { max: 0.4 },
    'derived.coreGatedShare': { max: 0.02 },
    'derived.bridgeOffsetOverInterocular': { max: 0.1 },
  },
};

const healthy = {
  roll: { renderedPerFaceDeg: 0.99 },
  registration: { gainX: 0.996, interocularPx: 200, offsetPxByCondition: { still: [1, -10], dx160: [-2, -9] } },
  solver: {
    gatedShare: 0,
    byCondition: { still: { samples: 100, gated: 0 }, dx160: { samples: 100, gated: 0 }, 'zoom1.33': { samples: 100, gated: 100 } },
  },
};

test('a run inside every limit passes', () => {
  assert.deepEqual(gateProblems(healthy, limits), []);
});

test('a roll that the overlay mirrors fails: a slope of -1 is far outside 0.9 to 1.1', () => {
  const mirrored = { ...healthy, roll: { renderedPerFaceDeg: -1 } };
  assert.deepEqual(gateProblems(mirrored, limits), ['roll.renderedPerFaceDeg: -1.0000 is below 0.9']);
});

test('a gain, a gated share and a bridge offset past their limits each fail', () => {
  const broken = {
    ...healthy,
    registration: { ...healthy.registration, gainX: 0.5, offsetPxByCondition: { still: [30, 0] } },
    solver: { gatedShare: 0.9, byCondition: { still: { samples: 100, gated: 90 }, dx160: { samples: 100, gated: 90 } } },
  };
  assert.deepEqual(gateProblems(broken, limits), [
    'registration.gainX: 0.5000 is below 0.9',
    'derived.meanConditionGatedShare: 0.9000 is above 0.4',
    'derived.coreGatedShare: 0.9000 is above 0.02',
    'derived.bridgeOffsetOverInterocular: 0.1500 is above 0.1',
  ]);
});

test('the core share leaves out conditions the stand-in always gates', () => {
  assert.equal(coreGatedShare(healthy.solver), 0);
  assert.equal(coreGatedShare({ byCondition: {} }), null);
});

test('the mean over conditions does not depend on how many samples each one has', () => {
  const slow = { byCondition: { still: { samples: 5, gated: 0 }, dy120: { samples: 5, gated: 5 }, zoom: { samples: 5, gated: 0 } } };
  const fast = { byCondition: { still: { samples: 300, gated: 0 }, dy120: { samples: 5, gated: 5 }, zoom: { samples: 300, gated: 0 } } };
  assert.equal(meanConditionGatedShare(slow), meanConditionGatedShare(fast));
  assert.equal(meanConditionGatedShare({ byCondition: {} }), null);
});

test('a metric the run did not produce is a failure, not a pass', () => {
  assert.deepEqual(gateProblems({ ...healthy, roll: null }, limits), ['roll.renderedPerFaceDeg: no value']);
  assert.equal(bridgeOffsetOverInterocular(null), null);
});
