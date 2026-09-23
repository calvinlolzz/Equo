import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What an image file actually is, read out of its own header.
 *
 * Every assertion about a shipped image here is about a mismatch between what
 * the page asks of a file and what the file is — a 390px source drawn into 696
 * device pixels, a manifest declaring sizes that stopped being true two
 * redesigns ago. A test that took the filename's word for any of that would be
 * checking the same assumption that failed.
 *
 * Test-only, but it lives beside the code for the same reason cssDeclarations
 * does: it reads that code's own files.
 */
const APP_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(APP_DIR, "..", "..", "public");

export type ImageFacts = { width: number; height: number; bytes: number };

/**
 * A WebP's dimensions.
 *
 * Handles the two encodings Pillow emits at the qualities used here: simple
 * lossy (`VP8 `) and lossless (`VP8L`). An extended file (`VP8X`, which is what
 * an animation or an alpha channel produces) is refused rather than guessed at
 * — none of these should be one, and silently reading the wrong two bytes as a
 * size is exactly the kind of quiet wrongness this exists to catch.
 */
export function webpSize(publicPath: string): ImageFacts {
  const file = join(PUBLIC_DIR, publicPath);
  const buffer = readFileSync(file);

  if (buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error(`${publicPath} is not a WebP file`);
  }

  const chunk = buffer.subarray(12, 16).toString("ascii");
  const bytes = statSync(file).size;

  if (chunk === "VP8 ") {
    // 3-byte frame tag, the 0x9D012A sync code, then two 14-bit dimensions.
    const sync = [...buffer.subarray(23, 26)];
    if (sync[0] !== 0x9d || sync[1] !== 0x01 || sync[2] !== 0x2a) {
      throw new Error(`${publicPath}: VP8 keyframe sync code missing`);
    }
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, bytes };
  }

  if (chunk === "VP8L") {
    // One signature byte, then 14 bits of width and 14 of height, minus one.
    const packed = buffer.readUInt32LE(21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1, bytes };
  }

  throw new Error(`${publicPath}: unexpected WebP chunk "${chunk}"`);
}

/** The parsed site.webmanifest, so tests can hold it against the files it names. */
export function readManifest(): {
  name: string;
  description: string;
  screenshots: Array<{ src: string; sizes: string; type: string; form_factor: string; label: string }>;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
} {
  return JSON.parse(readFileSync(join(PUBLIC_DIR, "site.webmanifest"), "utf8"));
}
