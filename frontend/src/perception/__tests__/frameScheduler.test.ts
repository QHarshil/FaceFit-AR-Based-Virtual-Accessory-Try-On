import { describe, expect, it } from 'vitest';
import { createFrameScheduler, type ReleaseReason } from '../frameScheduler';

const setup = () => {
  const sent: number[] = [];
  const released: [number, ReleaseReason][] = [];
  const scheduler = createFrameScheduler<number>({
    send: (frame) => sent.push(frame),
    release: (frame, reason) => released.push([frame, reason]),
  });
  return { scheduler, sent, released };
};

describe('frame scheduler', () => {
  it('sends the first frame at once and holds the next one', () => {
    const { scheduler, sent, released } = setup();
    scheduler.offer(1);
    scheduler.offer(2);

    expect(sent).toEqual([1]);
    expect(released).toEqual([]);
    expect(scheduler.inFlight).toBe(true);
    expect(scheduler.pending).toBe(true);
  });

  it('keeps one frame in flight however many arrive', () => {
    const { scheduler, sent } = setup();
    for (let frame = 1; frame <= 10; frame += 1) scheduler.offer(frame);
    expect(sent).toEqual([1]);
  });

  it('replaces the waiting frame with a newer one and releases the older', () => {
    const { scheduler, sent, released } = setup();
    scheduler.offer(1);
    scheduler.offer(2);
    scheduler.offer(3);
    scheduler.offer(4);

    expect(released).toEqual([
      [2, 'dropped'],
      [3, 'dropped'],
    ]);
    scheduler.complete();
    expect(sent).toEqual([1, 4]);
  });

  it('goes idle after completing with nothing waiting, then sends the next offer at once', () => {
    const { scheduler, sent } = setup();
    scheduler.offer(1);
    scheduler.complete();
    expect(scheduler.inFlight).toBe(false);

    scheduler.offer(2);
    expect(sent).toEqual([1, 2]);
  });

  it('ignores a completion with nothing in flight', () => {
    const { scheduler, sent } = setup();
    scheduler.complete();
    scheduler.offer(1);
    scheduler.complete();
    scheduler.complete();
    expect(sent).toEqual([1]);
    expect(scheduler.inFlight).toBe(false);
  });

  it('on stop with a frame in flight, releases the waiting frame and sends nothing more', () => {
    const { scheduler, sent, released } = setup();
    scheduler.offer(1);
    scheduler.offer(2);

    scheduler.stop();
    expect(released).toEqual([[2, 'stopped']]);

    scheduler.complete();
    scheduler.offer(3);
    expect(sent).toEqual([1]);
    expect(released).toEqual([
      [2, 'stopped'],
      [3, 'stopped'],
    ]);
    expect(scheduler.pending).toBe(false);
  });

  it('releases a frame whose send throws and stays usable', () => {
    const released: [number, ReleaseReason][] = [];
    const sent: number[] = [];
    const scheduler = createFrameScheduler<number>({
      send: (frame) => {
        if (frame === 1) throw new Error('DataCloneError');
        sent.push(frame);
      },
      release: (frame, reason) => released.push([frame, reason]),
    });

    expect(() => scheduler.offer(1)).toThrow('DataCloneError');
    expect(released).toEqual([[1, 'dropped']]);
    expect(scheduler.inFlight).toBe(false);

    scheduler.offer(2);
    expect(sent).toEqual([2]);
  });
});
