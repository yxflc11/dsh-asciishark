import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "src/ascii-sharks/renderer.ts"), "utf8");
// Retain the original nearest-segment calculation as an independent differential
// oracle. Shape classification and Canvas commands are exercised unchanged.
const reference = source.replace(/    const \{ spine, arc \} = this;[\s\S]*?    const u = s \* L;/, `
    const { spine, arc } = this;
    let best = Infinity, bestS = 0, bestSign = 1, bestNx = 0, bestNy = 0;
    for (let k = 0; k < SHARK_NODES - 1; k++) {
      const ax = spine[k * 2], ay = spine[k * 2 + 1];
      const sx = spine[(k + 1) * 2] - ax, sy = spine[(k + 1) * 2 + 1] - ay;
      const len2 = sx * sx + sy * sy || 1;
      const u = clamp(((px - ax) * sx + (py - ay) * sy) / len2, 0, 1);
      const qx = ax + sx * u, qy = ay + sy * u;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        bestS = (arc[k] + u * len) / this.arcTotal;
        bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
        bestNx = (-sy / len) * bestSign;
        bestNy = (sx / len) * bestSign;
      }
    }
    const a = Math.sqrt(best), s = bestS;
    const u = s * L;`).replace(
  "      const bestNx = (-sy / len) * bestSign;\n      const bestNy = (sx / len) * bestSign;\n",
  "",
);

