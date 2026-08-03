/** Reads one QR payload out of the current video frame, or "" when there is none. */
export type QrDetector = (video: HTMLVideoElement) => Promise<string>;

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

/** The frame handed to the software decoder. Capped so a 4K stream doesn't cost 8 MP per scan tick. */
const DECODE_MAX_EDGE_PX = 640;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

function drawScaledFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, DECODE_MAX_EDGE_PX / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently: every tick reads the whole buffer back, which without
  // the hint pushes browsers into a GPU-backed canvas and makes getImageData
  // an expensive readback on exactly the path that runs 5x a second.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * A QR reader for the live camera preview.
 *
 * Prefers the platform's BarcodeDetector, which decodes on a background thread
 * and is what Android Chrome offers. iOS Safari has no such API at any version,
 * and iOS is where invite codes actually get scanned — so the fallback is a real
 * requirement, not a nicety, and jsQR is loaded lazily so the ~40 KB decoder
 * only reaches phones that open the scanner.
 */
export async function createQrDetector(): Promise<QrDetector> {
  const Ctor = getBarcodeDetectorCtor();

  if (Ctor) {
    try {
      const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
      if (formats.includes("qr_code")) {
        const detector = new Ctor({ formats: ["qr_code"] });
        return async (video) => {
          if (!video.videoWidth) return "";
          const results = await detector.detect(video);
          return results[0]?.rawValue ?? "";
        };
      }
    } catch {
      // A detector that throws on construction or format probing is unusable;
      // fall through to jsQR rather than leaving the user with a dead camera.
    }
  }

  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");

  return async (video) => {
    const frame = drawScaledFrame(video, canvas);
    if (!frame) return "";
    const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
    return result?.data ?? "";
  };
}
