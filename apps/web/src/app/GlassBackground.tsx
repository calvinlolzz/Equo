import { useEffect, useRef } from "react";
import { BACKGROUND_UNAVAILABLE_ATTR, readStoredBackgroundMotion } from "./backgroundStore";

/**
 * Animated "liquid glass" WebGL backdrop.
 *
 * Ported from the equo-mu reference site's GlassBackground shader (originally
 * wrapped in three.js). The shader is a single fullscreen quad, so this is a
 * dependency-free raw-WebGL reimplementation. The motion — orbiting colour
 * blobs, liquid refraction warp, cursor swirl, caustic highlights, vignette —
 * is kept identical to the reference. Only the palette is retuned: instead of
 * sweeping the full hue wheel, hues are constrained to an on-brand band
 * (amber -> green -> mint -> teal) sitting over the dark Equo base colour.
 */

const BLOB_COUNT = 6;
const TAU = Math.PI * 2;

// On-brand hue band (HSV hue fractions [0,1]). Runs green -> mint -> teal ->
// deep violet -> dark pink; the warm orange/amber end is deliberately excluded.
// The cool end (violet/pink) is darkened in the shader so it reads as a moody
// accent rather than a neon glare, keeping mint the bright hero.
//   0.34 green   0.44 mint (#6de2b8)   0.50 teal   0.78 violet   0.94 dark pink
const HUE_BASE = 0.34;
const HUE_SPAN = 0.62;
// Dark Equo base colour the blobs melt into (matches the body backdrop).
const BG_COLOR: [number, number, number] = [0x07 / 255, 0x13 / 255, 0x0f / 255];

// Two soft accent colours from the reference gradient, injected as fixed-colour
// blobs so they always appear amongst the cycling green/violet/pink: a warm
// peach/cream and a dusty rose. RGB in 0..1.
const ACCENT_PEACH: [number, number, number] = [0.93, 0.82, 0.7];
const ACCENT_ROSE: [number, number, number] = [0.8, 0.55, 0.65];
// Blob indices that render a fixed accent colour instead of cycling the band.
const FIXED_ACCENTS: Record<number, [number, number, number]> = {
  4: ACCENT_PEACH,
  5: ACCENT_ROSE,
};

// Light (日間) palette — a soft liquid-glass field over a near-white base.
// Every blob is a fixed pastel (no hue cycling) referencing the demo: lavender,
// periwinkle (demo #8E7CF0 softened), mint (demo #63DBAF), teal, peach, rose.
// Kept high-value / low-saturation so it reads as gently drifting frosted glass
// under the light UI rather than a saturated wash.
const LIGHT_BG_COLOR: [number, number, number] = [0.925, 0.92, 0.965];
const LIGHT_BLOBS: Array<[number, number, number]> = [
  [0.66, 0.58, 0.93], // lavender
  [0.557, 0.486, 0.941], // periwinkle (demo purple #8E7CF0)
  [0.388, 0.859, 0.686], // mint (demo #63DBAF)
  [0.42, 0.8, 0.87], // teal
  [0.97, 0.78, 0.6], // peach
  [0.93, 0.62, 0.76], // rose
];

// Default inward-curl vortex: a spiral warp centred on the screen that is always
// on, so at rest the whole field reads as colours rolling inward (like the
// reference site). Strength decays from the centre; the spiral turns slowly.
const CURL_STRENGTH = 2.3; // peak rotation (radians) at the centre
const CURL_FALLOFF = 1.5; // how fast the curl fades toward the edges
const CURL_SPIN = 0.05; // slow continuous roll of the whole spiral

// How long the field keeps animating after the last interaction before it
// freezes on its current frame. A fullscreen fragment shader is a constant GPU
// load, and on a phone that load is what turns a long session into a hot,
// throttled one — the app gets progressively less responsive the longer it is
// left open. Nobody is watching the backdrop while they read their expenses, so
// after a few seconds of no touching it holds the last frame (identical pixels,
// zero draw calls) and picks up again on the next scroll or tap. The drift is
// slow enough that the freeze and the resume are both invisible.
export const IDLE_FREEZE_MS = 6_000;

