import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Images, ScanLine } from "lucide-react";
import { captureVideoFrameDataUrl, downscaleImageFileToDataUrl, RECEIPT_MAX_EDGE_PX } from "./expenseImage";
import { createQrDetector } from "./qrDetect";
import { haptic } from "./haptics";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/** How often the invite scanner reads a frame. Fast enough to feel instant, slow enough not to pin a mid-range CPU. */
const SCAN_INTERVAL_MS = 200;

export type ScanSheetMode = "receipt" | "invite";

type ScanSheetProps = {
  mode: ScanSheetMode;
  /** Freezes the shutter while the captured frame is being uploaded/recognised. */
  busy?: boolean;
  onClose: () => void;
  /** receipt mode: a captured still, already downscaled to a jpeg data URL. */
  onCaptureReceipt?: (dataUrl: string) => void;
  /**
   * invite mode: a decoded QR payload. Return true to accept and stop scanning;
   * false keeps the camera running so a mis-aimed scan of some other QR code
   * doesn't dead-end the user on a frozen screen.
   */
  onDetectInvite?: (payload: string) => boolean;
  onImageError?: () => void;
};

type CameraError = "denied" | "unavailable" | "insecure";

function describeCameraError(error: unknown): CameraError {
  // Only a secure context gets mediaDevices at all, so a missing API on an
  // http:// origin is the insecure case rather than a device without a camera.
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  return "unavailable";
}

const CAMERA_ERROR_TEXT: Record<CameraError, string> = {
  denied: text.scanCameraDenied,
  unavailable: text.scanCameraUnavailable,
  insecure: text.scanCameraInsecure,
};

/**
 * The full-screen camera view behind both 掃描收據 and 掃描邀請 QR code.
 *
 * One component for two jobs because the chrome is identical (back, title,
 * live preview, hint) and only the bottom differs: a shutter the user presses
 * for a receipt, versus a reticle that fires by itself once a QR resolves.
 *
 * The stream is owned by this component and torn down on unmount — leaving a
 * track live keeps the phone's camera indicator on, which reads as spyware.
 */
export function ScanSheet({
  mode,
  busy = false,
  onClose,
  onCaptureReceipt,
  onDetectInvite,
  onImageError,
}: ScanSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [streaming, setStreaming] = useState(false);
  const isReceipt = mode === "receipt";

  useBodyScrollLock(true);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("getUserMedia unavailable"), { name: "NotSupportedError" });
        }
        stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera is the only sensible default for both jobs; a
          // device without one falls back to whatever it has rather than
          // failing outright, hence "environment" and not { exact: ... }.
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {
          // Autoplay rejection on a muted+playsInline element is rare, and the
          // frame usually arrives anyway; don't turn it into a hard error.
        });
        if (!cancelled) setStreaming(true);
      } catch (error) {
        if (!cancelled) setCameraError(describeCameraError(error));
      }
    }

    void start();

    return () => {
      cancelled = true;
      setStreaming(false);
      stream?.getTracks().forEach((track) => track.stop());
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, []);

  useEffect(() => {
    if (isReceipt || !streaming) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function scan() {
      const detect = await createQrDetector();
      if (cancelled) return;

      let inFlight = false;
      timer = setInterval(async () => {
        // A slow software decode must not stack up behind itself, or the tail
        // of queued frames keeps firing long after a code has been accepted.
        if (inFlight || cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        inFlight = true;
        try {
          const payload = await detect(video);
          if (!payload || cancelled) return;
          if (onDetectInvite?.(payload)) {
            cancelled = true;
            haptic("success");
          }
        } catch {
          // A frame that fails to decode is the normal case, not an error.
        } finally {
          inFlight = false;
        }
      }, SCAN_INTERVAL_MS);
    }

    void scan();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // onDetectInvite is re-created every render by the owner; re-arming the
    // interval on each one would restart the decoder constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReceipt, streaming]);

  function captureFrame() {
    const video = videoRef.current;
    if (!video || busy) return;
    const dataUrl = captureVideoFrameDataUrl(video, RECEIPT_MAX_EDGE_PX);
    if (!dataUrl) {
      onImageError?.();
      return;
    }
    haptic("success");
    onCaptureReceipt?.(dataUrl);
  }

  async function pickFromLibrary(file: File | null) {
    if (!file || busy) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file, RECEIPT_MAX_EDGE_PX);
      onCaptureReceipt?.(dataUrl);
    } catch {
      onImageError?.();
    }
  }

  return (
    <div className="scan-screen" role="dialog" aria-modal="true" aria-label={isReceipt ? text.scanReceipt : text.scanInviteTitle}>
      <header className="scan-topbar">
        <button className="scan-icon-button" type="button" aria-label={text.back} onClick={onClose}>
          <ChevronLeft aria-hidden="true" size={24} />
        </button>
        <h2>{isReceipt ? text.scanReceipt : text.scanInviteTitle}</h2>
        {isReceipt ? (
          <label className="scan-icon-button scan-gallery-button">
            <Images aria-hidden="true" size={20} />
            <span className="visually-hidden">{text.scanFromPhotos}</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                void pickFromLibrary(event.target.files?.[0] ?? null);
                // Let the same photo be picked twice in a row after a failure.
                event.target.value = "";
              }}
            />
          </label>
        ) : (
          <span className="scan-icon-button scan-icon-placeholder" aria-hidden="true" />
        )}
      </header>

      <div className="scan-stage">
        <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
        {!isReceipt ? (
          <div className="scan-reticle" aria-hidden="true">
            <ScanLine size={36} />
          </div>
        ) : null}
        {cameraError ? (
          <p className="scan-error" role="alert">
            {CAMERA_ERROR_TEXT[cameraError]}
          </p>
        ) : null}
      </div>

      <div className="scan-hint">
        {isReceipt ? (
          <>
            <span>{busy ? text.scanReading : text.scanReceiptHint}</span>
            <small>{text.scanReceiptExamples}</small>
          </>
        ) : (
          <span>{text.scanInviteHint}</span>
        )}
      </div>

      {isReceipt ? (
        <div className="scan-shutter-row">
          <button
            className="scan-shutter"
            type="button"
            aria-label={text.scanReceiptShutter}
            disabled={busy || !streaming}
            onClick={captureFrame}
          />
        </div>
      ) : null}
    </div>
  );
}
