import { estimateIntrinsics, projectionMatrixFromIntrinsics, type HeadPose } from '@facefit/cv';
import { act, render } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
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
import type { ARTryOnHandle } from '../../types';

const renderedScenes: THREE.Scene[] = [];
const renderedCameras: THREE.Camera[] = [];
const canvasSizes: [number, number, boolean | undefined][] = [];
const drawingBuffers: [number, number][] = [];
const loadCallbacks: ((gltf: { scene: THREE.Object3D }) => void)[] = [];

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
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
    load(_path: string, onLoad: (gltf: { scene: THREE.Object3D }) => void) {
      loadCallbacks.push(onLoad);
    }
  },
}));

const { default: ARTryOn } = await import('../ARTryOn');

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
};

/** Mounts the overlay, loads a model, and returns the handle and the glasses group. */
const mountWithModel = () => {
  const handle = createRef<ARTryOnHandle>();
  const view = render(
    <StrictMode>
      <ARTryOn ref={handle} modelPath="/models/rectangular-acetate.glb" anchors={ANCHORS} />
    </StrictMode>,
  );
  const model = new THREE.Group();
  act(() => loadCallbacks[loadCallbacks.length - 1]?.({ scene: model }));
  const glasses = model.parent;
  if (!glasses || !handle.current) throw new Error('model did not load');
  return { view, handle: handle.current, glasses };
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
        <ARTryOn modelPath="/models/rectangular-acetate.glb" anchors={ANCHORS} />
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
        <ARTryOn modelPath="/models/rectangular-acetate.glb" anchors={ANCHORS} />
      </StrictMode>,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    unmount();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('ignores a model that finishes loading after cleanup', () => {
    render(
      <StrictMode>
        <ARTryOn modelPath="/models/rectangular-acetate.glb" anchors={ANCHORS} />
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
    const { handle, glasses, view } = mountWithModel();
    handle.updateModel(syntheticLandmarkFrame(POSE, intrinsics));

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
    const { handle, glasses, view } = mountWithModel();
    handle.updateModel(syntheticLandmarkFrame(POSE, intrinsics));
    expect(glasses.visible).toBe(true);

    handle.updateModel(NO_FACE);
    expect(glasses.visible).toBe(false);
    view.unmount();
  });

  it('hides the glasses when the reprojection gate closes and shows them when it reopens', () => {
    const { handle, glasses, view } = mountWithModel();
    handle.updateModel(syntheticLandmarkFrame(POSE, intrinsics));
    expect(glasses.visible).toBe(true);

    // 20 px of landmark noise puts the reprojection RMS far past the gate.
    handle.updateModel(
      syntheticLandmarkFrame(POSE, intrinsics, { sigmaPx: 20, gaussian: seededGaussian(3) }),
    );
    expect(glasses.visible).toBe(false);

    handle.updateModel(syntheticLandmarkFrame(POSE, intrinsics));
    expect(glasses.visible).toBe(true);
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
    const { handle, view } = mountWithModel();
    handle.updateModel(syntheticLandmarkFrame(POSE, intrinsics));
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