/**
 * The same budget for a mouse or trackpad, and much shorter — because on a
 * desktop the idle clock above almost never runs out.
 *
 * A finger touches the screen in bursts; a cursor is moved more or less
 * continuously by somebody who is just reading, and every pointermove used to
 * restart the six seconds. So the "settle when nobody is interacting" fix that
 * works on a phone left a desktop shading the whole window sixty (now thirty)
 * times a second for as long as the tab was open — with a dozen backdrop-filter
 * panels re-blurring on top of it every time it changed.
 *
 * Paired with `wakeOnPointerMove: false` on fine pointers: moving the mouse no
 * longer counts as interaction at all, so the field drifts for a couple of
 * seconds after each real action (load, scroll, click, keypress) and then holds
 * still. The look survives — it is a slow gradient, and a still one is the same
 * picture — while the constant cost does not.
 */
export const IDLE_FREEZE_MS_POINTER = 2_500;

/**
 * "Never settle." Passed as the idle budget where the field is meant to keep
 * drifting for as long as it is on screen.
 *
 * Infinity rather than a very large number so the intent survives being read:
 * every comparison in the loop is `elapsed > budget`, which is simply never
 * true — no special case, no branch that only fires after eleven days.
 *
 * ⚠️ This is the one gate that gives up a real saving. The other three are
 * still there and still matter: a backgrounded tab, a canvas scrolled out of
 * view, and an open sheet all stop the loop. What it costs is the quiet
 * machine — a desktop left sitting on the group screen now shades the window
 * continuously instead of settling after a couple of seconds. That is a
 * deliberate trade for the look, and 個人資料 → 動態背景 is the way out of it.
 */
export const IDLE_FREEZE_NEVER = Number.POSITIVE_INFINITY;

/**
 * Renderer strings that mean "there is no usable GPU behind this context".
 *
 * A fullscreen fragment shader on a software rasteriser is not slow, it is
 * catastrophic: every pixel of every frame is computed on the CPU, on the same
 * thread budget the app needs to stay responsive. This happens more often than
 * it sounds — a blocklisted driver, a VM, a remote desktop, hardware
 * acceleration switched off in the browser's settings — and it is invisible
 * from the outside: WebGL works, so the app cheerfully starts the loop.
 *
 * There is a perfectly good CSS gradient underneath (see app-base.css), which
 * is what these machines get instead.
 */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|software|basic render|microsoft basic|mesa offscreen/i.test(renderer);
}

/**
 * Minimum milliseconds between drawn frames, from a frames-per-second cap.
 *
 * ⚠️ Zero means UNCAPPED, not "no frames" — the loop compares
 * `now - lastFrame < frameInterval`, so 0 lets every animation frame through
 * and vsync becomes the only limit. Anything at or above 60 is uncapped too,
 * because vsync would be doing the capping anyway and an interval that lands
 * a hair over the refresh period drops every other frame instead.
 */
export function frameIntervalFor(fpsCap: number): number {
  return fpsCap > 0 && fpsCap < 60 ? 1000 / fpsCap : 0;
}

/** Everything that can stop the field drawing. See shouldAnimate. */
export interface AnimationGate {
  /** The canvas is intersecting the viewport (IntersectionObserver). */
  visible: boolean;
  /** document.hidden — the tab is backgrounded. */
  documentHidden: boolean;
  /**
   * Something more important than the field is happening: a sheet/drawer is
   * covering it (data-overlay), or the page is being scrolled (data-scrolling).
   * Both are set on <html> — see App.tsx and scrollActivity.ts.
   */
  paused: boolean;
  /** Milliseconds since the last scroll, tap, key or (on touch) pointer move. */
  msSinceInteraction: number;
  /**
   * How long after that the field keeps drawing. Defaults to the touch budget;
   * fine pointers pass the much shorter IDLE_FREEZE_MS_POINTER.
   */
  idleFreezeMs?: number;
}

/**
 * Whether the loop should be running. Extracted because this is the whole of
 * the power story and the one part of the scene worth testing on its own — the
 * rest needs a real GL context, and a headless tab never runs rAF at all.
 *
 * Every reason is independent and every one of them is a veto.
 */
export function shouldAnimate(gate: AnimationGate): boolean {
  return (
    gate.visible &&
    !gate.documentHidden &&
    !gate.paused &&
    gate.msSinceInteraction <= (gate.idleFreezeMs ?? IDLE_FREEZE_MS)
  );
}

