import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { build } from "esbuild";

// Compile the actual client and engine. Only the renderer/world and browser
// boundaries are replaced, so playback, fallback and capture logic stay real.
// An optional source directory allows running these same assertions against a
// saved pre-fix revision without changing the working tree.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(process.env.RUNTIME_SOURCE_ROOT || resolve(root, "src"));
const bundle = await build({
  stdin: {
    contents: await readFile(resolve(sourceRoot, "client.ts"), "utf8"),
    sourcefile: "client.ts",
    resolveDir: sourceRoot,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  plugins: [{
    name: "runtime-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^\.\/ascii-sharks$/ }, () => ({ path: "index", namespace: "boundary" }));
      builder.onResolve({ filter: /^\.\/worker-source\.generated$/ }, () => ({ path: "worker", namespace: "boundary" }));
      builder.onResolve({ filter: /^\.\/(renderer|world)$/ }, ({ path }) => ({ path, namespace: "boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => {
        if (path === "index") return { contents: `export { OceanEngine } from ${JSON.stringify(resolve(sourceRoot, "ascii-sharks/engine.ts"))};`, resolveDir: sourceRoot };
        if (path === "worker") return { contents: 'export const WORKER_SOURCE = "/* Worker transport is controlled by the test */";' };
        if (path === "./world") return { contents: `
          export class World {
            time = 0;
            pointer = { active: false, x: 0, y: 0 };
            resize() {}
            configure() {}
            splash() {}
            step(dt) { this.time += dt; }
          }
        ` };
        return { contents: `
          export class AsciiRenderer {
            cellWidth = 8;
            cellHeight = 16;
            constructor(canvas) {
              this.canvas = canvas;
              // Browsers reject getContext on a transferred canvas.
              canvas.getContext("2d");
            }
            setFontFamily() {}
            resize(width, height, dpr) {
              this.canvas.width = Math.round(width * dpr);
              this.canvas.height = Math.round(height * dpr);
            }
            render() { this.canvas.renderCount++; }
          }
        ` };
      });
    },
  }],
});
const client = bundle.outputFiles[0].text;

function browser({ worker = "ok", reducedMotion = false, focused = true, hidden = false } = {}) {
  const intervals = new Map();
  const animationFrames = new Map();
  const observers = [];
  const workers = [];
  const canvases = [];
  const createdUrls = [];
  const revokedUrls = [];
  let nextHandle = 1;
  let now = 0;

  class Events {
    listeners = new Map();
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatch(type, event = {}) {
      for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    }
    listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
  }

  class Style {
    props = new Map();
    setProperty(name, value, priority = "") { this.props.set(name, { value, priority }); }
    getPropertyValue(name) { return this.props.get(name)?.value || ""; }
    getPropertyPriority(name) { return this.props.get(name)?.priority || ""; }
    removeProperty(name) { this.props.delete(name); }
  }

  class Element extends Events {
    children = [];
    parentElement = null;
    style = new Style();
    dataset = {};
    attributes = new Map();
    classes = new Set();
    id = "";
    classList = {
      contains: (name) => this.classes.has(name),
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name, force) => {
        if (force ?? !this.classes.has(name)) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
    constructor(tagName) { super(); this.tagName = tagName; }
    set className(value) { this.classes = new Set(value.split(/\s+/)); }
    get className() { return [...this.classes].join(" "); }
    get isConnected() { return this === document.documentElement || this.parentElement?.isConnected === true; }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    prepend(...nodes) { for (const node of [...nodes].reverse()) { node.remove(); node.parentElement = this; this.children.unshift(node); } }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    replaceWith(next) {
      const parent = this.parentElement;
      const index = parent.children.indexOf(this);
      this.remove();
      next.remove();
      next.parentElement = parent;
      parent.children.splice(index, 0, next);
    }
    setAttribute(name, value) { this.attributes.set(name, value); if (name === "id") this.id = value; }
    getBoundingClientRect() { return this.rect || { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 }; }
  }

  class Canvas extends Element {
    width = 300;
    height = 150;
    transferred = false;
    renderCount = 0;
    draws = [];
    context = {
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData() {},
      save() {},
      restore() {},
      drawImage: (...args) => this.draws.push(args),
    };
    constructor() { super("canvas"); canvases.push(this); }
    getContext() {
      if (this.transferred) throw new Error("Cannot get a context from a transferred canvas");
      return this.context;
    }
    transferControlToOffscreen() {
      if (worker === "unsupported") throw new Error("OffscreenCanvas is unavailable");
      assert.equal(this.transferred, false);
      this.transferred = true;
      return { transferredFrom: this };
    }
    toDataURL() { return "data:image/png;base64,stub"; }
  }

  function find(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.children) {
      const result = find(child, predicate);
      if (result) return result;
    }
    return null;
  }

  const document = new Events();
  document.hidden = hidden;
  document.hasFocus = () => focused;
  document.documentElement = new Element("html");
  document.body = new Element("body");
  document.head = new Element("head");
  document.documentElement.append(document.head, document.body);
  document.createElement = (tag) => tag === "canvas" ? new Canvas() : new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.getElementById = (id) => find(document.documentElement, (node) => node.id === id);
  document.querySelector = (selector) => {
    const slot = selector.match(/^\[data-slot="(.*)"\]$/)?.[1];
    return find(document.documentElement, (node) => node.attributes.get("data-slot") === slot);
  };

  const motion = new Events();
  motion.matches = reducedMotion;
  const window = new Events();
  Object.assign(window, {
    innerWidth: 900,
    innerHeight: 600,
    devicePixelRatio: 1,
    matchMedia: (query) => query.includes("reduced-motion") ? motion : { matches: false },
    __ModuleLoader__: { load() {} },
    setInterval: (callback, ms) => {
      const handle = nextHandle++;
      intervals.set(handle, { callback, ms });
      return handle;
    },
  });

  function makeLayout() {
    const frame = new Element("div");
    const sidebar = new Element("aside");
    const conversation = new Element("main");
    sidebar.rect = { width: 240, height: 600, left: 0, top: 0 };
    for (const [column, name] of [[sidebar, "sidebar"], [conversation, "main"]]) {
      const slot = new Element("div");
      slot.setAttribute("data-slot", name);
      column.append(slot);
    }
    frame.append(sidebar, conversation);
    document.body.append(frame);
    return { frame, sidebar };
  }
  let layout = makeLayout();

  class Worker {
    messages = [];
    terminated = false;
    onmessage = null;
    onerror = null;
    constructor(url) {
      if (worker === "constructor-throws") throw new Error("Worker blocked by CSP");
      this.url = url;
      workers.push(this);
    }
    postMessage(message) {
      if (message.type === "init" && worker === "init-throws") throw new Error("Transfer failed");
      this.messages.push(message);
    }
    terminate() { this.terminated = true; }
  }

  class ResizeObserver {
    targets = new Set();
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  }

  class IntersectionObserver {
    observe() {}
    disconnect() {}
  }

  let cleanup;
  const globals = {
    window,
    document,
    HTMLElement: Element,
    Worker,
    ResizeObserver,
    IntersectionObserver,
    Blob,
    URL: {
      createObjectURL() {
        const url = `blob:runtime-test-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL(url) { revokedUrls.push(url); },
    },
    getComputedStyle: () => ({ fontFamily: "monospace" }),
    matchMedia: window.matchMedia,
    setInterval: window.setInterval,
    clearInterval: (handle) => intervals.delete(handle),
    requestAnimationFrame: (callback) => {
      const handle = nextHandle++;
      animationFrames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle) => animationFrames.delete(handle),
    performance: { now: () => now },
  };
  runInNewContext(client, globals);

  return {
    document, window, workers, canvases, createdUrls, revokedUrls, intervals, animationFrames,
    get ocean() { return window.__dshAsciiOcean; },
    get surface() { return document.getElementById("dsh-ascii-ocean-surface"); },
    get canvas() { return document.getElementById("dsh-ascii-ocean-canvas"); },
    get capture() { return find(document.documentElement, (node) => node.classList.contains("dsh-liquid-capture")); },
    resizeSidebar(width, height = 600) { layout.sidebar.rect = { width, height, left: 0, top: 0 }; this.ocean.ensure(); },
    replySnapshot(request, frames = 1) {
      const bitmap = { closed: false, close() { this.closed = true; } };
      workers.at(-1).onmessage({ data: { type: "snapshot", requestId: request.requestId, frames, bitmap } });
      return bitmap;
    },
    mount() {
      globals.__dshAsciiOceanPlugin.apply({
        theme: { getTheme: () => ({ active: { colorScheme: "dark" } }) },
        effect(callback) { cleanup = callback(); },
        on() { return () => {}; },
      });
    },
    unmount() { cleanup?.(); },
    focus(next) { focused = next; window.dispatch(next ? "focus" : "blur"); },
    visibility(next) { document.hidden = next; document.dispatch("visibilitychange"); },
    frame() {
      now += 17;
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of callbacks) callback(now);
    },
    tick(ms) { for (const timer of [...intervals.values()]) if (timer.ms === ms) timer.callback(); },
    replaceLayout() { layout.frame.remove(); layout = makeLayout(); this.tick(700); },
    resize() {
      window.innerWidth += 80;
      window.innerHeight += 40;
      for (const observer of observers) if (observer.targets.size) observer.callback([]);
      window.dispatch("resize");
    },
  };
}

for (const failure of ["constructor-throws", "init-throws"]) {
  test(`Worker ${failure}: transferred canvas is replaced and its URL is revoked`, (t) => {
    const env = browser({ worker: failure });
    t.after(() => env.unmount());
    assert.doesNotThrow(() => env.mount());
    assert.equal(env.ocean.mounted, true);
    assert.equal(env.canvas.transferred, false);
    const transferred = env.canvases.find((canvas) => canvas.transferred);
    assert.ok(transferred, "the failure occurred after the original canvas was transferred");
    assert.notEqual(env.canvas, transferred);
    assert.equal(transferred.isConnected, false);
    assert.deepEqual(env.revokedUrls, env.createdUrls);
    assert.ok(env.workers.every((item) => item.terminated));
    env.frame();
    assert.ok(env.canvas.renderCount > 0, "fallback engine renders successfully");
  });
}

for (const worker of ["ok", "unsupported"]) {
  test(`${worker === "ok" ? "Worker" : "local"}: user-hidden ocean stays paused through focus, visibility and remount`, (t) => {
    const env = browser({ worker });
    t.after(() => env.unmount());
    env.mount();
    const isPaused = () => {
      if (worker === "ok") {
        const messages = env.workers.at(-1).messages.filter(({ type }) => type === "pause" || type === "resume");
        assert.equal(messages.at(-1)?.type, "pause");
      } else {
        assert.equal(env.animationFrames.size, 0);
      }
    };
    assert.equal(env.ocean.toggle(), false);
    isPaused();
    env.focus(false);
    env.focus(true);
    isPaused();
    env.visibility(true);
    env.visibility(false);
    isPaused();
    env.replaceLayout();
    assert.equal(env.surface.style.display, "none");
    isPaused();
    if (worker === "ok" && env.workers.length > 1) {
      assert.equal(env.workers.at(-1).messages.find(({ type }) => type === "init").paused, true,
        "a hidden remount must start paused before any follow-up message");
    }
    env.focus(false);
    assert.equal(env.ocean.toggle(), true);
    isPaused();
    env.visibility(true);
    env.focus(true);
    isPaused();
    env.visibility(false);
    if (worker === "ok") {
      assert.equal(env.workers.at(-1).messages.filter(({ type }) => type === "resume" || type === "pause").at(-1).type, "resume");
      assert.ok(env.workers.slice(0, -1).every((item) => item.terminated));
    } else {
      assert.equal(env.animationFrames.size, 1);
      env.frame();
      assert.ok(env.canvas.renderCount > 0);
    }
  });

  test(`${worker === "ok" ? "Worker" : "local"}: initially hidden or unfocused page starts paused`, (t) => {
    for (const initial of [{ hidden: true }, { focused: false }]) {
      const env = browser({ worker, ...initial });
      t.after(() => env.unmount());
      env.mount();
      if (worker === "ok") {
        assert.equal(env.workers[0].messages.find(({ type }) => type === "init").paused, true);
        assert.equal(env.workers[0].messages.filter(({ type }) => type === "resume" || type === "pause").at(-1).type, "pause");
      } else {
        assert.equal(env.animationFrames.size, 0);
      }
    }
  });

  test(`${worker === "ok" ? "Worker" : "local"}: detached surface remount stops the previous renderer`, (t) => {
    const env = browser({ worker });
    t.after(() => env.unmount());
    env.mount();
    const previous = env.canvas;
    env.ocean.toggle();
    env.surface.remove();
    env.tick(700);
    assert.notEqual(env.canvas, previous);
    assert.equal(env.surface.style.display, "none");
    if (worker === "ok") {
      assert.equal(env.workers[0].terminated, true);
      assert.deepEqual(env.revokedUrls, [env.createdUrls[0]]);
      assert.equal(env.workers[1].messages.find(({ type }) => type === "init").paused, true);
    } else {
      assert.equal(env.animationFrames.size, 0);
      env.ocean.toggle();
      assert.equal(env.animationFrames.size, 1);
      env.frame();
      assert.equal(previous.renderCount, 0);
      assert.ok(env.canvas.renderCount >= 1, "paused initial frame and resumed rendering are both allowed");
    }
  });
}

test("asynchronous Worker failure preserves pause and releases Worker resources", (t) => {
  const env = browser();
  t.after(() => env.unmount());
  env.mount();
  env.ocean.toggle();
  const failed = env.workers[0];
  const originalCanvas = env.canvas;
  failed.onerror({ message: "Worker script failed" });
  assert.equal(failed.terminated, true);
  assert.deepEqual(env.revokedUrls, env.createdUrls);
  assert.notEqual(env.canvas, originalCanvas);
  assert.equal(env.canvas.transferred, false);
  assert.equal(env.animationFrames.size, 0, "hidden fallback must not animate");
  env.ocean.toggle();
  env.frame();
  assert.ok(env.canvas.renderCount > 0);
  env.unmount();
  assert.equal(env.animationFrames.size, 0);
  assert.equal(env.intervals.size, 0);
  assert.equal(env.window.listenerCount(), 0);
  assert.equal(env.document.listenerCount(), 0);
  assert.equal(env.document.documentElement.listenerCount(), 0);
});

test("unmount terminates a live Worker and revokes its Blob URL exactly once", () => {
  const env = browser();
  env.mount();
  const active = env.workers[0];
  env.unmount();
  env.unmount();
  assert.equal(active.terminated, true);
  assert.equal(active.messages.filter(({ type }) => type === "dispose").length, 1);
  assert.deepEqual(env.revokedUrls, env.createdUrls);
  assert.equal(env.intervals.size, 0);
  assert.equal(env.surface, null);
  assert.equal(env.window.listenerCount(), 0);
});

test("reduced-motion local resize advances frames and refreshes the sidebar snapshot", (t) => {
  const env = browser({ worker: "unsupported", reducedMotion: true });
  t.after(() => env.unmount());
  env.mount();
  assert.ok(env.canvas.renderCount > 0, "initial still renders without an animation loop");
  assert.equal(env.animationFrames.size, 0);
  env.tick(120);
  const capture = env.capture;
  const beforeFrames = env.ocean.frames;
  const beforeDraws = capture.draws.length;
  const beforeWidth = env.canvas.width;
  assert.equal(beforeDraws, 1);
  env.tick(120);
  assert.equal(capture.draws.length, beforeDraws, "unchanged still is not copied twice");
  env.resize();
  assert.ok(env.canvas.width > beforeWidth);
  assert.ok(env.ocean.frames > beforeFrames, "resize-produced still must invalidate the capture");
  env.tick(120);
  assert.ok(capture.draws.length > beforeDraws, "resize and its layout observers refresh the still");
  const settledDraws = capture.draws.length;
  env.tick(120);
  assert.equal(capture.draws.length, settledDraws, "no periodic recapture after resize settles");
  assert.equal(capture.draws.at(-1)[0], env.canvas);
  assert.equal(env.animationFrames.size, 0, "reduced motion keeps the animation loop stopped");
});

test('Worker snapshots have one in flight and discard obsolete geometry before drawing the latest crop', t => {
  const env = browser(); t.after(() => env.unmount()); env.mount();
  const messages = env.workers[0].messages;
  const requests = () => messages.filter(message => message.type === 'snapshot');
  const first = requests()[0];
  for (let i = 0; i < 6; i++) env.tick(120);
  assert.equal(requests().length, 1);
  env.resizeSidebar(300);
  assert.equal(requests().length, 1, 'geometry changes coalesce while the old crop is in flight');
  const stale = env.replySnapshot(first, 10);
  assert.equal(stale.closed, true);
  assert.equal(env.capture.draws.length, 0);
  assert.equal(requests().length, 2);
  assert.equal(requests()[1].force, true);
  const current = env.replySnapshot(requests()[1], 10);
  assert.equal(current.closed, true);
  assert.equal(env.capture.width, 150);
  assert.equal(env.capture.draws.length, 1);
  env.ocean.setMode('static');
  env.replySnapshot(requests().at(-1), 10);
  const settled = requests().length;
  for (let i = 0; i < 6; i++) { env.tick(120); env.tick(700); }
  assert.equal(requests().length, settled, 'settled static has no snapshot polling');
  env.ocean.setMode('off');
  assert.equal(env.capture, null);
  assert.equal(env.document.getElementById('dsh-liquid-filter-svg'), null);
  assert.equal(env.surface.style.display, 'none');
});

test('pane repair releases old filters and capture contexts at the default canvas size', t => {
  const env = browser({ worker: 'unsupported', reducedMotion: true });
  t.after(() => env.unmount()); env.mount(); env.resizeSidebar(600, 300);
  for (let i = 0; i < 4; i++) {
    const old = env.capture;
    const draws = old.draws.length;
    old.parentElement.remove(); env.ocean.ensure();
    assert.notEqual(env.capture, old);
    assert.equal(env.capture.width, 300);
    assert.equal(env.capture.height, 150);
    assert.ok(env.capture.draws.length > 0, 'new capture receives the still');
    assert.equal(old.draws.length, draws, 'detached context is never painted again');
    assert.equal(env.document.body.children.filter(node => node.id === 'dsh-liquid-filter-svg').length, 1);
  }
  env.unmount();
  assert.equal(env.document.body.children.filter(node => node.id === 'dsh-liquid-filter-svg').length, 0);
});

test('live controls keep one renderer and glass disabled stops snapshot polling', t => {
  const env = browser(); t.after(() => env.unmount()); env.mount();
  const canvas = env.canvas;
  const worker = env.workers[0];
  env.ocean.setPreferences({fishCount:0,sharkCount:0,speed:2,maxFps:15,interactive:false});
  assert.equal(env.canvas,canvas);
  assert.equal(env.workers.length,1);
  const config=worker.messages.findLast(m=>m.type==='configure');
  assert.equal(config.fishCount,0);
  assert.equal(config.sharks.length,0);
  assert.equal(config.speed,2);
  assert.equal(config.interactive,false);
  assert.equal(worker.messages.findLast(m=>m.type==='fps').fps,15);
  const pending=worker.messages.findLast(m=>m.type==='snapshot');
  env.ocean.setPreferences({glass:false});
  const stale=env.replySnapshot(pending,30);
  assert.equal(stale.closed,true);
  assert.equal(env.capture,null);
  assert.equal(env.document.getElementById('dsh-liquid-filter-svg'),null);
  const requests=worker.messages.filter(m=>m.type==='snapshot').length;
  for(let i=0;i<5;i++){env.tick(120);env.tick(700)}
  assert.equal(worker.messages.filter(m=>m.type==='snapshot').length,requests);
  env.ocean.setPreferences({glass:true});
  assert.ok(env.capture);
  assert.ok(worker.messages.filter(m=>m.type==='snapshot').length>requests);
  env.ocean.setMode('static');
  const resumes=worker.messages.filter(m=>m.type==='resume').length;
  env.ocean.setPreferences({fishCount:300,sharkCount:12,maxFps:30});
  assert.equal(worker.messages.filter(m=>m.type==='resume').length,resumes);
  env.ocean.resetPreferences();
  assert.equal(env.ocean.getSnapshot().clarity,50);
  assert.equal(env.ocean.getSnapshot().maxFps,60);
  assert.equal(env.ocean.getSnapshot().fishCount,null);
});

for (const worker of ['ok','unsupported']) test(`${worker}: simultaneous static mode and population change renders the new world`, t=>{
  const env=browser({worker});t.after(()=>env.unmount());env.mount();
  const before=env.ocean.frames;
  const count=env.workers[0]?.messages.length??0;
  env.ocean.setPreferences({mode:'static',fishCount:0,sharkCount:0});
  if(worker==='ok') {
    const messages=env.workers[0].messages.slice(count);
    assert.ok(messages.findIndex(m=>m.type==='pause')<messages.findIndex(m=>m.type==='configure'));
  } else {
    assert.ok(env.ocean.frames>before,'the newly configured static scene must redraw');
    assert.equal(env.animationFrames.size,0);
  }
});
