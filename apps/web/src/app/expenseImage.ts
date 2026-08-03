const MAX_EDGE_PX = 720;
const JPEG_QUALITY = 0.8;

/**
 * Receipt photos go through the same pipeline but at a larger edge: 720px is
 * plenty for a thumbnail that sits next to an expense, and far too little for
 * OCR to read the small print on a 超商發票. Still well inside the 1.5 MB the
 * upload endpoint accepts (a 1600px JPEG at q0.8 lands around 300 KB).
 */
export const RECEIPT_MAX_EDGE_PX = 1600;

export function getDownscaledImageSize({
  width,
  height,
  maxEdge = MAX_EDGE_PX,
}: {
  width: number;
  height: number;
  maxEdge?: number;
}): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge || longestEdge <= 0) {
    return { width, height };
  }
  const scale = maxEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function downscaleImageFileToDataUrl(file: File, maxEdge = MAX_EDGE_PX): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });
    const { width, height } = getDownscaledImageSize({ width: image.naturalWidth, height: image.naturalHeight, maxEdge });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return objectUrl;
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * A still from a live <video>, downscaled the same way a picked file is.
 *
 * videoWidth/videoHeight rather than the element's CSS box: the preview is
 * cropped to fill the screen, and capturing the cropped box would cut off the
 * edges of a receipt the user had carefully framed. Returns "" before the first
 * frame has arrived (both dimensions are 0 until then).
 */
export function captureVideoFrameDataUrl(video: HTMLVideoElement, maxEdge = MAX_EDGE_PX): string {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return "";

  const { width, height } = getDownscaledImageSize({ width: sourceWidth, height: sourceHeight, maxEdge });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