const VERT_SRC = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
uniform float u_time;
uniform float u_aspect;
uniform vec2 u_mouse;
uniform float u_hueShift;
uniform float u_light;     // 1 = light theme (soften the dark vignette)
uniform vec3 u_bg;
uniform vec4 u_blobs[${BLOB_COUNT}];
uniform float u_blobHue[${BLOB_COUNT}];
uniform vec3 u_blobRGB[${BLOB_COUNT}];   // fixed accent colour per blob
uniform float u_blobFixed[${BLOB_COUNT}]; // 1 = use u_blobRGB, 0 = cycle the band
uniform int u_blobCount;
varying vec2 vUv;

// HSV -> RGB
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= u_aspect;

  // Liquid refraction wobble
  vec2 warp = 0.02 * vec2(
    sin(p.y * 7.0 + u_time * 0.7),
    cos(p.x * 6.0 + u_time * 0.6)
  );
  vec2 sp = p + warp;

  // Cursor swirl: closer to the pointer rotates harder -> colours whirl around it
  float dM = length(sp - u_mouse);
  float swirl = exp(-dM * 2.6) * 2.4;
  float cs = cos(swirl), sn = sin(swirl);
  sp = u_mouse + mat2(cs, -sn, sn, cs) * (sp - u_mouse);

  // Persistent inward curl around the centre: the default vortex where all
  // colours roll inward, independent of the pointer. Points nearer the centre
  // rotate more (a spiral), and the whole spiral turns slowly over time.
  float dC = length(sp);
  float curl = ${CURL_STRENGTH.toFixed(2)} * exp(-dC * ${CURL_FALLOFF.toFixed(2)}) + u_time * ${CURL_SPIN.toFixed(3)};
  float cc = cos(curl), sc = sin(curl);
  sp = mat2(cc, -sc, sc, cc) * sp;

  // Weighted colour mixing across orbiting blobs; nearest hue dominates each
  // region and all hues rotate together, so the band never collapses to one tone.
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < ${BLOB_COUNT}; i++) {
    if (i >= u_blobCount) break;
    vec4 b = u_blobs[i];
    vec2 c = b.xy
      + 0.16 * vec2(sin(u_time * 0.40 + b.w), cos(u_time * 0.33 + b.w * 1.3))
      + 0.10 * u_mouse;
    float d = length(sp - c);
    float f = smoothstep(b.z, 0.0, d);
    f *= f; // sharpen weights so it doesn't smear into grey
    // ping-pong the hue param so colours travel green<->pink smoothly, with no
    // hue-wheel jump (the band's two ends aren't adjacent colours).
    float t = fract(u_blobHue[i] + u_hueShift);
    t = 1.0 - abs(1.0 - 2.0 * t);
    t = pow(t, 0.72); // weight the cycle toward the violet/pink end -> more of it
    float hue = ${HUE_BASE.toFixed(3)} + ${HUE_SPAN.toFixed(3)} * t;
    float cool = smoothstep(0.48, 0.78, hue); // 0 = green side, 1 = violet/pink
    vec3 cyc = hsv2rgb(vec3(hue, 0.62 + 0.16 * cool, 0.93 - 0.32 * cool));
    // Blobs flagged fixed render a soft accent colour (peach / dusty rose) instead.
    vec3 bcol = mix(cyc, u_blobRGB[i], u_blobFixed[i]);
    acc += bcol * f;
    wsum += f;
  }
  vec3 blobCol = wsum > 0.0001 ? acc / wsum : u_bg;
  vec3 col = mix(u_bg, blobCol, clamp(wsum, 0.0, 1.0));

  // Caustics: two crossing waves multiplied -> sparse bright veins (water feel)
  float caustic = sin((sp.x + sp.y) * 13.0 + u_time)
                * sin((sp.x - sp.y) * 11.0 - u_time * 0.7);
  col += vec3(0.035) * smoothstep(0.65, 1.0, caustic);

  // Gentle edge vignette so central content stays readable. In light mode the
  // edge darkening is much softer so the field stays bright and airy.
  float vig = smoothstep(1.15, 0.35, length(p));
  col *= mix(mix(0.82, 0.95, u_light), 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[GlassBackground] shader compile failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface SceneOptions {
  dprCap: number;
  fpsCap: number;
  autoMouse: boolean;
  speed: number;
  light: boolean;
  /** Start paused because an overlay already covers the screen. */
  paused: boolean;
  /** See IDLE_FREEZE_MS_POINTER. */
  idleFreezeMs: number;
  /**
   * Whether moving the pointer restarts the idle clock. True on touch, where a
   * pointermove is a deliberate act; false on a mouse, where it is what a person
   * does while reading and would keep the field awake indefinitely.
   */
  wakeOnPointerMove: boolean;
}

interface Scene {
  dispose: () => void;
  resize: () => void;
  setPalette: (light: boolean) => void;
  setPaused: (paused: boolean) => void;
}

/** One-off seed per blob (base position, radius, phase, hue). */
interface BlobSeed {
  bx: number;
  by: number;
  r: number;
  phase: number;
  hue: number;
}

function createScene(canvas: HTMLCanvasElement, opts: SceneOptions): Scene | null {
  const glCtx =
    (canvas.getContext("webgl", { antialias: false, alpha: true }) as WebGLRenderingContext | null) ??
    (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
  if (!glCtx) return null;
  const gl = glCtx;

  // Before anything is compiled: if this context is not backed by a GPU, the
  // honest thing is not to draw at all (see isSoftwareRenderer).
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "") : "";
  if (renderer && isSoftwareRenderer(renderer)) {
    console.debug("[GlassBackground] software renderer, staying on the CSS gradient:", renderer);
    return null;
  }

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vert || !frag) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[GlassBackground] link failed", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  // Fullscreen quad (two triangles)
  const quad = new Float32Array([-1, -1, 3, -1, -1, 3]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const u = {
    time: gl.getUniformLocation(program, "u_time"),
    aspect: gl.getUniformLocation(program, "u_aspect"),
    mouse: gl.getUniformLocation(program, "u_mouse"),
    hueShift: gl.getUniformLocation(program, "u_hueShift"),
    bg: gl.getUniformLocation(program, "u_bg"),
    blobs: gl.getUniformLocation(program, "u_blobs"),
    blobHue: gl.getUniformLocation(program, "u_blobHue"),
    blobRGB: gl.getUniformLocation(program, "u_blobRGB"),
    blobFixed: gl.getUniformLocation(program, "u_blobFixed"),
    blobCount: gl.getUniformLocation(program, "u_blobCount"),
    light: gl.getUniformLocation(program, "u_light"),
  };

  gl.uniform1i(u.blobCount, BLOB_COUNT);

  // Swap the whole palette (base colour + per-blob fixed colours + vignette
  // softening) between dark and light. In dark, blobs 0-3 cycle the hue band
  // and 4-5 are the peach/rose accents; in light, every blob is a fixed pastel.
  // Called once on build and again live whenever data-theme toggles.
  const blobRGB = new Float32Array(BLOB_COUNT * 3);
  const blobFixed = new Float32Array(BLOB_COUNT);
  let paletteLight = opts.light;
  function applyPalette(light: boolean) {
    gl.uniform3fv(u.bg, light ? LIGHT_BG_COLOR : BG_COLOR);
    gl.uniform1f(u.light, light ? 1 : 0);
    blobRGB.fill(0);
    blobFixed.fill(0);
    for (let i = 0; i < BLOB_COUNT; i++) {
      const colour = light ? LIGHT_BLOBS[i % LIGHT_BLOBS.length] : FIXED_ACCENTS[i];
      if (colour) {
        blobRGB[i * 3 + 0] = colour[0];
        blobRGB[i * 3 + 1] = colour[1];
        blobRGB[i * 3 + 2] = colour[2];
        blobFixed[i] = 1;
      }
    }
    gl.uniform3fv(u.blobRGB, blobRGB);
    gl.uniform1fv(u.blobFixed, blobFixed);
  }
  applyPalette(opts.light);

  // One-time random layout, jittered from an even ring so blobs never clump.
  const seeds: BlobSeed[] = Array.from({ length: BLOB_COUNT }, (_, i) => {
    const ang = (i / BLOB_COUNT) * TAU + (Math.random() - 0.5) * 0.8;
    const radius = 0.34 + Math.random() * 0.24;
    return {
      bx: Math.cos(ang) * radius * 1.6,
      by: Math.sin(ang) * radius,
      r: 0.55 + Math.random() * 0.35,
      phase: Math.random() * TAU,
      hue: i / BLOB_COUNT + (Math.random() - 0.5) * 0.08,
    };
  });

  const blobData = new Float32Array(BLOB_COUNT * 4);
  const hueData = new Float32Array(BLOB_COUNT);
  for (let i = 0; i < BLOB_COUNT; i++) hueData[i] = seeds[i].hue;

  let aspect = 1;

  function writeBlobs() {
    for (let i = 0; i < BLOB_COUNT; i++) {
      const s = seeds[i];
      blobData[i * 4 + 0] = s.bx * aspect;
      blobData[i * 4 + 1] = s.by;
      blobData[i * 4 + 2] = s.r;
      blobData[i * 4 + 3] = s.phase;
    }
    gl.uniform4fv(u.blobs, blobData);
    gl.uniform1fv(u.blobHue, hueData);
  }

  const hueSeed = Math.random();
  let raf = 0;
  let running = false;
  let visible = true;
  let paused = opts.paused;
  let lastFrame = 0;
  let clock = 0;
  let mouseX = 0; // final swirl centre fed to the shader (continuously eased)
  let mouseY = 0;
  let targetX = 0; // raw pointer target (fine pointer only)
  let targetY = 0;
  let lastActive = -1e9; // timestamp of last pointer activity; starts "idle"
  // Distinct from lastActive: that one drives the cursor->ambient blend and is
  // deliberately seeded in the past so the field opens on its own drift. This
  // one is the idle-freeze clock, so it starts now — a freshly opened app is
  // "active" and animates for IDLE_FREEZE_MS before settling.
  let lastInteraction = performance.now();
  let tapX = 0; // last tap location (touch only)
  let tapY = 0;
  let tapEnergy = 0; // decaying impulse from a tap (touch only)
  const frameInterval = frameIntervalFor(opts.fpsCap);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, opts.dprCap);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    aspect = w / h;
    gl.uniform1f(u.aspect, aspect);
    writeBlobs();
    // Resizing a canvas clears it. While paused there is no frame coming to
    // refill it, so a resize would leave the backdrop blank until something
    // resumed the loop — and one of the pause reasons is now "idle", which can
    // last indefinitely. Redraw once from the uniforms already in place: that
    // is exactly the frozen frame, at the new size.
    if (!running) gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Restart the idle-freeze clock, and unfreeze if it had already fired.
   * `sync()` re-checks every pause reason, so this can't resume a field that is
   * offscreen, backgrounded or behind a sheet.
   */
  function markActive() {
    lastInteraction = performance.now();
    if (!running) sync();
  }

  function onPointerMove(e: PointerEvent) {
    // The cursor still steers the swirl while the field happens to be awake —
    // it just no longer counts as a reason to be awake. On a mouse that
    // distinction is the whole fix: see IDLE_FREEZE_MS_POINTER.
    targetX = e.clientX / window.innerWidth - 0.5;
    targetY = e.clientY / window.innerHeight - 0.5;
    lastActive = e.timeStamp;
    if (opts.wakeOnPointerMove) markActive();
  }

  // Touch scrolling is the one interaction that does NOT reliably produce
  // pointermove — the browser takes the gesture over and fires pointercancel —
  // so scrolling a list would otherwise leave the backdrop frozen behind it.
  // Capture phase: the scrollers that matter (records list, sheets) are nested,
  // and their scroll events don't bubble to window.
  const onScroll = () => markActive();

  // A tap drops an impulse: the colour swirl surges toward the touch point and
  // the flow briefly speeds up, then eases back to the ambient drift. This is
  // intentionally touch-only — on web (fine pointer) a click does nothing, so
  // there's no bounce/flash from clicking.
  function onPointerDown(e: PointerEvent) {
    // Before the touch-only guard: a tap has to un-freeze the field on every
    // device, even where it doesn't drop a swirl impulse.
    markActive();
    if (!opts.autoMouse) return;
    tapX = e.clientX / window.innerWidth - 0.5;
    tapY = e.clientY / window.innerHeight - 0.5;
    tapEnergy = 1;
    lastActive = e.timeStamp;
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    // Settle: hold the current frame once nothing has happened for a while.
    // stop() cancels the request just scheduled above, so this really does end
    // the loop rather than idling one no-op callback per vsync. Only the idle
    // clock is checked here — the other three gates have their own events and
    // go through sync().
    if (performance.now() - lastInteraction > opts.idleFreezeMs) {
      stop();
      return;
    }
    if (frameInterval > 0 && now - lastFrame < frameInterval) return;
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0.016;
    lastFrame = now;
    // Tap adds a brief surge on top of the constant ambient advance (touch only;
    // tapEnergy stays 0 on web).
    clock += dt * 0.3 * opts.speed * (1 + tapEnergy * 1.4);

    // Ambient self-drive: a slow orbit so the field keeps flowing untouched.
    const ax = 0.32 * Math.sin(clock * 0.7);
    const ay = 0.26 * Math.cos(clock * 0.55);

    // Blend from cursor-follow to the ambient orbit *gradually* once the pointer
    // goes still (idleT ramps 0->1 over ~2.2s), so re-engaging the drift never
    // steps the target and mouseX never lurches — no bounce, no brightness flash.
    const idleRaw = opts.autoMouse ? 1 : Math.min(Math.max((now - lastActive - 500) / 2200, 0), 1);
    const idleT = idleRaw * idleRaw * (3 - 2 * idleRaw); // smoothstep: zero onset kick
    const desiredX = targetX + (ax - targetX) * idleT;
    const desiredY = targetY + (ay - targetY) * idleT;
    mouseX += (desiredX - mouseX) * 0.05;
    mouseY += (desiredY - mouseY) * 0.05;

    // Decaying tap impulse (touch only) pulls the centre toward the tap point.
    if (tapEnergy > 0) {
      mouseX += (tapX - mouseX) * tapEnergy * 0.6;
      mouseY += (tapY - mouseY) * tapEnergy * 0.6;
      tapEnergy *= Math.pow(0.5, dt / 0.5); // ~0.5s half-life
      if (tapEnergy < 0.002) tapEnergy = 0;
    }

    gl.uniform1f(u.time, clock);
    gl.uniform2f(u.mouse, mouseX * aspect, -mouseY);
    // Gentle hue coupling so cursor movement nudges — not snaps — the palette.
    gl.uniform1f(u.hueShift, hueSeed + clock * 0.03 + mouseX * 0.2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function start() {
    if (running) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // Four independent reasons to not be drawing (see shouldAnimate). start() and
  // stop() are both idempotent, so this can be called from any of them.
  function sync() {
    const animate = shouldAnimate({
      visible,
      documentHidden: document.hidden,
      paused,
      msSinceInteraction: performance.now() - lastInteraction,
      idleFreezeMs: opts.idleFreezeMs,
    });
    if (animate) start();
    else stop();
  }

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      sync();
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  // Coming back to the tab counts as interaction: otherwise a session parked
  // for a minute would return to a field that is already past its idle window
  // and stays frozen until the first touch.
  const onVisibility = () => {
    if (!document.hidden) lastInteraction = performance.now();
    sync();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("keydown", onScroll);

  resize();
  sync();

  return {
    resize,
    setPalette(light: boolean) {
      if (paletteLight === light) return;
      paletteLight = light;
      applyPalette(light);
      // Nudge one frame so the new palette shows even if the field is paused
      // (e.g. reduced-motion or offscreen) at the moment the theme flips.
      if (!running) gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    setPaused(paused: boolean) {
      if (paused === paused) return;
      paused = paused;
      // Closing a sheet is an interaction, and it re-exposes the field — reset
      // the idle clock so it animates again rather than coming back frozen
      // because the idle window elapsed while the sheet was up.
      if (!paused) lastInteraction = performance.now();
      // Resuming leaves `clock` where it stopped and start() clears lastFrame,
      // so the first frame back uses a nominal dt rather than the whole time
      // the sheet was open - the field picks up exactly where it froze.
      sync();
    },
    dispose() {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("keydown", onScroll);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      // NB: deliberately not calling WEBGL_lose_context.loseContext() — a canvas
      // element can't re-acquire a WebGL context after it's force-lost, which
      // would break React StrictMode's mount/unmount/remount cycle in dev.
    },
  };
}

export function GlassBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let scene: Scene | null = null;
    const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
    // Set by App.tsx whenever any sheet/dialog/drawer is open. This component is
    // a sibling of <App />, not a child, so an attribute on <html> is the seam.
    // Scrolling counts as well as an overlay: during a flick the field is a
    // full-screen shader competing with the thing the finger is actually
    // moving, and nobody is watching it drift. It restarts when the page
    // settles, 140ms later.
    const isPaused = () =>
      document.documentElement.hasAttribute("data-overlay") ||
      document.documentElement.hasAttribute("data-scrolling");
    // The per-device switch in 個人資料 (see backgroundStore). Read from the
    // attribute rather than from storage so the toggle takes effect on the spot.
    const motionOff = () => document.documentElement.getAttribute("data-bg-motion") === "off";

    const build = () => {
      if (scene || reduce.matches || motionOff()) return;
      const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      scene = createScene(canvas, {
        // Resolution stays capped, and phones are no longer the exception.
        //
        // The field has no edges, no text and no fine structure, so device
        // pixels buy nothing you can see here — which is not an argument, it is
        // something we checked: 1.25×, 1.5× and native side by side on a real
        // phone, and the answer was "I can't tell them apart". A 375×812 screen
        // at 1.25× is 476k fragments a frame against 1.2M at native 2×, and
        // more like a third of the work on the 3× screens where this matters
        // most.
        //
        // Phones were on 1.5× until then. Nothing was measured to justify that
        // half-step; it was caution, and caution here costs battery on the
        // devices least able to spare it.
        //
        // The frame rate is not capped anywhere any more — desktop first, then
        // phones, both asked for directly. The 30fps cap on phones was the
        // 2026-08 heat fix and it was aimed at the wrong thing: the field is
        // one full-screen shader, but what was actually stacked on top of it
        // was up to nine backdrop-filter layers, one of them per expense ROW,
        // each a full-area GPU blur every frame. Those are gone (see the note
        // in app-home.css), which is what makes giving this back reasonable
        // rather than a straight trade of heat for smoothness.
        //
        // What still holds the cost down on a phone, and matters more than the
        // cap ever did: the six-second settle below means an idle screen renders
        // nothing at all, and 個人資料 has a switch for anyone who would rather
        // not pay for the field at all.
        dprCap: 1.25,
        fpsCap: 0,
        autoMouse: coarse,
        speed: coarse ? 1.8 : 1,
        // Asked for directly: on a mouse the field should not stop drifting a
        // couple of seconds after you stop touching anything. Phones keep the
        // six-second settle — that one is the 2026-08 heat/throttle fix, not a
        // preference, and a phone left open in a pocket has nobody watching it.
        idleFreezeMs: coarse ? IDLE_FREEZE_MS : IDLE_FREEZE_NEVER,
        // Moot while the budget is infinite (there is nothing to wake from),
        // kept honest for the day a finite budget comes back.
        wakeOnPointerMove: coarse,
        light: isLight(),
        paused: isPaused(),
      });

      // createScene returns null when this machine has no WebGL, or a context
      // that turned out to be software-rendered. Say so on the root element so
      // the switch in 個人資料 can explain itself instead of looking dead.
      if (!scene) document.documentElement.setAttribute(BACKGROUND_UNAVAILABLE_ATTR, "");
      else document.documentElement.removeAttribute(BACKGROUND_UNAVAILABLE_ATTR);
    };

    const teardown = () => {
      scene?.dispose();
      scene = null;
    };

    const onPreferenceChange = () => {
      if (reduce.matches || motionOff()) teardown();
      else build();
    };

    const onResize = () => scene?.resize();

    // Repaint the palette live when the day/night toggle flips data-theme, and
    // pause/resume when an overlay opens or closes. Both are attribute flips on
    // <html>, so one observer covers them; each handler no-ops when its own
    // attribute is the one that did not change.
    const rootObserver = new MutationObserver(() => {
      // Order matters: tear down BEFORE touching the scene, and build after —
      // flipping the switch off must stop the GPU work in the same tick the
      // person taps it, which is the entire point of the setting.
      if (motionOff()) teardown();
      else build();
      scene?.setPalette(isLight());
      scene?.setPaused(isPaused());
    });
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-overlay", "data-scrolling", "data-bg-motion"],
    });

    build();
    // Switched off is a choice, not a limitation: make sure the profile row
    // does not inherit an "unavailable" flag from a previous page's refusal.
    if (motionOff() && readStoredBackgroundMotion() === "off") {
      document.documentElement.removeAttribute(BACKGROUND_UNAVAILABLE_ATTR);
    }
    reduce.addEventListener("change", onPreferenceChange);
    window.addEventListener("resize", onResize);

    return () => {
      rootObserver.disconnect();
      reduce.removeEventListener("change", onPreferenceChange);
      window.removeEventListener("resize", onResize);
      teardown();
    };
  }, []);

  return <canvas ref={canvasRef} className="glass-bg-canvas" aria-hidden="true" />;
}
