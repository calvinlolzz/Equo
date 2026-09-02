/**
 * The maths behind the cover cropper, kept away from the gestures so it can be
 * tested without a browser.
 *
 * The model is the one every photo cropper uses and nobody explains: the FRAME
 * is fixed (the shape the cover will be shown in), the IMAGE moves behind it,
 * and what gets saved is the part of the image the frame is over. Zoom 1 means
 * "the image exactly covers the frame" — never smaller, so there is no way to
 * end up with a cover that has blank edges.
 */

/** The cover's shape wherever it is rendered: 16:9, matching .side-cover. */
export const COVER_ASPECT = 16 / 9;

export type CropView = {
  /** 1 = the image just covers the frame. Larger zooms in. */
  scale: number;
  /**
   * How far the image is dragged from centred, as a fraction of the slack in
   * each axis: -1 is hard against one edge, 0 centred, 1 against the other.
   * Expressed as a fraction rather than pixels so the state survives the frame
   * being measured at a different size (rotation, a different screen).
   */
  offsetX: number;
  offsetY: number;
};

export const CENTRED_VIEW: CropView = { scale: 1, offsetX: 0, offsetY: 0 };

export const MIN_SCALE = 1;
export const MAX_SCALE = 3;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Offsets are fractions of the available slack, so they clamp to [-1, 1]. */
export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(1, Math.max(-1, offset));
}

export type CropRect = { sx: number; sy: number; sw: number; sh: number };

/**
 * The source rectangle to copy out of the image, in image pixels.
 *
 * Returns null for an image with no area — a decode that produced a 0×0 bitmap
 * would otherwise divide by zero and hand drawImage a NaN rectangle, which
 * throws in some browsers and silently draws nothing in others.
 */
export function computeCoverCrop(
  image: { width: number; height: number },
  view: CropView,
  frameAspect = COVER_ASPECT,
): CropRect | null {
  if (image.width <= 0 || image.height <= 0) return null;

  const scale = clampScale(view.scale);
  const imageAspect = image.width / image.height;

  // The visible slice at zoom 1: the largest frame-shaped rectangle that fits
  // inside the image. Then zooming in shrinks it.
  let sw: number;
  let sh: number;

  if (imageAspect > frameAspect) {
    // Wider than the frame — full height is used, width is cropped.
    sh = image.height / scale;
    sw = sh * frameAspect;
  } else {
    sw = image.width / scale;
    sh = sw / frameAspect;
  }

  // Whatever is left over is what dragging can move through.
  const slackX = image.width - sw;
  const slackY = image.height - sh;

  return {
    sx: (slackX / 2) * (1 + clampOffset(view.offsetX)),
    sy: (slackY / 2) * (1 + clampOffset(view.offsetY)),
    sw,
    sh,
  };
}

/**
 * How far the displayed image overflows the frame, in screen pixels, per axis.
 *
 * This is the pannable range: the crop sheet draws the image to COVER the frame
 * (never smaller — that is the whole point of clamping scale at 1) and then
 * multiplies by the zoom, so whatever hangs outside is what dragging can bring
 * into view.
 *
 * ⚠️ Both axes are computed, and one of them is usually non-zero even at zoom
 * 1 — a portrait photo in a 16:9 frame has a tall column of hidden image with
 * no zooming at all, and "drag a tall photo up and down to choose the band you
 * want" is the exact thing this feature exists for. An earlier version derived
 * the range from the zoom alone, which silently made that case undraggable.
 */
export function displayOverflow(options: {
  frameWidth: number;
  frameHeight: number;
  imageAspect: number;
  scale: number;
}): { x: number; y: number } {
  const { frameWidth, frameHeight, imageAspect } = options;
  const scale = clampScale(options.scale);

  if (frameWidth <= 0 || frameHeight <= 0 || !Number.isFinite(imageAspect) || imageAspect <= 0) {
    return { x: 0, y: 0 };
  }

  const frameAspect = frameWidth / frameHeight;
  const baseWidth = imageAspect > frameAspect ? frameHeight * imageAspect : frameWidth;
  const baseHeight = imageAspect > frameAspect ? frameHeight : frameWidth / imageAspect;

  return {
    x: Math.max(0, baseWidth * scale - frameWidth),
    y: Math.max(0, baseHeight * scale - frameHeight),
  };
}

/**
 * A drag in screen pixels, as a change in offset.
 *
 * The offset runs -1 → 1 across the whole overflow, so the conversion is two
 * offset units per overflow pixel-span. Negated because dragging the picture
 * to the right reveals what was off its left edge.
 */
export function offsetDelta(deltaPx: number, overflowPx: number): number {
  if (!(overflowPx > 0) || !Number.isFinite(deltaPx)) return 0;
  return (-2 * deltaPx) / overflowPx;
}
