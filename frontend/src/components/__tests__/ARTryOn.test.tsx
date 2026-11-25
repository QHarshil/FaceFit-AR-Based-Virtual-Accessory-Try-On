import {
  DEFAULT_MAX_GAP_MS,
  DEFAULT_MAX_STALE_MS,
  estimateIntrinsics,
  IDENTITY3,
  projectionMatrixFromIntrinsics,
  type HeadPose,
} from '@facefit/cv';
import { act, render } from '@testing-library/react';
import { StrictMode } from 'react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { glassesTransform, transformPoint } from '../../geometry/glassesPlacement';
import { DEFAULT_HORIZONTAL_FOV_DEG } from '../../geometry/headPose';
import { eyeToVideoPixel } from '../../rendering/glassesCamera';
import type { LandmarkFrame } from '../../perception/types';
import { ANCHORS } from '../../test/fixtures';
import {
  rotationFromDegrees,
  seededGaussian,
  syntheticLandmarkFrame,
} from '../../test/syntheticFace';
import { createPoseStream } from '../../tracking/poseStream';

const renderedScenes: THREE.Scene[] = [];
const renderedCameras: THREE.Camera[] = [];
const canvasSizes: [number, number, boolean | undefined][] = [];
const drawingBuffers: [number, number][] = [];
const loadCallbacks: ((gltf: { scene: THREE.Object3D }) => void)[] = [];
const errorCallbacks: ((error: unknown) => void)[] = [];
const gpu = vi.hoisted(() => ({ webgl: true, renderThrows: false }));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    constructor() {
      if (!gpu.webgl) throw new Error('Error creating WebGL context.');
    }
    domElement = document.createElement('canvas');
    pixelRatio = 1;
    setPixelRatio(ratio: number) {
      this.pixelRatio = ratio;
    }
    setSize(width: number, height: number, updateStyle?: boolean) {
      canvasSizes.push([width, height, updateStyle]);
      drawingBuffers.push([width * this.pixelRatio, height * this.pixelRatio]);
    }
    setClearColor() {}
    render(scene: THREE.Scene, camera: THREE.Camera) {
      if (gpu.renderThrows) throw new Error('GL_INVALID_OPERATION');
      renderedScenes.push(scene);
      renderedCameras.push(camera);
    }
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {}
    load(
      _path: string,
      onLoad: (gltf: { scene: THREE.Object3D }) => void,
      _onProgress: unknown,
      onError: (error: unknown) => void,
    ) {
      loadCallbacks.push(onLoad);
      errorCallbacks.push(onError);
    }
  },
}));

const { default: ARTryOn } = await import('../ARTryOn');
type OverlayEvent = import('../ARTryOn').OverlayEvent;

const lightsIn = (scene: THREE.Scene) =>
  scene.children.filter((child) => child instanceof THREE.Light);

const intrinsics = estimateIntrinsics({
  width: 1280,
  height: 720,
  horizontalFovDeg: DEFAULT_HORIZONTAL_FOV_DEG,
})!;
const POSE: HeadPose = { rotation: rotationFromDegrees(-4, 12, 6), translationMm: [20, -10, 600] };
const NO_FACE: LandmarkFrame = {
  timestampMs: 0,
  width: 1280,
  height: 720,
  landmarks: new Float32Array(0),
  faceCount: 0,
  trackId: null,
};

/** Mounts the overlay, loads a model, and returns its pose stream and the glasses group. */
const mountWithModel = () => {
  const stream = createPoseStream();
  const view = render(
    <StrictMode>
      <ARTryOn modelPath="/models/rectangular-acetate.glb" anchors={ANCHORS} poseStream={stream} />
    </StrictMode>,
  );
  const model = new THREE.Group();
  act(() => loadCallbacks[loadCallbacks.length - 1]?.({ scene: model }));
  const glasses = model.parent;
  if (!glasses) throw new Error('model did not load');
  return { view, stream, glasses };
};

