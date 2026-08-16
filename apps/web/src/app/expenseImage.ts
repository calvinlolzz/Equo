const MAX_EDGE_PX = 720;
const JPEG_QUALITY = 0.8;

/**
 * Receipt photos are CAPTURED at a larger edge: 720px is far too little for OCR
 * to read the small print on a 超商發票. This size is for the recognition
 * request only — the copy that gets uploaded and lives on the expense is cut
 * back to MAX_EDGE_PX first (see downscaleDataUrl and App's handleReceiptCaptured).
 *
 * Worth keeping the two apart: the stored image is shown as a 42px thumbnail in
 * the records list and full-width in the detail dialog, and at 1600px it was
 * costing roughly 300 KB a receipt on someone's mobile data to draw a thumbnail
 * the size of a fingernail. 720px is the same size a photo picked in the
 * composer has always been stored at.
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Draw a decoded image onto a canvas at the capped size and re-encode as JPEG. */
function toJpegDataUrl(image: HTMLImageElement, maxEdge: number): string | null {
  const { width, height } = getDownscaledImageSize({ width: image.naturalWidth, height: image.naturalHeight, maxEdge });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export async function downscaleImageFileToDataUrl(file: File, maxEdge = MAX_EDGE_PX): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    return toJpegDataUrl(image, maxEdge) ?? objectUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * How long the re-cut below gets before the original is used instead. Generous
 * against the ~100-300ms a 1600px decode and re-encode actually takes on a
 * mid-range phone; it is here for the case that never finishes at all.
 */
const DOWNSCALE_DEADLINE_MS = 1_500;

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Re-cut an existing data URL to a smaller edge, best effort.
 *
 * For the one case where the same photo is needed at two sizes: a receipt is
 * captured big enough for recognition to read it, then stored small enough not
 * to cost a few hundred KB every time a list draws its thumbnail. That does mean
 * a second JPEG generation on the stored copy, which is a real (if small) loss —
 * accepted because the stored image is only ever eyeballed, never re-recognised,
 * and re-capturing at a second size is not possible from a single video frame.
 *
 * **Always resolves, and never hangs**, returning the input unchanged if it
 * cannot do better. That contract is the point rather than a convenience: the
 * caller opens the composer on the result, and an image decode that rejects — or
 * simply never calls back, which is a thing decoders do on a malformed or
 * enormous image — must not be able to strand somebody in front of a sheet that
 * never arrives. Shrinking the file is an optimisation; showing the sheet is the
 * feature.
 */
export async function downscaleDataUrl(dataUrl: string, maxEdge = MAX_EDGE_PX): Promise<string> {
  if (!dataUrl) return dataUrl;
  try {
    const image = await withDeadline(loadImage(dataUrl), DOWNSCALE_DEADLINE_MS);
    if (!image) return dataUrl;
    return toJpegDataUrl(image, maxEdge) ?? dataUrl;
  } catch {
    return dataUrl;
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
