// Measurement hook for eval/harness. The harness defines window.__facefitProbe
// before the app loads; in normal use every call is a no-op.
export type ProbeEvent = { stage: string } & Record<string, unknown>;

declare global {
  interface Window {
    __facefitProbe?: (event: ProbeEvent) => void;
  }
}

const sink = () => (typeof window === 'undefined' ? undefined : window.__facefitProbe);

export const probeEnabled = (): boolean => typeof sink() === 'function';

export const probe = (event: ProbeEvent): void => {
  const record = sink();
  if (typeof record === 'function') record(event);
};
