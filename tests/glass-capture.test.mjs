import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerSourceBoundary = {
  name: "glass-worker-source-boundary",
  setup(builder) {
    builder.onResolve({ filter: /worker-source\.generated$/ }, () => ({ path: "source", namespace: "worker-source" }));
    builder.onLoad({ filter: /.*/, namespace: "worker-source" }, () => ({ contents: 'export const GLASS_WORKER_SOURCE = "worker fixture";' }));
  },
};
async function compile(entry) {
  const result = await build({ entryPoints: [resolve(root, entry)], bundle: true, write: false,
    format: "iife", globalName: "Api", plugins: [workerSourceBoundary] });
  return result.outputFiles[0].text;
}
const [captureCode, workerCode] = await Promise.all([compile("src/glass-capture.ts"), compile("src/glass-worker.ts")]);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const bitmap = (width = 20, height = 30) => ({ width, height, closes: 0, close() { this.closes++; } });

function captureEnvironment(options = {}) {
  const activeUrls = new Set(), revoked = [], created = [], workers = [], decodes = [], completed = [];
  let sequence = 0, failures = 0;
  class Image {
    src = "";
    decode() { const job = deferred(); decodes.push({ image: this, ...job }); return job.promise; }
    removeAttribute(name) { if (name === "src") this.src = ""; }
  }
  class Worker {
    messages = []; terminated = 0;
    constructor(url) { if (options.constructorThrows) throw new Error("Worker unavailable"); this.url = url; workers.push(this); }
    postMessage(data, transfer) { if (options.postThrows) throw new Error("Transfer failed"); this.messages.push({ data, transfer }); }
    terminate() { this.terminated++; }
  }
  const globals = { Image, Worker, Blob,
    URL: {
      createObjectURL(blob) { const url = `blob:test-${++sequence}`; activeUrls.add(url); created.push({ url, blob }); return url; },
      revokeObjectURL(url) { assert.ok(activeUrls.delete(url), `URL revoked twice or unknown: ${url}`); revoked.push(url); },
    },
  };
  runInNewContext(captureCode, globals);
  const element = new Image();
  const env = { globals, element, activeUrls, revoked, created, workers, decodes, completed,
    get failures() { return failures; },
    create() { return new globals.Api.GlassCapture(element, () => failures++); },
  };
  env.capture = options.constructorThrows ? null : env.create();
  env.render = (input = bitmap(), accept = () => true, complete = accepted => completed.push(accepted)) => {
    env.capture.render(input, "light", input.width, input.height, accept, complete);
    return input;
  };
  env.reply = (data = {}) => workers[0].onmessage?.({ data: { type: "image", requestId: workers[0].messages.at(-1)?.data.requestId,
    blob: new Blob(["png"], { type: "image/png" }), ...data } });
  return env;
}

test("GlassCapture transfers one raw bitmap and keeps the old URL until replacement decodes", async () => {
  const env = captureEnvironment(), input = env.render();
  const message = env.workers[0].messages[0];
  assert.equal(message.data.type, "draw");
  assert.deepEqual([message.data.w, message.data.h, message.data.scheme], [20, 30, "light"]);
  assert.equal(message.transfer[0], input);
  assert.equal(env.capture.busy, true);
  env.reply();
  assert.equal(env.element.src, "");
  assert.equal(env.capture.busy, true, "decoding is part of the single in-flight job");
  env.decodes[0].resolve(); await flush();
  const firstUrl = env.element.src;
  assert.ok(env.activeUrls.has(firstUrl));
  assert.deepEqual(env.completed, [true]);
  assert.equal(env.capture.busy, false);
  env.render(); env.reply();
  assert.equal(env.element.src, firstUrl);
  assert.ok(env.activeUrls.has(firstUrl));
  env.decodes[1].resolve(); await flush();
  assert.notEqual(env.element.src, firstUrl);
  assert.ok(!env.activeUrls.has(firstUrl));
  assert.equal(env.activeUrls.size, 2, "only the worker script and displayed image remain");
  env.capture.destroy(); env.capture.destroy();
  assert.equal(env.activeUrls.size, 0);
  assert.equal(env.workers[0].terminated, 1);
  assert.equal(env.workers[0].onmessage, null);
  assert.equal(env.workers[0].onerror, null);
});

