import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const boundaries = {
  name: "scheduling-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /\/(renderer|world)$|^\.\/(renderer|world)$/ }, ({ path }) => ({ path, namespace: "boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: path.endsWith("world") ? `
      export class World {
        time = 0; steps = 0; splashes = []; pointer = {};
        constructor(sharks = [], fishCount = 3) { this.sharks = sharks; this.fish = Array.from({length:fishCount ?? 3},()=>({})); globalThis.worlds.push(this); }
        resize() {}
        step(dt) { this.steps++; this.time += dt; }
        splash(x, y) { this.splashes.push({x, y}); }
      }
    ` : `
      export class AsciiRenderer {
        cellWidth = 8; cellHeight = 16; draws = [];
        constructor(canvas) { this.canvas = canvas; globalThis.renderers.push(this); }
        setFontFamily() {}
        resize(w, h, dpr) { this.canvas.width = Math.round(w*dpr); this.canvas.height = Math.round(h*dpr); }
        render(world, dt, fieldStep = 0) { this.draws.push({time:world.time, dt, fieldStep}); }
      }
    ` }));
  },
};
async function bundle(entry, name) {
  const output = await build({ entryPoints: [resolve(root, entry)], bundle: true, write: false, format: "iife", globalName: name, plugins: [boundaries] });
  return output.outputFiles[0].text;
}
const engineCode = await bundle("src/ascii-sharks/engine.ts", "EngineModule");
const workerCode = await bundle("src/ocean-worker.ts", "WorkerModule");

