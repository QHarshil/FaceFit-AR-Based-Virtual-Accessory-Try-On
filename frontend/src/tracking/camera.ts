// Same request the previous camera helper made, so capture size and the
// measured baseline stay comparable.
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: 'user', width: 1280, height: 720 },
};

/** The same request for one camera, by its device id. */
const constraintsFor = (deviceId: string | null): MediaStreamConstraints =>
  deviceId === null
    ? CONSTRAINTS
    : { audio: false, video: { deviceId: { exact: deviceId }, width: 1280, height: 720 } };

export interface CameraHandle {
  /** The video track, for pausing and for noticing when the device goes away. */
  track: MediaStreamTrack | null;
  /** The camera that answered, so it can be asked for again. */
  deviceId: string | null;
  release: () => void;
}

/**
 * Attaches the user camera to `video` and resolves once it plays. With a
 * device id it asks for that camera only, and fails when it is gone.
 */
export const startCamera = async (
  video: HTMLVideoElement,
  deviceId: string | null = null,
): Promise<CameraHandle> => {
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new DOMException('Camera access is not available on this page', 'NotSupportedError');
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraintsFor(deviceId));
  const release = () => {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
    if (video.srcObject === stream) video.srcObject = null;
  };
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    release();
    throw error;
  }
  const track = stream.getVideoTracks()[0] ?? null;
  return { track, deviceId: track?.getSettings().deviceId ?? deviceId, release };
};