describe('ARTryOn under StrictMode', () => {
  beforeEach(() => {
    renderedScenes.length = 0;
    renderedCameras.length = 0;
    canvasSizes.length = 0;
    drawingBuffers.length = 0;
    loadCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('keeps one ambient and one directional light in the scene that renders', () => {
    const { unmount } = render(
      <StrictMode>
        <ARTryOn
          modelPath="/models/rectangular-acetate.glb"
          anchors={ANCHORS}
          poseStream={createPoseStream()}
        />
      </StrictMode>,
    );

    const liveScene = renderedScenes[renderedScenes.length - 1];
    expect(liveScene).toBeDefined();
    const lights = lightsIn(liveScene as THREE.Scene);
    expect(lights.filter((light) => light instanceof THREE.AmbientLight)).toHaveLength(1);
    expect(lights.filter((light) => light instanceof THREE.DirectionalLight)).toHaveLength(1);
    unmount();
  });

  it('mounts one canvas and removes it on unmount', () => {
    const { container, unmount } = render(
      <StrictMode>
        <ARTryOn
          modelPath="/models/rectangular-acetate.glb"
          anchors={ANCHORS}
          poseStream={createPoseStream()}
        />
      </StrictMode>,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    unmount();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('ignores a model that finishes loading after cleanup', () => {
    render(
      <StrictMode>
        <ARTryOn
          modelPath="/models/rectangular-acetate.glb"
          anchors={ANCHORS}
          poseStream={createPoseStream()}
        />
      </StrictMode>,
    );
    expect(loadCallbacks).toHaveLength(2);

    const staleModel = new THREE.Group();
    loadCallbacks[0]?.({ scene: staleModel });

    const staleScene = renderedScenes[0] as THREE.Scene;
    expect(staleScene.children.some((child) => child.children.includes(staleModel))).toBe(false);
  });
});

describe('ARTryOn overlay gate', () => {
  beforeEach(() => {
    renderedScenes.length = 0;
    renderedCameras.length = 0;
    canvasSizes.length = 0;
    drawingBuffers.length = 0;
    loadCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('stays hidden until a frame is solved', () => {
    const { glasses, view } = mountWithModel();
    expect(glasses.visible).toBe(false);
    view.unmount();
  });

  it('shows the glasses for a trusted pose and renders at the video size with its intrinsics', () => {
    const { stream, glasses, view } = mountWithModel();
    stream.push(syntheticLandmarkFrame(POSE, intrinsics));

    expect(glasses.visible).toBe(true);
    expect(canvasSizes[canvasSizes.length - 1]).toEqual([1280, 720, false]);
    const camera = renderedCameras[renderedCameras.length - 1] as THREE.Camera;
    const expected = projectionMatrixFromIntrinsics(intrinsics, 10, 10000)!;
    camera.projectionMatrix.elements.forEach((value, i) => {
      expect(value).toBeCloseTo(expected[i] as number, 6);
    });
    view.unmount();
  });

  it('hides the glasses when the face is lost', () => {
    const { stream, glasses, view } = mountWithModel();
    stream.push(syntheticLandmarkFrame(POSE, intrinsics));
    expect(glasses.visible).toBe(true);

    stream.push(NO_FACE);
    expect(glasses.visible).toBe(false);
    view.unmount();
  });

  it('hides the glasses when the reprojection gate closes and shows them when it reopens', () => {
    const { stream, glasses, view } = mountWithModel();
    stream.push(syntheticLandmarkFrame(POSE, intrinsics));
    expect(glasses.visible).toBe(true);

    // 20 px of landmark noise puts the reprojection RMS far past the gate.
    stream.push(
      syntheticLandmarkFrame(POSE, intrinsics, { sigmaPx: 20, gaussian: seededGaussian(3) }),
    );
    expect(glasses.visible).toBe(false);

    stream.push(syntheticLandmarkFrame(POSE, intrinsics));
    expect(glasses.visible).toBe(true);
    view.unmount();
  });
});

describe('ARTryOn render loop', () => {
  const FRAME_MS = 1000 / 30;
  let pending: FrameRequestCallback[] = [];

  beforeEach(() => {
    renderedScenes.length = 0;
    renderedCameras.length = 0;
    canvasSizes.length = 0;
    drawingBuffers.length = 0;
    loadCallbacks.length = 0;
    pending = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.push(callback);
      return pending.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderFrame = () => {
    const due = pending.splice(0);
    act(() => due.forEach((callback) => callback(performance.now())));
  };

  // A face moving 3 mm per frame to the right.
  const frameAt = (k: number): LandmarkFrame => ({
    ...syntheticLandmarkFrame(
      { rotation: POSE.rotation, translationMm: [20 + 3 * k, -10, 600] },
      intrinsics,
    ),
    timestampMs: k * FRAME_MS,
  });

  it('draws the filtered pose, predicted forward once a newer frame is on screen', () => {
    const { stream, glasses, view } = mountWithModel();
    for (let k = 0; k < 30; k++) stream.push(frameAt(k));
    renderFrame();
    const atLastPose = glasses.position.x;

    stream.present(30 * FRAME_MS);
    renderFrame();

    expect(glasses.visible).toBe(true);
    expect(glasses.position.x).toBeGreaterThan(atLastPose);
    view.unmount();
  });

  // Video pixels of the bridge and hinge anchors as the glasses are drawn now.
  const drawnAnchorPixels = (glasses: THREE.Object3D) => {
    const camera = renderedCameras[renderedCameras.length - 1] as THREE.Camera;
    return [ANCHORS.bridgeCenter, ANCHORS.hingeRight, ANCHORS.hingeLeft].map((anchor) =>
      eyeToVideoPixel(
        camera,
        intrinsics,
        new THREE.Vector3(...anchor).applyMatrix4(glasses.matrixWorld).toArray(),
      ),
    );
  };

  const anchorPixelsAt = (pose: HeadPose) => {
    const camera = renderedCameras[renderedCameras.length - 1] as THREE.Camera;
    const transform = glassesTransform(pose, ANCHORS.bridgeCenter);
    return [ANCHORS.bridgeCenter, ANCHORS.hingeRight, ANCHORS.hingeLeft].map((anchor) =>
      eyeToVideoPixel(camera, intrinsics, transformPoint(transform, anchor)),
    );
  };

  it('draws a new tracked face at its own pose on the first render after the change', () => {
    const { stream, glasses, view } = mountWithModel();
    // The user turned 48 degrees; a bystander faces the camera 260 mm to the side.
    const user: HeadPose = { rotation: rotationFromDegrees(0, 48, 0), translationMm: [0, 0, 600] };
    const bystander: HeadPose = { rotation: IDENTITY3, translationMm: [260, 0, 700] };
    for (let k = 0; k < 30; k++) {
      stream.push({
        ...syntheticLandmarkFrame(user, intrinsics),
        timestampMs: k * FRAME_MS,
      });
    }
    renderFrame();

    stream.push({
      ...syntheticLandmarkFrame(bystander, intrinsics),
      timestampMs: 30 * FRAME_MS,
      trackId: 2,
    });
    stream.present(31 * FRAME_MS);
    renderFrame();

    const expected = anchorPixelsAt(bystander);
    drawnAnchorPixels(glasses).forEach(([u, v], i) => {
      const [eu, ev] = expected[i]!;
      expect(Math.hypot(u - eu, v - ev)).toBeLessThan(1);
    });
    view.unmount();
  });

  it('places the glasses for a worker slower than the gap the filter survives', () => {
    const { stream, glasses, view } = mountWithModel();
    stream.push(frameAt(0));
    // The next frame's pose arrives after it, so the frame on screen is always older than the gap.
    stream.present(DEFAULT_MAX_GAP_MS + 100);
    renderFrame();

    const expected = anchorPixelsAt({ rotation: POSE.rotation, translationMm: [20, -10, 600] });
    expect(glasses.visible).toBe(true);
    drawnAnchorPixels(glasses).forEach(([u, v], i) => {
      const [eu, ev] = expected[i]!;
      expect(Math.hypot(u - eu, v - ev)).toBeLessThan(1);
    });
    view.unmount();
  });

  it('hides the glasses once the last pose is past the staleness limit', () => {
    const { stream, glasses, view } = mountWithModel();
    stream.push(frameAt(0));
    stream.present(DEFAULT_MAX_STALE_MS);
    renderFrame();
    expect(glasses.visible).toBe(true);

    stream.present(DEFAULT_MAX_STALE_MS + 1);
    renderFrame();
    expect(glasses.visible).toBe(false);
    // The next trusted pose shows them again.
    stream.push(frameAt(40));
    renderFrame();
    expect(glasses.visible).toBe(true);
    view.unmount();
  });

  it('does not move hidden glasses', () => {
    const { stream, glasses, view } = mountWithModel();
    for (let k = 0; k < 30; k++) stream.push(frameAt(k));
    renderFrame();
    const shownAt = glasses.position.x;

    stream.push(NO_FACE);
    stream.present(30 * FRAME_MS);
    renderFrame();

    expect(glasses.visible).toBe(false);
    expect(glasses.position.x).toBe(shownAt);
    view.unmount();
  });
});

describe('ARTryOn drawing buffer', () => {
  beforeEach(() => {
    renderedCameras.length = 0;
    canvasSizes.length = 0;
    drawingBuffers.length = 0;
    loadCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const showAt = (displayWidth: number, displayHeight: number, devicePixelRatio: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(displayWidth);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(displayHeight);
    vi.stubGlobal('devicePixelRatio', devicePixelRatio);
    const { stream, view } = mountWithModel();
    stream.push(syntheticLandmarkFrame(POSE, intrinsics));
    const camera = renderedCameras[renderedCameras.length - 1] as THREE.Camera;
    const anchorPixel = eyeToVideoPixel(
      camera,
      intrinsics,
      transformPoint(glassesTransform(POSE, ANCHORS.bridgeCenter), ANCHORS.bridgeCenter),
    );
    view.unmount();
    return {
      buffer: drawingBuffers[drawingBuffers.length - 1],
      anchorPixel,
      projection: [...camera.projectionMatrix.elements],
    };
  };

  it('scales with the display size and device pixel ratio and leaves the projection alone', () => {
    const small = showAt(640, 360, 1);
    const large = showAt(1280, 720, 1);
    const dense = showAt(1280, 720, 2);
    const huge = showAt(3840, 2160, 2);

    expect(small.buffer).toEqual([1280, 720]);
    expect(large.buffer).toEqual([1280, 720]);
    expect(dense.buffer).toEqual([2560, 1440]);
    // Capped at 2 for fill cost.
    expect(huge.buffer).toEqual([2560, 1440]);
    expect(showAt(1920, 1080, 1).buffer).toEqual([1920, 1080]);

    for (const other of [large, dense, huge]) {
      expect(other.projection).toEqual(small.projection);
      expect(other.anchorPixel).toEqual(small.anchorPixel);
    }
  });
});

describe('ARTryOn events for the try-on statechart', () => {
  const mount = () => {
    const onEvent = vi.fn<(event: OverlayEvent) => void>();
    const view = render(
      <ARTryOn
        modelPath="/models/rectangular-acetate.glb"
        anchors={ANCHORS}
        poseStream={createPoseStream()}
        onEvent={onEvent}
      />,
    );
    return { view, onEvent };
  };

  beforeEach(() => {
    loadCallbacks.length = 0;
    errorCallbacks.length = 0;
    gpu.webgl = true;
    gpu.renderThrows = false;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a loaded model and a failed one', () => {
    const { onEvent } = mount();
    act(() => loadCallbacks.at(-1)?.({ scene: new THREE.Group() }));
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'MODEL_LOADED' });

    const second = mount();
    act(() => errorCallbacks.at(-1)?.(new Error('404')));
    expect(second.onEvent).toHaveBeenLastCalledWith({ type: 'MODEL_FAILED' });
  });

  it('reports WebGL as unavailable when no context can be created', () => {
    gpu.webgl = false;
    const { onEvent, view } = mount();
    expect(onEvent).toHaveBeenCalledWith({ type: 'WEBGL_UNAVAILABLE' });
    expect(view.container.querySelector('canvas')).toBeNull();
  });

  it('reports a lost and a restored WebGL context', () => {
    const { onEvent, view } = mount();
    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'CONTEXT_LOST' });
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'CONTEXT_RESTORED' });
  });

  it('stops the render loop and reports a render that throws', () => {
    gpu.renderThrows = true;
    const { onEvent } = mount();
    expect(onEvent).toHaveBeenCalledWith({ type: 'RENDER_CRASHED' });
  });

  it('ignores context events after unmount', () => {
    const { onEvent, view } = mount();
    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
    view.unmount();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(onEvent).not.toHaveBeenCalledWith({ type: 'CONTEXT_LOST' });
  });
});
