import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderedScenes: THREE.Scene[] = [];
const loadCallbacks: ((gltf: { scene: THREE.Object3D }) => void)[] = [];

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setSize() {}
    setClearColor() {}
    render(scene: THREE.Scene) {
      renderedScenes.push(scene);
    }
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_path: string, onLoad: (gltf: { scene: THREE.Object3D }) => void) {
      loadCallbacks.push(onLoad);
    }
  },
}));

const { default: ARTryOn } = await import('../ARTryOn');

const lightsIn = (scene: THREE.Scene) =>
  scene.children.filter((child) => child instanceof THREE.Light);

describe('ARTryOn under StrictMode', () => {
  beforeEach(() => {
    renderedScenes.length = 0;
    loadCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('keeps one ambient and one directional light in the scene that renders', () => {
    const { unmount } = render(
      <StrictMode>
        <ARTryOn modelPath="/models/glasses1.glb" type="glasses" />
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
        <ARTryOn modelPath="/models/glasses1.glb" type="glasses" />
      </StrictMode>,
    );
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    unmount();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('ignores a model that finishes loading after cleanup', () => {
    render(
      <StrictMode>
        <ARTryOn modelPath="/models/glasses1.glb" type="glasses" />
      </StrictMode>,
    );
    expect(loadCallbacks).toHaveLength(2);

    const staleModel = new THREE.Group();
    loadCallbacks[0]?.({ scene: staleModel });

    const staleScene = renderedScenes[0] as THREE.Scene;
    expect(staleScene.children.some((child) => child.children.includes(staleModel))).toBe(false);
  });
});