async function compile(rendererSource) {
  const output = await build({
    stdin: { contents: rendererSource + '\nexport { World } from "./world";', loader: "ts", resolveDir: resolve(root, "src/ascii-sharks") },
    bundle: true, write: false, format: "iife", globalName: "Api",
  });
  return output.outputFiles[0].text;
}
const [currentCode, referenceCode] = await Promise.all([compile(source), compile(reference)]);
function environment(code) {
  let seed = 20261023, randomCalls = 0, sqrtCalls = 0;
  const math = Object.create(Math);
  math.random = () => { randomCalls++; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  math.sqrt = (value) => { sqrtCalls++; return Math.sqrt(value); };
  class Canvas {
    width = 1; height = 1;
    constructor() {
      const commands = [];
      this.context = { commands, canvas: this };
      for (const name of ["setTransform", "fillRect", "beginPath", "moveTo", "lineTo", "stroke", "fillText"]) {
        this.context[name] = (...args) => commands.push([name, ...args]);
      }
      this.context.drawImage = (image, ...args) => commands.push(["drawImage", image.width, image.height, ...args]);
      for (const name of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline"]) {
        Object.defineProperty(this.context, name, { set(value) { commands.push([name, value]); } });
      }
    }
    getContext() { return this.context; }
  }
  const context = { Math: math, OffscreenCanvas: Canvas };
  runInNewContext(code, context);
  const canvas = new Canvas(), renderer = new context.Api.AsciiRenderer(canvas);
  return { canvas, renderer, World: context.Api.World, get randomCalls() { return randomCalls; }, get sqrtCalls() { return sqrtCalls; } };
}
const kinds = ["classic", "hammerhead", "tiger", "zebra", "greathammer", "mako", "thresher", "nurse"];
const fields = ["sharkFlag", "sharkShade", "sharkKey", "sharkDepth", "sharkKind", "sharkShadow", "energy", "heat"];
for (const [width, height, dpr] of [[390, 844, 1], [1440, 900, 1.5], [2560, 1440, 2]]) {
  test(`renderer retains original commands and fields at ${width}×${height} DPR ${dpr}`, () => {
    const a = environment(currentCode), b = environment(referenceCode);
    for (const env of [a, b]) env.renderer.resize(width, height, dpr);
    const world = new a.World(kinds.map((kind, i) => ({ kind, size: 0.4 + i * 0.07 })), 90);
    world.resize(width, height, a.renderer.cellWidth, a.renderer.cellHeight);
    for (let frame = 0; frame < 8; frame++) {
      world.pointer = { x: width * 0.45, y: height * 0.35, active: frame < 4 };
      for (let i = 0; i < 15; i++) world.step(1 / 60);
      if (frame === 2) world.splash(width / 2, height / 2);
      const events = world.events.slice(), calls = a.randomCalls;
      a.canvas.context.commands.length = b.canvas.context.commands.length = 0;
      a.renderer.render(world, 1 / 60);
      world.events = events;
      b.renderer.render(world, 1 / 60);
      assert.equal(a.randomCalls, calls, "rendering must not alter simulation RNG state");
      assert.equal(b.randomCalls, 0);
      assert.deepEqual(a.canvas.context.commands, b.canvas.context.commands, `frame ${frame} draw commands`);
      for (const key of fields) assert.deepEqual(Array.from(a.renderer[key]), Array.from(b.renderer[key]), `frame ${frame} ${key}`);
    }
  });
}

test("nearest-segment ties and zero-length segments retain the original classification", () => {
  const a = environment(currentCode), b = environment(referenceCode);
  for (const env of [a, b]) { env.renderer.resize(900, 600, 1); env.renderer.arcTotal = 1; }
  for (const pattern of ["collapsed", "straight", "overlap"]) {
    for (const env of [a, b]) {
      for (let k = 0; k < env.renderer.arc.length; k++) {
        env.renderer.spine[k * 2] = pattern === "collapsed" ? 0 : pattern === "straight" ? k * 2 : (k % 2) * 20;
        env.renderer.spine[k * 2 + 1] = 0;
        env.renderer.arc[k] = k * 2;
      }
    }
    for (let x = -20; x <= 60; x += 4) for (let y = -16; y <= 16; y += 4) {
      const hitA = a.renderer.sampleShark(x, y, 80), hitB = b.renderer.sampleShark(x, y, 80);
      assert.equal(hitA, hitB, `${pattern} ${x},${y}`);
      for (const key of ["hitDist", "hitS", "hitV", "hitFlag", "hitShade"]) assert.equal(a.renderer[key], b.renderer[key], key);
    }
  }
});

test("a sample computes the nearest segment length once instead of at every closer segment", () => {
  const current = environment(currentCode), original = environment(referenceCode);
  for (const env of [current, original]) {
    const r = env.renderer;
    r.arcTotal = r.arc.length * 2;
    for (let k = 0; k < r.arc.length; k++) { r.spine[k * 2] = k * 2; r.arc[k] = k * 2; }
    r.sampleShark(r.arcTotal + 10, 10, 80);
  }
  assert.ok(original.sqrtCalls > 2, "the reference exercises many closer segments");
  assert.equal(current.sqrtCalls, 2, "one segment length and one distance per sample");
});

function fieldEnvironment() {
  const env = environment(currentCode);
  env.renderer.resize(300, 180, 1);
  env.world = { time: 0, fish: [], sharks: [], events: [], pointer: { x: 140, y: 90, active: true } };
  env.updates = [];
  const diffuse = env.renderer.diffuse;
  env.renderer.diffuse = function(dt) { env.updates.push(dt); return diffuse.call(this, dt); };
  // Canvas drawing is unrelated to the wake cadence; retain the real field.
  for (const name of ["rasterizeSharks", "markFish", "drawDots", "drawHeat", "drawFish", "drawSharks"]) env.renderer[name] = () => {};
  return env;
}
for (const fps of [90, 120, 144]) for (const speed of [0.25, 1, 2]) {
  test(`${fps} fps at ${speed}× keeps the original 60 Hz wake field`, () => {
    const baseline = fieldEnvironment(), high = fieldEnvironment();
    for (let i = 0; i < 60; i++) baseline.renderer.render(baseline.world, speed / 60);
    for (let i = 0; i < fps; i++) high.renderer.render(high.world, speed / fps, speed / 60);
    assert.equal(high.updates.length, 60);
    assert.deepEqual(high.updates, baseline.updates);
    assert.deepEqual(Array.from(high.renderer.energy), Array.from(baseline.renderer.energy));
    assert.deepEqual(Array.from(high.renderer.heat), Array.from(baseline.renderer.heat));
  });
}

test("wake cadence clears partial time at speed/still/resize boundaries and bounds long stalls", () => {
  const env = fieldEnvironment(), r = env.renderer, world = env.world;
  r.render(world, 1 / 144, 1 / 60);
  assert.equal(env.updates.length, 0);
  r.render(world, 1 / 60); // Static and <=60 fps keep the original single update.
  assert.deepEqual(env.updates, [1 / 60]);
  r.render(world, 1 / 144, 1 / 60);
  assert.equal(env.updates.length, 1);
  r.render(world, 2 / 144, 2 / 60); // A new speed drops the prior remainder.
  assert.equal(env.updates.length, 1);
  r.resize(300, 180, 1);
  r.render(world, 2 / 144, 2 / 60);
  assert.equal(env.updates.length, 1);
  r.render(world, 10, 2 / 60);
  assert.equal(env.updates.length, 5);
  r.render(world, 2 / 144, 2 / 60);
  assert.equal(env.updates.length, 5, "no delayed catch-up burst");
  r.render(world, NaN, 2 / 60);
  r.render(world, -1, 2 / 60);
  assert.equal(env.updates.length, 5);
});