test("GlassCapture drops wrong replies and stale revisions before allocating a Blob URL", async () => {
  const env = captureEnvironment(); let revision = 1;
  env.render(bitmap(), () => revision === 1);
  env.reply({ requestId: 999 });
  env.reply({ type: "other" });
  assert.equal(env.capture.busy, true);
  assert.equal(env.decodes.length, 0);
  revision = 2; env.reply(); await flush();
  assert.deepEqual(env.completed, [false]);
  assert.equal(env.capture.busy, false);
  assert.equal(env.created.length, 1, "only the worker script URL was allocated");
  env.capture.destroy();
});

test("GlassCapture rechecks revision after decode and permits an immediate fresh request", async () => {
  const env = captureEnvironment(); let revision = 1;
  env.render(bitmap(), () => revision === 1, accepted => {
    env.completed.push(accepted);
    if (!accepted) env.render();
  });
  env.reply(); const obsoleteUrl = env.decodes[0].image.src;
  revision = 2;
  env.decodes[0].resolve(); await flush();
  assert.equal(env.element.src, "");
  assert.ok(!env.activeUrls.has(obsoleteUrl));
  assert.deepEqual(env.completed, [false]);
  assert.equal(env.workers[0].messages.length, 2);
  assert.equal(env.capture.busy, true);
  env.capture.destroy();
});

test("GlassCapture rejects extra inputs without adding an encoding or decoding queue", async () => {
  const env = captureEnvironment(); env.render();
  const busyInput = env.render();
  assert.equal(busyInput.closes, 1);
  assert.equal(env.workers[0].messages.length, 1);
  env.reply();
  const decodingInput = env.render();
  assert.equal(decodingInput.closes, 1);
  assert.equal(env.decodes.length, 1);
  env.capture.destroy();
  const destroyedInput = env.render();
  assert.equal(destroyedInput.closes, 1);
  env.decodes[0].resolve(); await flush();
  assert.equal(env.activeUrls.size, 0);
  assert.deepEqual(env.completed, []);
});

for (const failure of ["encoder", "missing-blob", "decode", "worker", "post"]) {
  test(`GlassCapture ${failure} failure releases resources and requests fallback exactly once`, async () => {
    const env = captureEnvironment({ postThrows: failure === "post" });
    const input = env.render();
    const oldError = env.workers[0].onerror;
    if (failure === "encoder") env.reply({ failed: true });
    if (failure === "missing-blob") env.reply({ blob: undefined });
    if (failure === "decode") { env.reply(); env.decodes[0].reject(new Error("decode failed")); }
    if (failure === "worker") env.workers[0].onerror();
    await flush();
    oldError?.();
    assert.equal(env.failures, 1);
    assert.equal(env.capture.busy, false);
    assert.equal(env.activeUrls.size, 0);
    assert.equal(env.workers[0].terminated, 1);
    if (failure === "post") assert.equal(input.closes, 1, "untransferred bitmap is closed locally");
  });
}

test("GlassCapture destroy ignores late encode and decode completion without fallback", async () => {
  for (const decoding of [false, true]) {
    const env = captureEnvironment(); env.render();
    const lateMessage = env.workers[0].onmessage;
    if (decoding) env.reply();
    env.capture.destroy();
    lateMessage({ data: { type: "image", requestId: 1, blob: new Blob(["late"]) } });
    if (decoding) {
      assert.equal(env.decodes[0].image.src, "");
      env.decodes[0].resolve();
    }
    await flush();
    assert.equal(env.activeUrls.size, 0);
    assert.equal(env.failures, 0);
    assert.deepEqual(env.completed, []);
  }
});

test("GlassCapture constructor releases its script URL when Worker creation fails", () => {
  const env = captureEnvironment({ constructorThrows: true });
  assert.throws(() => env.create(), /Worker unavailable/);
  assert.equal(env.activeUrls.size, 0);
});