function environment({ worker = false, reduced = false } = {}) {
  let now = 0, id = 0;
  const callbacks = new Map(), timers = new Map(), observers = [], messages = [], bitmaps = [];
  class Events {
    listeners = new Map();
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
  }
  class Canvas {
    width = 300; height = 150;
    constructor(w = 300, h = 150) { this.width = w; this.height = h; }
    getContext() { return { clearRect() {}, drawImage() {} }; }
    transferToImageBitmap() { const bitmap = { width: this.width, height: this.height, closed: false, close() { this.closed = true; } }; bitmaps.push(bitmap); return bitmap; }
    getBoundingClientRect() { return { width: 900, height: 600, left: 0, top: 0 }; }
  }
  const window = new Events(), motion = new Events(); motion.matches = reduced;
  window.matchMedia = () => motion; window.devicePixelRatio = 1;
  const document = { documentElement: new Events() };
  const globals = {
    worlds: [], renderers: [], window, document,
    performance: { now: () => now },
    getComputedStyle: () => ({ fontFamily: "monospace" }),
    requestAnimationFrame(fn) { callbacks.set(++id, fn); return id; },
    cancelAnimationFrame(handle) { callbacks.delete(handle); },
    setTimeout(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(handle) { timers.delete(handle); },
    ResizeObserver: class { constructor(fn) { observers.push(fn); } observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    OffscreenCanvas: Canvas,
    self: { postMessage(data) { if (data.bitmap && globals.failBitmapPost) throw new Error("Transfer failed"); messages.push(data); } },
  };
  runInNewContext(worker ? workerCode : engineCode, globals);
  return {
    globals, callbacks, timers, messages, bitmaps, window, motion,
    get world() { return globals.worlds[0]; },
    get renderer() { return globals.renderers[0]; },
    create(options = {}) { return new globals.EngineModule.OceanEngine(new Canvas(), undefined, options); },
    send(data) { globals.self.onmessage({ data }); },
    init(options = {}) { this.send({ type: "init", canvas: new Canvas(), width: 900, height: 600, dpr: 1, ...options }); },
    frame(time) { now = time; const due = [...callbacks.values()]; callbacks.clear(); for (const fn of due) fn(now); },
    timer(time) { now = time; const first = [...timers.entries()].sort((a,b) => a[1].at-b[1].at)[0]; assert.ok(first); timers.delete(first[0]); first[1].fn(); },
    resize() { for (const fn of observers) fn(); },
    advance(time) { now = time; },
  };
}

for (const hz of [60, 90, 120, 144]) for (const cap of [30, 45, 60, 90, 120, 144]) {
  test(`local ${hz}Hz rAF respects ${cap}fps without rounding down`, () => {
    const env = environment(); const engine = env.create({ maxFps: cap });
    for (let i = 1; i <= hz * 2; i++) env.frame(i * 1000 / hz);
    const expected = Math.min(hz, cap) * 2;
    assert.ok(Math.abs(engine.frames - expected) <= 1, `${engine.frames} frames, expected ${expected}`);
    assert.ok(env.world.time > 1.94 && env.world.time <= 2.01, "simulation follows elapsed active time");
    engine.destroy(); assert.equal(env.callbacks.size, 0);
  });
}

test("local pause resize redraws without advancing the world or restarting callbacks", () => {
  const env = environment(); let notified = 0;
  const engine = env.create({ onFrame: () => notified++ });
  env.frame(17); env.frame(34); engine.pause();
  const time = env.world.time, frames = engine.frames;
  env.advance(5000); env.resize();
  assert.equal(env.world.time, time); assert.equal(engine.frames, frames + 1);
  assert.equal(env.callbacks.size, 0); assert.equal(notified, engine.frames);
  engine.resume(); env.frame(5017);
  assert.ok(env.world.time - time < 0.02, "resume excludes time spent paused");
  engine.destroy();
});

for (const worker of [false, true]) for (const cap of [90, 120, 144]) {
  test(`${worker ? "Worker" : "local"} ${cap}fps advances every nominal frame in finer motion steps`, () => {
    const env = environment({ worker });
    const engine = worker ? (env.init({ maxFps: cap }), null) : env.create({ maxFps: cap });
    for (let i = 1; i <= cap; i++) worker ? env.timer(i * 1000 / cap) : env.frame(i * 1000 / cap);
    assert.equal(env.renderer.draws.length, cap);
    assert.equal(env.world.steps, cap, "high refresh must advance the world, not only redraw a 60 Hz state");
    env.renderer.draws.forEach((draw, i) => assert.ok(Math.abs(draw.time - (i + 1) / cap) < 1e-9));
    assert.ok(env.renderer.draws.every(draw => draw.fieldStep === 1 / 60));
    worker ? env.send({ type: "pause" }) : engine.pause();
    worker ? env.send({ type: "resize", width: 900, height: 600, dpr: 1 }) : env.resize();
    assert.equal(env.renderer.draws.at(-1).fieldStep, 0, "static redraw keeps the original wake-field update");
    engine?.destroy();
  });
}

test("144fps Worker deadlines reject early wakeups and keep phase after jitter and stalls", () => {
  const env = environment({ worker: true }); env.init({ maxFps: 144 });
  env.timer(5); assert.equal(env.renderer.draws.length, 0);
  env.timer(7); env.timer(15);
  assert.equal(env.renderer.draws.length, 2);
  assert.ok(Math.abs([...env.timers.values()][0].at - 1000 / 48) < 1e-9);
  env.timer(1000);
  assert.equal(env.renderer.draws.length, 3, "a long stall must not render an unbounded burst");
  assert.ok(env.world.time < .1, "catch-up remains bounded to the original simulation-time budget");
  assert.ok([...env.timers.values()][0].at > 1000, "next deadline is in the future");
});

for (const worker of [false, true]) {
  test(`${worker ? "Worker" : "local"} high-refresh wake cadence preserves the configured speed multiplier`, () => {
    for (const cap of [60, 144]) for (const speed of [.25, 2]) {
      const env = environment({ worker });
      const engine = worker ? (env.init({ maxFps: cap, speed }), null) : env.create({ maxFps: cap, speed });
      worker ? env.timer(1000 / cap) : env.frame(1000 / cap);
      assert.equal(env.renderer.draws.at(-1).fieldStep, cap > 60 ? speed / 60 : 0);
      engine?.destroy();
    }
  });
  test(`${worker ? "Worker" : "local"} metrics are passive counters with no bitmap or playback side effects`, () => {
    const env = environment({ worker });
    const engine = worker ? (env.init({ paused: true, fishCount: 5, maxFps: 144 }), null) : env.create({ paused: true, fishCount: 5, maxFps: 144 });
    const sample = (requestId) => {
      if (!worker) return engine.getMetrics();
      env.send({ type: "metrics", requestId });
      const result = env.messages.at(-1); assert.equal(result.type, "metrics"); assert.equal(result.requestId, requestId); return result;
    };
    const before = sample("paused");
    assert.equal(before.running, false); assert.equal(before.fishCount, 5); assert.equal(before.sharkCount, 0);
    assert.equal(before.width, 900); assert.equal(before.height, 600); assert.equal(before.dpr, 1); assert.equal(before.maxFps, 144);
    env.advance(1234); const later = sample(2);
    assert.equal(later.time - before.time, 1234); assert.equal(later.frames, before.frames); assert.equal(later.simulationTime, before.simulationTime);
    assert.equal(env.callbacks.size + env.timers.size, 0); assert.equal(env.bitmaps.length, 0);
    worker ? env.send({ type: "resume" }) : engine.resume();
    const handles = [...(worker ? env.timers : env.callbacks).keys()]; assert.equal(sample("running").running, true);
    assert.deepEqual([...(worker ? env.timers : env.callbacks).keys()], handles, "sampling does not reset deadlines");
    worker ? env.send({ type: "fps", fps: 999 }) : engine.setMaxFps(999); assert.equal(sample("clamped").maxFps, 144);
    worker ? env.send({ type: "dispose" }) : engine.destroy(); assert.equal(sample("disposed").running, false);
    assert.equal(env.callbacks.size + env.timers.size, 0); assert.equal(env.bitmaps.length, 0);
  });
}

test("initial static settles once, while ordinary initial pause does not fast-forward", () => {
  for (const worker of [false, true]) for (const initialStatic of [false, true]) {
    const env = environment({ worker });
    const engine = worker ? (env.init({ paused: true, initialStatic }), null) : env.create({ paused: true, initialStatic });
    assert.equal(env.world.steps, initialStatic ? 240 : 0);
    assert.equal(env.renderer.draws.length, 1);
    assert.equal(env.callbacks.size + env.timers.size, 0);
    const time = env.world.time;
    worker ? env.send({ type: "resize", width: 1000, height: 700, dpr: 1 }) : env.resize();
    assert.equal(env.world.time, time); assert.equal(env.renderer.draws.length, 2);
    assert.equal(env.callbacks.size + env.timers.size, 0);
    engine?.destroy();
  }
});

test("motion preference change freezes the current world instead of warming it again", () => {
  const env = environment(); const engine = env.create(); env.frame(17);
  const time = env.world.time;
  env.motion.matches = true; env.motion.dispatch("change");
  assert.equal(env.world.time, time); assert.equal(env.callbacks.size, 0);
  engine.destroy();
});

test("controls and paused/reduced scenes ignore water splashes, blank ocean still responds", () => {
  const env = environment(); const engine = env.create();
  const blank = { clientX: 50, clientY: 50, button: 0, target: { closest: () => null } };
  const control = { ...blank, composedPath: () => [{ matches: (selector) => selector.split(",").includes("button") }] };
  env.window.dispatch("pointermove", blank); assert.equal(env.world.pointer.active, true);
  env.window.dispatch("pointermove", control); assert.equal(env.world.pointer.active, false);
  env.window.dispatch("pointerdown", control); assert.equal(env.world.splashes.length, 0);
  env.window.dispatch("pointerdown", { ...blank, target: { closest: () => ({}) } }); assert.equal(env.world.splashes.length, 0);
  env.window.dispatch("pointerdown", blank); assert.equal(env.world.splashes.length, 1);
  engine.pause(); env.window.dispatch("pointermove", blank); assert.equal(env.world.pointer.active, false);
  env.window.dispatch("pointerdown", blank); assert.equal(env.world.splashes.length, 1);
  engine.resume(); env.motion.matches = true; env.window.dispatch("pointerdown", blank); assert.equal(env.world.splashes.length, 1);
  engine.destroy();
});

test("Worker deadlines reject early timers and preserve phase after late timers", () => {
  const env = environment({ worker: true }); env.init({ maxFps: 60 });
  env.timer(10); assert.equal(env.renderer.draws.length, 0);
  env.timer(17); env.timer(35);
  assert.equal(env.renderer.draws.length, 2);
  assert.ok(Math.abs([...env.timers.values()][0].at - 50) < 0.01, "target stays at 50ms, not 51.67ms after a late frame");
  env.send({ type: "pause" }); assert.equal(env.timers.size, 0);
  env.send({ type: "pointer", x: 2, y: 3, active: true }); assert.equal(env.world.pointer.active, false);
  const time = env.world.time;
  env.send({ type: "resize", width: 1200, height: 800, dpr: 2 });
  assert.equal(env.renderer.draws.length, 3); assert.equal(env.world.time, time); assert.equal(env.timers.size, 0);
  env.send({ type: "splash", x: 2, y: 3 }); assert.equal(env.world.splashes.length, 0);
  env.send({ type: "fps", fps: 45 }); assert.equal(env.timers.size, 0);
  env.advance(5000); env.send({ type: "resume" }); env.timer(5023);
  assert.ok(env.world.time - time < 0.04);
});

test("Worker snapshot acknowledges unchanged, force, invalid, failed, and disposed requests", () => {
  const env = environment({ worker: true }); env.init({ initialStatic: true });
  const request = { type: "snapshot", rect: { x: 0, y: 0, w: 200, h: 300 }, cw: 100, ch: 150, since: -1 };
  env.send({ ...request, requestId: "first" });
  const first = env.messages.at(-1); assert.equal(first.requestId, "first"); assert.ok(first.bitmap); assert.equal(first.frames, 1);
  env.send({ ...request, requestId: "same", since: first.frames });
  assert.equal(env.messages.at(-1).requestId, "same"); assert.equal(env.messages.at(-1).reason, "unchanged"); assert.equal(env.messages.at(-1).skipped, true);
  env.send({ ...request, requestId: "geometry", since: first.frames, force: true, cw: 120 });
  assert.equal(env.messages.at(-1).bitmap.width, 120); assert.equal(env.messages.at(-1).frames, first.frames);
  env.send({ ...request, requestId: "empty", rect: { x: 2000, y: 0, w: 200, h: 300 } }); assert.equal(env.messages.at(-1).reason, "empty");
  env.send({ ...request, requestId: "invalid", cw: NaN }); assert.equal(env.messages.at(-1).reason, "empty");
  env.globals.failBitmapPost = true;
  env.send({ ...request, requestId: "failed" }); assert.equal(env.messages.at(-1).requestId, "failed"); assert.equal(env.messages.at(-1).reason, "failed"); assert.equal(env.bitmaps.at(-1).closed, true);
  env.globals.failBitmapPost = false;
  env.send({ type: "dispose" }); env.send({ ...request, requestId: "disposed" }); assert.equal(env.messages.at(-1).reason, "unavailable");
  assert.equal(env.messages.length, 7, "each request receives exactly one success or skip reply");
});
