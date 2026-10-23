/**
 * Ocean worker: owns the ASCII-sharks simulation and renders it straight into a
 * transferred OffscreenCanvas, so the UI thread never runs the sim or the draw
 * calls. It also hands small snapshots back for the liquid-glass sidebar.
 *
 * Protocol (main → worker):
 *   init     { canvas, width, height, dpr, maxFps, sharks, fontFamily, reducedMotion, paused, initialStatic }
 *   resize   { width, height, dpr }
 *   fps      { fps }
 *   reduce   { reducedMotion }
 *   pause / resume
 *   pointer  { x, y, active }
 *   splash   { x, y }
 *   snapshot { requestId, rect: {x,y,w,h}, cw, ch, since, force? }
 *   dispose
 * Worker → main:
 *   snapshot { requestId, bitmap?, frames, skipped?, reason? }
 */
import { AsciiRenderer } from "./ascii-sharks/renderer";
import { World, type SharkSpec } from "./ascii-sharks/world";

const STEP = 1 / 60;
const MAX_STEPS = 4;
const FRAME_EPSILON = 0.5;

let canvas: OffscreenCanvas | null = null;
let renderer: AsciiRenderer | null = null;
let world: World | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let snapshotCanvas: OffscreenCanvas | null = null;
let maxFps = 60;
let dpr = 1;
let paused = false;
let reduced = false;
let initialStatic = false;
let disposed = false;
let acc = 0;
let last = 0;
let nextDraw = 0;
let frames = 0;
let width = 0;
let height = 0;

function stop() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function schedule() {
  stop();
  if (paused || reduced || disposed || !renderer) return;
  last = performance.now();
  nextDraw = last + 1000 / maxFps;
  acc = 0;
  timer = setTimeout(frame, 1000 / maxFps);
}

function frame() {
  timer = null;
  if (paused || reduced || disposed || !renderer || !world) return;
  const now = performance.now();
  if (now + FRAME_EPSILON < nextDraw) {
    timer = setTimeout(frame, nextDraw - now);
    return;
  }
  const interval = 1000 / maxFps;
  nextDraw += Math.max(1, Math.floor((now - nextDraw) / interval) + 1) * interval;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    world.step(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;
  renderer.render(world, dt);
  frames++;
  const wait = Math.max(0, nextDraw - performance.now());
  timer = setTimeout(frame, wait);
}

function drawStill(warmup = false) {
  if (!renderer || !world) return;
  if (warmup && world.time < 4) for (let i = 0; i < 240; i++) world.step(STEP);
  renderer.render(world, STEP);
  frames++;
}

function resize(nextWidth: number, nextHeight: number, nextDpr: number) {
  width = Math.max(1, Math.round(nextWidth));
  height = Math.max(1, Math.round(nextHeight));
  dpr = Math.max(1, Math.min(2, nextDpr));
  if (!renderer || !world) return;
  renderer.resize(width, height, dpr);
  world.resize(width, height, renderer.cellWidth, renderer.cellHeight);
  if (reduced || paused) drawStill(frames === 0 && (reduced || initialStatic));
}

function makeRenderer(nextCanvas: OffscreenCanvas, fontFamily: string, sharks: SharkSpec[]) {
  canvas = nextCanvas;
  renderer = new AsciiRenderer(nextCanvas as unknown as HTMLCanvasElement);
  renderer.setFontFamily(fontFamily || "ui-monospace, Menlo, monospace");
  world = new World(sharks);
}

function replySnapshot(
  requestId: string | number | undefined,
  rect: { x: number; y: number; w: number; h: number }, cw: number, ch: number,
  since: number, force: boolean,
) {
  const skip = (reason: string) => self.postMessage({ type: "snapshot", requestId, frames, skipped: true, reason });
  if (!canvas || disposed) return skip("unavailable");
  if (frames === since && !force) return skip("unchanged");
  if (!rect || ![rect.x, rect.y, rect.w, rect.h, cw, ch].every(Number.isFinite) ||
    rect.w <= 0 || rect.h <= 0 || cw <= 0 || ch <= 0) return skip("empty");
  let bitmap: ImageBitmap | null = null;
  try {
    const w = Math.max(1, Math.round(cw));
    const h = Math.max(1, Math.round(ch));
    if (!snapshotCanvas) snapshotCanvas = new OffscreenCanvas(w, h);
    if (snapshotCanvas.width !== w) snapshotCanvas.width = w;
    if (snapshotCanvas.height !== h) snapshotCanvas.height = h;
    const ctx = snapshotCanvas.getContext("2d");
    if (!ctx) return skip("unavailable");
    const sx = Math.max(0, rect.x * dpr);
    const sy = Math.max(0, rect.y * dpr);
    const sw = Math.min(canvas.width - sx, rect.w * dpr);
    const sh = Math.min(canvas.height - sy, rect.h * dpr);
    if (sw < 1 || sh < 1) return skip("empty");
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
    bitmap = snapshotCanvas.transferToImageBitmap();
    self.postMessage({ type: "snapshot", requestId, bitmap, frames }, { transfer: [bitmap] } as unknown as StructuredSerializeOptions);
  } catch {
    bitmap?.close();
    skip("failed");
  }
}

self.onmessage = (event: MessageEvent) => {
  const data = event.data as Record<string, any>;
  switch (data?.type) {
    case "init": {
      makeRenderer(data.canvas as OffscreenCanvas, data.fontFamily ?? "", (data.sharks ?? []) as SharkSpec[]);
      maxFps = Math.max(5, Math.min(60, data.maxFps ?? 60));
      reduced = data.reducedMotion === true;
      initialStatic = data.initialStatic === true;
      paused = data.paused === true || initialStatic;
      resize(data.width, data.height, data.dpr ?? 1);
      schedule();
      break;
    }
    case "resize":
      resize(data.width, data.height, data.dpr ?? dpr);
      break;
    case "fps":
      maxFps = Math.max(5, Math.min(60, data.fps ?? 60));
      schedule();
      break;
    case "reduce":
      reduced = data.reducedMotion === true;
      if (reduced) {
        if (world) world.pointer.active = false;
        stop();
        drawStill();
      } else {
        schedule();
      }
      break;
    case "pause":
      paused = true;
      if (world) world.pointer.active = false;
      stop();
      break;
    case "resume":
      paused = false;
      schedule();
      break;
    case "pointer":
      if (world) {
        world.pointer.x = data.x;
        world.pointer.y = data.y;
        world.pointer.active = !paused && !reduced && data.active === true;
      }
      break;
    case "splash":
      if (!paused && !reduced && !disposed) world?.splash(data.x, data.y);
      break;
    case "snapshot":
      replySnapshot(data.requestId, data.rect, data.cw, data.ch, data.since ?? -1, data.force === true);
      break;
    case "dispose":
      disposed = true;
      stop();
      renderer = null;
      world = null;
      canvas = null;
      snapshotCanvas = null;
      break;
  }
};
