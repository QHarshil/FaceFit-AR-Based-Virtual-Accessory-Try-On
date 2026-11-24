// Renders the pose-benchmark entry of eval/results.json as the Markdown that
// docs/pose-benchmark.md carries, so the doc can be checked against the artifact.

const METHOD_LABELS = {
  heuristic: 'Eye-line heuristic (old app pose)',
  mediapipeMatrix: 'MediaPipe transformation matrix',
  solveHeadPose: 'solveHeadPose',
};

const deg = (v) => (v == null ? 'n/a' : v.toFixed(2));
const percent = (v) => (v == null ? 'n/a' : `${(100 * v).toFixed(1)}%`);

export function renderPoseTable(entry) {
  const { counts, fovAssumption, methods, sensitivity, hardware } = entry;
  const lines = [
    `AFLW2000-3D, ${counts.evaluated} of ${counts.images} images evaluated: ${counts.beyondProtocolLimit} excluded for a label beyond 99 deg, ${counts.noFaceInProtocol} for no detected face, ${counts.inProtocol - counts.noFaceInProtocol - counts.evaluated} for a failed pose. solveHeadPose assumes a ${fovAssumption.degrees} deg FOV. Commit \`${entry.commit.slice(0, 9)}\`, ${hardware.cpu}.`,
    '',
    '| Method | Yaw MAE (deg) | Pitch MAE (deg) | Roll MAE (deg) | Mean MAE (deg) | Geodesic median (deg) | Within 5 / 10 / 15 deg |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const [key, label] of Object.entries(METHOD_LABELS)) {
    const m = methods[key];
    const within = m.shareWithinGeodesicDeg;
    lines.push(`| ${label} | ${deg(m.maeDeg.yaw)} | ${deg(m.maeDeg.pitch)} | ${deg(m.maeDeg.roll)} | ${deg(m.maeDeg.mean)} | ${deg(m.geodesicDeg.median)} | ${percent(within[5])} / ${percent(within[10])} / ${percent(within[15])} |`);
  }
  const fovs = Object.keys(sensitivity.solveHeadPoseByFovDeg).sort((a, b) => Number(a) - Number(b));
  const row = (label, value) => `| ${label} | ${fovs.map((f) => value(sensitivity.solveHeadPoseByFovDeg[f])).join(' | ')} |`;
  lines.push(
    '',
    `| solveHeadPose FOV (deg) | ${fovs.join(' | ')} |`,
    `|---|${fovs.map(() => '---').join('|')}|`,
    row('Mean MAE (deg)', (s) => deg(s.maeDeg.mean)),
    row('Geodesic median (deg)', (s) => deg(s.geodesicMedianDeg)),
    row('Failed solves', (s) => String(s.failures)),
  );
  return lines.join('\n');
}

const signed = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`);
const corr = (v) => (v == null ? 'n/a' : v.toFixed(2));

/** The near-frontal sign checks: labels against the dataset's fitted landmarks, then each method against the labels. */
export function renderConventionCheck(entry) {
  const { nearFrontalLimitDeg, labelGeometry, methods } = entry.conventionCheck;
  const label = (measure, axis, check) => `| ${measure} | ${axis} | ${check.expectedSign > 0 ? '+' : '-'} | ${corr(check.correlation)} |`;
  const lines = [
    `Labels within ${nearFrontalLimitDeg} deg on every axis. Labels against the dataset's fitted landmarks (\`pt3d_68\`), n = ${labelGeometry.n}:`,
    '',
    '| Landmark measure | Label | Expected sign | Correlation |',
    '|---|---|---|---|',
    label('Eye-line angle, image y down', 'roll', labelGeometry.rollVsEyeLineAngle),
    label('Nose tip right of the eye midpoint, over eye distance', 'yaw', labelGeometry.yawVsNoseOffset),
    label('Nose tip below the eyes, over eye-to-mouth distance', 'pitch', labelGeometry.pitchVsNoseHeight),
    '',
    `Each method against the labels, n = ${methods.n}: correlation, then mean signed error in degrees.`,
    '',
    '| Method | Pitch | Yaw | Roll |',
    '|---|---|---|---|',
  ];
  for (const [key, name] of Object.entries(METHOD_LABELS)) {
    const cells = ['pitch', 'yaw', 'roll'].map((axis) => `${corr(methods[key][axis].correlation)} (${signed(methods[key][axis].meanSignedErrorDeg)})`);
    lines.push(`| ${name} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}
