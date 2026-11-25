// Same request the previous camera helper made, so capture size and the
// measured baseline stay comparable.
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: 'user', width: 1280, height: 720 },
};

export interface CameraHandle {
  /** The video track, for pausing and for noticing when the device goes away. */
  track: MediaStreamTrack | null;
  release: () => void;
}

/** Attaches the user camera to `video` and resolves once it plays. */
export const startCamera = async (video: HTMLVideoElement): Promise<CameraHandle> => {
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new DOMException('Camera access is not available on this page', 'NotSupportedError');
  }
  const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
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
  return { track: stream.getVideoTracks()[0] ?? null, release };
};
