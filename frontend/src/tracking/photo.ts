// Photo try-on: decode the photo on the device, find the largest face with
// FaceLandmarker in IMAGE mode in its own worker, then stop the worker. The
// photo is never uploaded or stored.
import { PERCEPTION_ASSETS } from '../perception/assets';
import { startLandmarker } from '../perception/landmarkerClient';
import type { LandmarkFrame } from '../perception/types';

/**
 * Longest side a photo is decoded to. A 12 MP phone photo is 48 MB per
 * decoded RGBA copy, and mobile Safari caps a tab's memory. 1280 matches the
 * camera's capture width.
 */
export const MAX_PHOTO_SIDE = 1280;

export const scaledSize = (width: number, height: number, maxSide = MAX_PHOTO_SIDE) => {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/** Decodes with the photo's EXIF orientation applied, as an <img> shows it. */
export const decodePhoto = async (photo: Blob, maxSide = MAX_PHOTO_SIDE): Promise<ImageBitmap> => {
  const full = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const size = scaledSize(full.width, full.height, maxSide);
  if (size.width === full.width && size.height === full.height) return full;
  try {
    return await createImageBitmap(full, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'high',
    });
  } finally {
    full.close();
  }
};

export interface PhotoDeps {
  decode: (photo: Blob) => Promise<ImageBitmap>;
  startLandmarker: typeof startLandmarker;
}

const DEFAULT_DEPS: PhotoDeps = { decode: decodePhoto, startLandmarker };

/** Landmarks of the largest face in the photo; the frame has no face when none was found. */
export const detectPhotoFace = async (
  photo: Blob,
  { decode, startLandmarker: start }: PhotoDeps = DEFAULT_DEPS,
): Promise<LandmarkFrame> => {
  const image = await decode(photo);
  let client: ReturnType<typeof start>;
  try {
    client = start({
      assets: PERCEPTION_ASSETS,
      runningMode: 'IMAGE',
      onResult: () => {},
      onError: () => {},
    });
  } catch (error) {
    image.close();
    throw error;
  }
  try {
    await client.ready;
  } catch (error) {
    // Never handed to the worker, so it is still ours to release.
    image.close();
    client.stop();
    throw error;
  }
  try {
    return await client.detectImage(image);
  } finally {
    client.stop();
  }
};
