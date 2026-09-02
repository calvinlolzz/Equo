import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import {
  CENTRED_VIEW,
  COVER_ASPECT,
  MAX_SCALE,
  MIN_SCALE,
  clampOffset,
  clampScale,
  computeCoverCrop,
  displayOverflow,
  offsetDelta,
  type CropView,
} from "./coverCrop";
import { useDialogChrome } from "./useDialogChrome";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.cover;
const appText = UI_TEXT.app;

/**
 * Choose which part of a photo becomes the group cover.
 *
 * The cover is rendered at a fixed 16:9 wherever it appears, so a portrait
 * photo has always been cropped — the app just used to decide where, and the
 * middle band of a photo is very often the least interesting part of it. This
 * hands that choice back: drag to move the picture behind the frame, the slider
 * zooms, and what the frame is over is what gets saved.
 *
 * Cropping happens at upload time rather than being stored as a focal point,
 * so nothing downstream has to know this feature exists: the cover is simply an
 * image of the right shape by the time anything else sees it.
 */
export function CoverCropSheet({
  imageDataUrl,
  onCancel,
  onConfirm,
}: {
  imageDataUrl: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}) {
  const [view, setView] = useState<CropView>(CENTRED_VIEW);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const dialogRef = useDialogChrome(onCancel);

  useEffect(() => {
    const element = new Image();
    element.onload = () => setImage(element);
    element.src = imageDataUrl;
  }, [imageDataUrl]);

  const imageAspect = image && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : COVER_ASPECT;

  /** What the picture is doing behind the frame right now. */
  const transform = useMemo(() => {
    const frame = frameRef.current;
    const overflow = displayOverflow({
      frameWidth: frame?.clientWidth ?? 0,
      frameHeight: frame?.clientHeight ?? 0,
      imageAspect,
      scale: view.scale,
    });

    return {
      x: (-overflow.x / 2) * view.offsetX,
      y: (-overflow.y / 2) * view.offsetY,
    };
  }, [imageAspect, view]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !frame) return;

    const overflow = displayOverflow({
      frameWidth: frame.clientWidth,
      frameHeight: frame.clientHeight,
      imageAspect,
      scale: view.scale,
    });

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };

    setView((current) => ({
      scale: current.scale,
      offsetX: clampOffset(current.offsetX + offsetDelta(dx, overflow.x)),
      offsetY: clampOffset(current.offsetY + offsetDelta(dy, overflow.y)),
    }));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function confirm() {
    if (!image) return;
    const crop = computeCoverCrop({ width: image.naturalWidth, height: image.naturalHeight }, view);
    if (!crop) return;

    // Output at the frame's shape, capped so a huge original does not become a
    // huge upload. Height follows from the aspect so the result is exactly what
    // the cover will render.
    const width = Math.min(1280, Math.max(1, Math.round(crop.sw)));
    const height = Math.max(1, Math.round(width / COVER_ASPECT));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    onConfirm(canvas.toDataURL("image/jpeg", 0.82));
  }

  return (
    <div className="modal-backdrop cover-crop-backdrop" role="presentation">
      <section
        className="flow-dialog glass-panel cover-crop-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        ref={dialogRef}
      >
        <button className="dialog-close" type="button" aria-label={appText.cancel} onClick={onCancel}>
          <X aria-hidden="true" size={18} />
        </button>
        <div className="dialog-header">
          <h3>{text.title}</h3>
          <p>{text.hint}</p>
        </div>

        <div
          className="cover-crop-frame"
          ref={frameRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            src={imageDataUrl}
            alt=""
            draggable={false}
            style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${view.scale})` }}
          />
        </div>

        <label className="cover-crop-zoom">
          <span>{text.zoom}</span>
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.01}
            value={view.scale}
            aria-label={text.zoom}
            onChange={(event) =>
              setView((current) => ({
                // Re-clamping the offsets matters on the way back DOWN: zooming
                // out shrinks the slack, and an offset that was legal at 3×
                // would otherwise leave the frame over nothing.
                scale: clampScale(Number(event.target.value)),
                offsetX: clampOffset(current.offsetX),
                offsetY: clampOffset(current.offsetY),
              }))
            }
          />
        </label>

        <div className="dialog-action-row">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {appText.cancel}
          </button>
          <button className="primary-action" type="button" onClick={confirm} disabled={!image}>
            <Check aria-hidden="true" size={16} />
            {text.apply}
          </button>
        </div>
      </section>
    </div>
  );
}
