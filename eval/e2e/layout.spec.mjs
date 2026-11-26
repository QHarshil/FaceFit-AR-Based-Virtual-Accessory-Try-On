// Where the glasses land on screen away from the 1280x720, DPR 1 viewport the
// harness measures. The page shows the 1280x720 camera frame under
// `object-fit: cover` and a mirror, so a narrower or shorter viewport crops
// the frame and the crop offset moves every point. The harness cannot see a
// wrong offset: at 1280x720 the crop is the identity.
//
// Four checks per viewport, on the stand-in face:
//  1. the video and the canvas compute the same `object-fit: cover`, mirror and
//     `object-position`, read from the page at check time and again after the
//     screenshots;
//  2. the bridge point the app reports drawing, against the face's bridge
//     landmark mapped through a transform this test builds from that computed
//     CSS, so a CSS change moves the expected point;
//  3. the glasses as pixels: the box around what the overlay adds to a
//     screenshot, against the same landmark;
//  4. the glasses' left and right edges against the interocular distance.
//
// Tolerance: TOLERANCE_IOD of the interocular distance on screen. The
// rendered bridge anchor is not on landmark 168 even where the crop is the
// identity: the `chromium-desktop` run of this test (1280x720, DPR 1) puts it
// 11.0 px above, 0.053 of the 209 px interocular distance, and the harness
// found the same 0.053 on the recordings (9.6 px of 180 px, eval/results.json
// run `state-machine`, summary.registration.offsetPxByCondition). The phone
// runs measure 0.053 and 0.061 of theirs. The tolerance is 0.1, about 1.6
// times the largest. A missing crop offset moves the point by 555 px in the
// portrait phone and 43 px in the landscape one, 0.8 of its interocular
// distance and more.
import { PRODUCTS, assertStayedOnDevice, countEvents, expect, status, test } from './support.mjs';

const TOLERANCE_IOD = 0.1;
// The landmarks the probe reports, in order (frontend/src/rendering/overlayProbe.ts).
const PROBE_LANDMARKS = [1, 10, 33, 133, 145, 159, 168, 234, 263, 362, 374, 386, 454];
const HALF_FRAME_IOD = [0.8, 0.95];
const NOSE_BRIDGE = 168;
const EYE_OUTER = [33, 263];

// `position` is the computed `object-position` as [x, y] in CSS pixels or
// percent, so the expected point follows the CSS the page has at check time.
const offsetOf = ({ value, unit }, free) => (unit === '%' ? (free * value) / 100 : value);

const mapThroughCover = ([u, v], [videoW, videoH], [viewW, viewH], position) => {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const x = u * videoW * scale + offsetOf(position[0], viewW - videoW * scale);
  const y = v * videoH * scale + offsetOf(position[1], viewH - videoH * scale);
  // The video and the canvas are mirrored, so screen x runs the other way.
  return [viewW - x, y];
};

// Probe NDC is of the unmirrored page; the screen shows it mirrored.
const ndcToScreen = ([x, y], [viewW, viewH]) => [viewW - ((x + 1) / 2) * viewW, ((1 - y) / 2) * viewH];

const parsePosition = (text) =>
  text.split(' ').map((part) => ({ value: Number.parseFloat(part), unit: part.endsWith('%') ? '%' : 'px' }));

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Bounding box of the pixels two screenshots of the page differ in, in CSS pixels.
const changedBox = async (context, before, after, dpr) => {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      async ([a, b, ratio]) => {
        const read = async (base64) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context2d = canvas.getContext('2d');
          context2d.drawImage(bitmap, 0, 0);
          return context2d.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const [one, two] = [await read(a), await read(b)];
        let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let y = 0; y < one.height; y += 1) {
          for (let x = 0; x < one.width; x += 1) {
            const i = (y * one.width + x) * 4;
            const delta = Math.max(
              Math.abs(one.data[i] - two.data[i]),
              Math.abs(one.data[i + 1] - two.data[i + 1]),
              Math.abs(one.data[i + 2] - two.data[i + 2]),
            );
            if (delta > 48) {
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
          }
        }
        return { minX: minX / ratio, maxX: maxX / ratio, minY: minY / ratio, maxY: maxY / ratio };
      },
      [before.toString('base64'), after.toString('base64'), dpr],
    );
  } finally {
    await page.close();
  }
};

const readLooks = (page) =>
  page.evaluate(() => {
    const look = (element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return { fit: style.objectFit, position: style.objectPosition, transform: style.transform, box: [box.left, box.top, box.width, box.height] };
    };
    return { video: look(document.querySelector('video')), canvas: look(document.querySelector('canvas.overlay-canvas')) };
  });

// The CSS the projection assumes. The canvas has to compute the video's fit and
// position, or the glasses are laid out differently from the face under them.
const expectCoverLayout = ({ video, canvas }, view, when) => {
  for (const [name, look] of [['video', video], ['canvas', canvas]]) {
    expect(look.fit, `${name} object-fit ${when}`).toBe('cover');
    expect(look.transform, `${name} transform ${when}`).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    expect(look.box, `${name} box ${when}`).toEqual([0, 0, view[0], view[1]]);
  }
  expect(canvas.position, `canvas object-position against the video's ${when}`).toBe(video.position);
};

