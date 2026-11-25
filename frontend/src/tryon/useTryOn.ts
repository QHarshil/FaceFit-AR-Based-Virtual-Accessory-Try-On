import { useActorRef, useSelector } from '@xstate/react';
import { useState, useSyncExternalStore, type RefObject } from 'react';
import { createPoseStream } from '../tracking/poseStream';
import { createTryOnActors, type TryOnDeps } from './actors';
import { tryOnMachine } from './machine';
import { sourceOf, statusOf, withPose } from './status';

const poseShownOf = (stream: ReturnType<typeof createPoseStream>) => () =>
  stream.getSnapshot().poseShown;

/**
 * Runs the try-on statechart for one product. React re-renders when the
 * selected machine state changes or the pose stream's coarse snapshot does,
 * never per frame.
 */
export const useTryOn = (
  productId: number | null,
  videoRef: RefObject<HTMLVideoElement | null>,
  deps: Partial<Pick<TryOnDeps, 'getProduct'>> = {},
) => {
  const [poseStream] = useState(() => createPoseStream());
  const [machine] = useState(() =>
    tryOnMachine.provide({
      actors: createTryOnActors({ ...deps, video: videoRef, poseStream }),
    }),
  );
  const actor = useActorRef(machine, { input: { productId } });
  const machineStatus = useSelector(actor, statusOf);
  const poseShown = useSyncExternalStore(poseStream.subscribe, poseShownOf(poseStream));
  return {
    actor,
    poseStream,
    status: withPose(machineStatus, poseShown),
    product: useSelector(actor, (snapshot) => snapshot.context.product),
    overlayAttempt: useSelector(actor, (snapshot) => snapshot.context.overlayAttempt),
    source: useSelector(actor, sourceOf),
    photo: useSelector(actor, (snapshot) => snapshot.context.photo),
  };
};
