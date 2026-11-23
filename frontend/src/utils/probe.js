// Measurement hook for eval/harness. The harness defines window.__facefitProbe
// before the app loads; in normal use every call is a no-op.
const sink = () => (typeof window === 'undefined' ? undefined : window.__facefitProbe);

export const probeEnabled = () => typeof sink() === 'function';

export const probe = (event) => {
  const record = sink();
  if (typeof record === 'function') record(event);
};