test('the rendered frame lands on the face under the cover crop and mirror', async ({ app }, testInfo) => {
  const { page, context } = app;
  await page.goto(`/try-on/${PRODUCTS[0].id}`);
  await status(page, 'tracking');
  await page.waitForTimeout(1_500);
  await assertStayedOnDevice(app);

  const frame = await page.evaluate(() => {
    const trusted = window.__events.filter((e) => e.stage === 'glassesPose' && !e.gated && e.landmarks && e.centerNdc === undefined && e.smoothedNdc);
    const rendered = window.__events.filter((e) => e.stage === 'renderedPose');
    const video = document.querySelector('video');
    return {
      pose: trusted.at(-1),
      rendered: rendered.at(-1),
      video: [video.videoWidth, video.videoHeight],
      view: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
    };
  });
  expect(frame.pose, 'a trusted pose').toBeTruthy();
  expect(frame.rendered, 'a rendered pose').toBeTruthy();
  const { view, dpr } = frame;
  testInfo.annotations.push({ type: 'viewport', description: `${view.join('x')} at DPR ${dpr}, camera ${frame.video.join('x')}` });

  // 1. The CSS the projection assumes, and the mapping built from it.
  const looks = await readLooks(page);
  expectCoverLayout(looks, view, 'before the check');
  const position = parsePosition(looks.video.position);

  const onScreen = (landmark) =>
    mapThroughCover(frame.pose.landmarks[PROBE_LANDMARKS.indexOf(landmark)], frame.video, view, position);
  const bridge = onScreen(NOSE_BRIDGE);
  const interocular = distance(...EYE_OUTER.map(onScreen));
  const tolerance = TOLERANCE_IOD * interocular;
  testInfo.annotations.push({ type: 'interocular', description: `${interocular.toFixed(1)} px on screen, tolerance ${tolerance.toFixed(1)} px` });

  // 2. The probe's rendered bridge point.
  const drawn = ndcToScreen(frame.rendered.centerNdc, view);
  expect(distance(drawn, bridge), `rendered bridge ${drawn} against landmark ${bridge}`).toBeLessThan(tolerance);

  // 3. The pixels the overlay adds. A software-rendered canvas can miss a
  // frame, so a screenshot is retaken after the next render until the
  // overlay shows in it.
  await page.evaluate(() => {
    document.querySelector('canvas.overlay-canvas').style.visibility = 'hidden';
  });
  await page.waitForTimeout(100);
  const before = await page.screenshot();
  await page.evaluate(() => {
    document.querySelector('canvas.overlay-canvas').style.visibility = 'visible';
  });
  let box = { minX: Infinity };
  for (let attempt = 0; attempt < 8 && !Number.isFinite(box.minX); attempt += 1) {
    const renders = await countEvents(page, 'renderedPose');
    await page.waitForFunction((count) => window.__events.filter((e) => e.stage === 'renderedPose').length > count, renders, { timeout: 10_000 });
    box = await changedBox(context, before, await page.screenshot(), dpr);
  }
  // The layout is read again after the screenshots, so a style set once the
  // first read is done still fails.
  expectCoverLayout(await readLooks(page), view, 'after the screenshots');
  expect(Number.isFinite(box.minX), 'the overlay changed no pixels').toBe(true);
  const middleX = (box.minX + box.maxX) / 2;
  expect(Math.abs(middleX - bridge[0]), `glasses span x ${box.minX}..${box.maxX}, bridge at ${bridge[0]}`).toBeLessThan(tolerance);
  expect(box.minY - tolerance, `glasses start at y ${box.minY}`).toBeLessThan(bridge[1]);
  expect(box.maxY + tolerance, `glasses end at y ${box.maxY}`).toBeGreaterThan(bridge[1]);

  // The glasses' width follows the face's scale: half the frame is 0.8 to 0.95
  // of the interocular distance on either side of the bridge. The 1280x720 run
  // measures 1.743 of it (364.0 px of 208.9), the landscape run 1.754. The
  // phone viewport clips the frame at the screen edge (389.7 of 390 px), so
  // each edge is held to the band the clip leaves, which fails when the face
  // is off by more than the tolerance in x.
  const clip = (x) => Math.min(Math.max(x, 0), view[0]);
  const [leftLow, leftHigh] = [clip(bridge[0] - HALF_FRAME_IOD[1] * interocular), clip(bridge[0] - HALF_FRAME_IOD[0] * interocular)];
  const [rightLow, rightHigh] = [clip(bridge[0] + HALF_FRAME_IOD[0] * interocular), clip(bridge[0] + HALF_FRAME_IOD[1] * interocular)];
  expect(box.minX, `glasses left edge ${box.minX} outside ${leftLow}..${leftHigh}`).toBeGreaterThan(leftLow - tolerance);
  expect(box.minX, `glasses left edge ${box.minX} outside ${leftLow}..${leftHigh}`).toBeLessThan(leftHigh + tolerance);
  expect(box.maxX, `glasses right edge ${box.maxX} outside ${rightLow}..${rightHigh}`).toBeGreaterThan(rightLow - tolerance);
  expect(box.maxX, `glasses right edge ${box.maxX} outside ${rightLow}..${rightHigh}`).toBeLessThan(rightHigh + tolerance);
  testInfo.annotations.push({ type: 'glasses', description: `${(box.maxX - box.minX).toFixed(1)} px wide at ${box.minX.toFixed(1)}..${box.maxX.toFixed(1)}` });
});
