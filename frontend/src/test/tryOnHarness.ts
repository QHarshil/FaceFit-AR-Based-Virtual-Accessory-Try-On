// Runs the try-on machine with controllable product and photo loads, a
// recorded telemetry action and camera and perception actors that record the
// commands they receive.
import type { Product, TelemetryEvent } from '@facefit/contracts';
import { createActor, fromCallback, fromPromise, type AnyTransitionDefinition } from 'xstate';
import {
  tryOnMachine,
  type PauseCommand,
  type PhotoDetection,
  type TryOnEvent,
} from '../tryon/machine';
import { PRODUCTS } from './fixtures';

export const PRODUCT = PRODUCTS[0] as Product;

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

export const startTryOn = (onTransition: (t: AnyTransitionDefinition) => void = () => {}) => {
  const loads: Deferred<Product>[] = [];
  const detections: Deferred<PhotoDetection>[] = [];
  const reported: TelemetryEvent[] = [];
  const commands: string[] = [];
  const commandSink = (name: string) =>
    fromCallback<PauseCommand>(({ receive }) => {
      receive((command) => commands.push(`${name} ${command.type}`));
      return () => {};
    });
  const machine = tryOnMachine.provide({
    actors: {
      loadProduct: fromPromise(() => {
        const load = deferred<Product>();
        loads.push(load);
        return load.promise;
      }),
      detectPhoto: fromPromise(() => {
        const detection = deferred<PhotoDetection>();
        detections.push(detection);
        return detection.promise;
      }),
      camera: commandSink('camera'),
      perception: commandSink('perception'),
    },
    actions: { report: (_, event) => reported.push(event) },
  });
  const actor = createActor(machine, {
    input: { productId: PRODUCT.id },
    inspect: (inspection) => {
      if (inspection.type === '@xstate.microstep' && inspection.actorRef === actor) {
        inspection._transitions.forEach(onTransition);
      }
    },
  });
  actor.start();
  const send = (event: TryOnEvent) => actor.send(event);
  return { actor, send, loads, detections, reported, commands };
};

export type TryOnRun = ReturnType<typeof startTryOn>;

export const latest = <T>(list: T[]): T => {
  const item = list[list.length - 1];
  if (!item) throw new Error('nothing pending');
  return item;
};
