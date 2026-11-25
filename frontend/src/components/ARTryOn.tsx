import { useEffect, useRef } from 'react';
import { probeGlassesPose, probeRenderedPose } from '../rendering/overlayProbe';
import { createStage, fitToVideo, placeGlasses, resizeRenderer } from '../rendering/overlayStage';
import type { PoseStream } from '../tracking/poseStream';
import type { TryOnEvent } from '../tryon/machine';
import type { ProductAnchors } from '../types';
import { probe, probeEnabled } from '../utils/probe';

/** What the overlay reports to the try-on statechart. */
export type OverlayEvent = Extract<
  TryOnEvent,
  {
    type:
      | 'MODEL_LOADED'
      | 'MODEL_FAILED'
      | 'WEBGL_UNAVAILABLE'
      | 'CONTEXT_LOST'
      | 'CONTEXT_RESTORED'
      | 'RENDER_CRASHED';
  }
>;

interface ARTryOnProps {
  modelPath: string;
  anchors: ProductAnchors;
  poseStream: PoseStream;
  onEvent?: (event: OverlayEvent) => void;
}

/**
 * Draws the glasses over the video. The render loop reads the pose stream
 * directly each animation frame, so pose updates never re-render React.
 */
function ARTryOn({ modelPath, anchors, poseStream, onEvent }: ARTryOnProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Read inside the scene effect, so a new callback or a new product's
  // anchors do not rebuild the scene.
  const onEventRef = useRef(onEvent);
  const anchorsRef = useRef(anchors);
  useEffect(() => {
    onEventRef.current = onEvent;
    anchorsRef.current = anchors;
  }, [onEvent, anchors]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const report = (event: OverlayEvent) => onEventRef.current?.(event);

    let created: ReturnType<typeof createStage>;
    try {
      created = createStage(container, modelPath, {
        onModelLoaded: () => report({ type: 'MODEL_LOADED' }),
        onModelFailed: (error) => {
          console.error('Error loading model:', error);
          report({ type: 'MODEL_FAILED' });
        },
        onContextLost: () => report({ type: 'CONTEXT_LOST' }),
        onContextRestored: () => report({ type: 'CONTEXT_RESTORED' }),
      });
    } catch (error) {
      // Three.js throws when no WebGL context can be created.
      console.error('WebGL unavailable:', error);
      report({ type: 'WEBGL_UNAVAILABLE' });
      return;
    }
    const { stage, dispose } = created;
    let animationFrameId = 0;

    const stopUpdates = poseStream.onUpdate(({ frame, estimate, filtered }) => {
      if (estimate.intrinsics) fitToVideo(stage, estimate.intrinsics);
      const glasses = stage.glasses;
      if (!glasses) return;
      glasses.visible = estimate.trusted && stage.intrinsics !== null;
      if (probeEnabled()) {
        probeGlassesPose(stage, frame, estimate, filtered, anchorsRef.current, poseStream.setting);
      }
    });

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const renderStart = performance.now();
      try {
        const placed = placeGlasses(stage, poseStream, anchorsRef.current);
        stage.renderer.render(stage.scene, stage.camera);
        probe({ stage: 'render', start: renderStart, end: performance.now() });
        if (placed && probeEnabled()) {
          probeRenderedPose(stage, placed, renderStart, anchorsRef.current);
        }
      } catch (error) {
        // Outside React, so no error boundary sees it.
        cancelAnimationFrame(animationFrameId);
        console.error('Render error:', error);
        report({ type: 'RENDER_CRASHED' });
      }
    };
    animate();

    // The page size changes the pixel ratio the buffer needs.
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            resizeRenderer(stage);
          });
    resizeObserver?.observe(container);

    return () => {
      stopUpdates();
      resizeObserver?.disconnect();
      cancelAnimationFrame(animationFrameId);
      dispose();
    };
  }, [modelPath, poseStream]);

  return <div ref={containerRef} className="overlay-container" aria-hidden="true" />;
}

export default ARTryOn;
