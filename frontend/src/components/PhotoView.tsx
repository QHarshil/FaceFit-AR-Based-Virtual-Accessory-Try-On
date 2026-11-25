import { useEffect, useRef } from 'react';
import { decodePhoto } from '../tracking/photo';

/**
 * Draws the chosen photo on a canvas at the size detection used, so the
 * overlay's landmarks line up. Nothing leaves the device: no upload, no
 * object URL, and the decoded copy is released once drawn.
 */
function PhotoView({ photo }: { photo: Blob }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let current = true;
    // Resizing a canvas clears it, so the last photo is gone while this one
    // decodes, and stays gone when it cannot be read.
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    void decodePhoto(photo).then(
      (image) => {
        if (current && canvas) {
          canvas.width = image.width;
          canvas.height = image.height;
          canvas.getContext('2d')?.drawImage(image, 0, 0);
        }
        image.close();
      },
      // Detection reports an unreadable photo; the view stays empty.
      () => {},
    );
    return () => {
      current = false;
    };
  }, [photo]);

  return <canvas ref={canvasRef} className="photo-feed" role="img" aria-label="Your photo" />;
}

export default PhotoView;
