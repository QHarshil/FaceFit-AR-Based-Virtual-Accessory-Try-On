/** Which temporal filter smooths the head pose; `off` renders each solved pose as is. */
export const POSE_FILTER_SETTINGS = ['off', 'one-euro', 'kalman'] as const;

export type PoseFilterSetting = (typeof POSE_FILTER_SETTINGS)[number];

/**
 * The sweep's rule picked the Kalman filter, but live it drew more position
 * jitter than no filter and overshot steps by 37% (docs/pose-filter.md).
 */
export const DEFAULT_POSE_FILTER: PoseFilterSetting = 'one-euro';

const isPoseFilterSetting = (value: string): value is PoseFilterSetting =>
  (POSE_FILTER_SETTINGS as readonly string[]).includes(value);

/**
 * Reads VITE_POSE_FILTER. Unset or empty selects the default. Anything else
 * outside POSE_FILTER_SETTINGS throws, and vite.config.ts calls this, so a
 * value such as `Off` or `false` fails the build instead of shipping the
 * default filter.
 */
export const parsePoseFilterSetting = (value: string | undefined): PoseFilterSetting => {
  if (value === undefined || value === '') return DEFAULT_POSE_FILTER;
  if (isPoseFilterSetting(value)) return value;
  throw new Error(
    `VITE_POSE_FILTER must be unset or one of ${POSE_FILTER_SETTINGS.join(', ')}; got "${value}"`,
  );
};
