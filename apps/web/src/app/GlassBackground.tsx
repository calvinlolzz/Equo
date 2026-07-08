import { useEffect, useRef } from "react";

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
//   0.34 green   0.44 mint (#6de2b8)   0.50 teal   0.78 violet   0.92 dark pink
const HUE_BASE = 0.34;
const HUE_SPAN = 0.6;
// Dark Equo base colour the blobs melt into (matches the body backdrop).
const BG_COLOR: [number, number, number] = [0x07 / 255, 0x13 / 255, 0x0f / 255];

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
uniform vec3 u_bg;
uniform vec4 u_blobs[${BLOB_COUNT}];
uniform float u_blobHue[${BLOB_COUNT}];
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
    float hue = ${HUE_BASE.toFixed(3)} + ${HUE_SPAN.toFixed(3)} * t;
    float cool = smoothstep(0.52, 0.80, hue); // 0 = green side, 1 = violet/pink
    acc += hsv2rgb(vec3(hue, 0.60 + 0.14 * cool, 0.92 - 0.30 * cool)) * f;
    wsum += f;
  }
  vec3 blobCol = wsum > 0.0001 ? acc / wsum : u_bg;
  vec3 col = mix(u_bg, blobCol, clamp(wsum, 0.0, 1.0));

  // Caustics: two crossing waves multiplied -> sparse bright veins (water feel)
  float caustic = sin((sp.x + sp.y) * 13.0 + u_time)
                * sin((sp.x - sp.y) * 11.0 - u_time * 0.7);
  col += vec3(0.035) * smoothstep(0.65, 1.0, caustic);

  // Gentle edge vignette so central content stays readable
  float vig = smoothstep(1.15, 0.35, length(p));
  col *= mix(0.82, 1.0, vig);

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
}

interface Scene {
  dispose: () => void;
  resize: () => void;
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
    blobCount: gl.getUniformLocation(program, "u_blobCount"),
  };

  gl.uniform3fv(u.bg, BG_COLOR);
  gl.uniform1i(u.blobCount, BLOB_COUNT);

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
  let lastFrame = 0;
  let clock = 0;
  let mouseX = 0; // final swirl centre fed to the shader (continuously eased)
  let mouseY = 0;
  let targetX = 0; // raw pointer target (fine pointer only)
  let targetY = 0;
  let lastActive = -1e9; // timestamp of last pointer activity; starts "idle"
  let tapX = 0; // last tap location (touch only)
  let tapY = 0;
  let tapEnergy = 0; // decaying impulse from a tap (touch only)
  const frameInterval = opts.fpsCap > 0 && opts.fpsCap < 60 ? 1000 / opts.fpsCap : 0;

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
  }

  function onPointerMove(e: PointerEvent) {
    targetX = e.clientX / window.innerWidth - 0.5;
    targetY = e.clientY / window.innerHeight - 0.5;
    lastActive = e.timeStamp;
  }

  // A tap drops an impulse: the colour swirl surges toward the touch point and
  // the flow briefly speeds up, then eases back to the ambient drift. This is
  // intentionally touch-only — on web (fine pointer) a click does nothing, so
  // there's no bounce/flash from clicking.
  function onPointerDown(e: PointerEvent) {
    if (!opts.autoMouse) return;
    tapX = e.clientX / window.innerWidth - 0.5;
    tapY = e.clientY / window.innerHeight - 0.5;
    tapEnergy = 1;
    lastActive = e.timeStamp;
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (frameInterval > 0 && now - lastFrame < frameInterval) return;
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0.016;
    lastFrame = now;
    // Tap adds a brief surge on top of the constant ambient advance (touch only;
    // tapEnergy stays 0 on web).
    clock += dt * 0.3 * opts.speed * (1 + tapEnergy * 1.4);

    // Ambient self-drive: a slow orbit so the field keeps flowing untouched.
    const ax = 0.32 * Math.sin(clock * 0.7);
    const ay = 0.26 * Math.cos(clock * 0.55);

    // Pick a single target for the swirl centre: the ambient drift when idle or
    // on touch, else the cursor. Crucially, mouseX/Y is eased *continuously*
    // toward it — the target may switch abruptly but the value never jumps, so
    // there's no sudden brightness flash when you start or stop moving.
    const idle = opts.autoMouse || now - lastActive > 1100;
    const desiredX = idle ? ax : targetX;
    const desiredY = idle ? ay : targetY;
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

  function sync() {
    if (visible && !document.hidden) start();
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

  const onVisibility = () => sync();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerdown", onPointerDown);

  resize();
  sync();

  return {
    resize,
    dispose() {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
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

    const build = () => {
      if (scene || reduce.matches) return;
      const small = window.innerWidth < 700;
      const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      scene = createScene(canvas, {
        dprCap: small ? 1.5 : 2,
        fpsCap: small ? 30 : 60,
        autoMouse: coarse,
        speed: coarse ? 1.8 : 1,
      });
    };

    const teardown = () => {
      scene?.dispose();
      scene = null;
    };

    const onPreferenceChange = () => {
      if (reduce.matches) teardown();
      else build();
    };

    const onResize = () => scene?.resize();

    build();
    reduce.addEventListener("change", onPreferenceChange);
    window.addEventListener("resize", onResize);

    return () => {
      reduce.removeEventListener("change", onPreferenceChange);
      window.removeEventListener("resize", onResize);
      teardown();
    };
  }, []);

  return <canvas ref={canvasRef} className="glass-bg-canvas" aria-hidden="true" />;
}