function workerEnvironment(options = {}) {
  const canvases = [], draws = [], encodes = [], messages = [];
  class Canvas {
    constructor(w, h) { this.width = w; this.height = h; canvases.push(this); }
    getContext() {
      if (options.noContext) return null;
      return this.context ??= { filter: "none", restores: 0, clearRect() {}, save() {},
        restore() { this.restores++; },
        drawImage(input, x, y) {
          if (options.drawThrows) throw new Error("draw failed");
          draws.push({ input, x, y, filter: this.filter });
        },
      };
    }
    convertToBlob(options) { const job = deferred(); encodes.push({ ...job, options }); return job.promise; }
  }
  const globals = { OffscreenCanvas: Canvas, self: { postMessage(data) { messages.push(data); } } };
  runInNewContext(workerCode, globals);
  return { canvases, draws, encodes, messages,
    send(data) { globals.self.onmessage({ data }); },
    draw(input = bitmap(), extras = {}) { this.send({ type: "draw", requestId: messages.length + 1,
      bitmap: input, w: input.width, h: input.height, scheme: "light", ...extras }); return input; },
  };
}

test("glass Worker preserves 1:1 color drawing and reuses its canvas across dimensions", async () => {
  const env = workerEnvironment(), first = env.draw();
  assert.equal(env.draws[0].filter, "invert(1) hue-rotate(180deg) saturate(1.8) contrast(1.35) brightness(0.96)");
  assert.deepEqual([env.draws[0].x, env.draws[0].y], [0, 0]);
  assert.equal(env.encodes[0].options.type, "image/png");
  const blob = new Blob(["png"], { type: "image/png" });
  env.encodes[0].resolve(blob); await flush();
  assert.equal(first.closes, 1); assert.equal(env.messages[0].blob, blob);
  const second = env.draw(bitmap(25, 35), { scheme: "dark" });
  assert.equal(env.canvases.length, 1);
  assert.deepEqual([env.canvases[0].width, env.canvases[0].height], [25, 35]);
  assert.equal(env.draws[1].filter, "none");
  env.encodes[1].resolve(blob); await flush();
  assert.equal(second.closes, 1);
});

test("glass Worker refuses concurrent work and resumes after PNG rejection", async () => {
  const env = workerEnvironment(), first = env.draw(bitmap(), { requestId: 1 });
  const second = env.draw(bitmap(), { requestId: 2 });
  assert.equal(second.closes, 1);
  assert.equal(env.messages[0].requestId, 2); assert.equal(env.messages[0].failed, true);
  assert.equal(env.encodes.length, 1);
  env.encodes[0].reject(new Error("PNG failed")); await flush();
  assert.equal(first.closes, 1); assert.equal(env.messages[1].failed, true);
  const third = env.draw(bitmap(), { requestId: 3 });
  assert.equal(env.encodes.length, 2);
  env.encodes[1].resolve(new Blob()); await flush();
  assert.equal(third.closes, 1); assert.equal(env.messages[2].requestId, 3);
});

for (const failure of ["dimensions", "scheme", "context", "draw"]) {
  test(`glass Worker ${failure} failure closes the input without starting PNG encoding`, async () => {
    const env = workerEnvironment({ noContext: failure === "context", drawThrows: failure === "draw" });
    const input = env.draw(bitmap(), failure === "dimensions" ? { w: 21 } : failure === "scheme" ? { scheme: "invalid" } : {});
    await flush();
    assert.equal(input.closes, 1);
    assert.equal(env.messages[0].failed, true);
    assert.equal(env.encodes.length, 0);
    if (failure === "draw") assert.equal(env.canvases[0].context.restores, 1);
  });
}

test("glass Worker dispose frees the canvas and suppresses asynchronous output", async () => {
  const env = workerEnvironment(), pending = env.draw();
  env.send({ type: "dispose" });
  assert.deepEqual([env.canvases[0].width, env.canvases[0].height], [0, 0]);
  const late = env.draw();
  assert.equal(late.closes, 1);
  env.encodes[0].resolve(new Blob()); await flush();
  assert.equal(pending.closes, 1);
  assert.equal(env.messages.length, 0);
});
