import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererBoundary = {
  name: "renderer-only-boundary",
  setup(builder) {
    builder.onResolve({ filter: /\/(renderer)$|^\.\/renderer$/ }, () => ({ path: "renderer", namespace: "boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({ contents: `
      export class AsciiRenderer {
        cellWidth = 8; cellHeight = 16; draws = [];
        constructor(canvas) { this.canvas = canvas; globalThis.renderers.push(this); }
        setFontFamily() {}
        resize(w,h,dpr) { this.canvas.width=w*dpr; this.canvas.height=h*dpr; }
        render(world,dt) { this.world=world; this.draws.push({time:world.time,dt,fish:world.fish.length,sharks:world.sharks.length}); }
      }
    ` }));
  },
};
async function compile(path, name) {
  const output = await build({ entryPoints: [resolve(root, path)], bundle: true, write: false, format: "iife", globalName: name, plugins: [rendererBoundary] });
  return output.outputFiles[0].text;
}
const worldCode = await compile("src/ascii-sharks/world.ts", "WorldModule");
const engineCode = await compile("src/ascii-sharks/engine.ts", "EngineModule");
const workerCode = await compile("src/ocean-worker.ts", "WorkerModule");
function world(sharks = [], fishCount = null) {
  const context = {};
  runInNewContext(worldCode, context);
  const instance = new context.WorldModule.World(sharks, fishCount);
  instance.resize(900, 600, 8, 16);
  return instance;
}

function environment(worker = false) {
  let now = 0, nextId = 0;
  const callbacks = new Map(), timers = new Map();
  const listeners = new Map();
  const events = { addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); } };
  const motion = { matches: false, addEventListener() {}, removeEventListener() {} };
  class Canvas {
    width = 300; height = 150;
    getBoundingClientRect() { return { width: 900, height: 600, left: 0, top: 0 }; }
  }
  const globals = {
    renderers: [],
    window: { ...events, matchMedia: () => motion, devicePixelRatio: 1 },
    document: { documentElement: { addEventListener() {}, removeEventListener() {} } },
    getComputedStyle: () => ({ fontFamily: "monospace" }),
    performance: { now: () => now },
    requestAnimationFrame(fn) { callbacks.set(++nextId, fn); return nextId; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    setTimeout(fn, delay) { timers.set(++nextId, { fn, at: now + delay }); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    self: { postMessage() {} },
  };
  runInNewContext(worker ? workerCode : engineCode, globals);
  return {
    globals, callbacks, timers,
    get renderer() { return globals.renderers[0]; },
    get world() { return this.renderer.world; },
    create(options = {}, sharks = []) { return new globals.EngineModule.OceanEngine(new Canvas(), sharks, options); },
    send(data) { globals.self.onmessage({ data }); },
    init(options = {}) { this.send({ type: "init", canvas: new Canvas(), width: 900, height: 600, dpr: 1, fishCount: 0, sharks: [], paused: true, ...options }); },
    frame(time) { now = time; const due = [...callbacks.values()]; callbacks.clear(); for (const fn of due) fn(now); },
    timer(time) { now = time; const entry = [...timers.entries()].sort((a,b) => a[1].at-b[1].at)[0]; assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); },
    dispatch(type, event) { for (const fn of listeners.get(type) || []) fn(event); },
  };
}

test("zero fish and sharks stay empty across resize and simulation steps", () => {
  const w = world([], 0);
  w.step(1 / 60); const time = w.time;
  w.resize(1600, 1000, 13, 19);
  assert.equal(w.fish.length, 0); assert.equal(w.sharks.length, 0); assert.equal(w.time, time);
  w.configure({ fishCount: 4 }); assert.equal(w.fish.length, 4);
  w.configure({ fishCount: 0 }); w.resize(900, 600, 8, 16);
  assert.equal(w.fish.length, 0); assert.equal(w.sharks.length, 0); assert.equal(w.time, time);
});

test("growing and shrinking populations preserves retained animals and clears removed prey", () => {
  const specs = [{ kind: "classic", size: 0.8 }, { kind: "tiger", size: 0.6 }];
  const w = world(specs, 3); w.time = 7;
  const fish = [...w.fish], sharks = [...w.sharks];
  const fishPositions = fish.map(f => [f.x, f.y, f.vx, f.vy]);
  const sharkNodes = sharks.map(s => [...s.nodes]);
  w.configure({ fishCount: 9, sharks: [...specs, { kind: "mako", size: 0.5 }] });
  assert.equal(w.time, 7); assert.equal(w.fish.length, 9); assert.equal(w.sharks.length, 3);
  fish.forEach((f,i) => { assert.equal(w.fish[i], f); assert.deepEqual([f.x,f.y,f.vx,f.vy], fishPositions[i]); });
  sharks.forEach((s,i) => { assert.ok(w.sharks.includes(s)); assert.deepEqual([...s.nodes], sharkNodes[i]); });
  sharks[0].target = w.fish[8];
  w.configure({ fishCount: 2, sharks: specs });
  assert.equal(w.fish[0], fish[0]); assert.equal(w.fish[1], fish[1]); assert.equal(sharks[0].target, null);
  assert.equal(w.time, 7); assert.equal(w.sharks.length, 2);
  w.configure({ sharks: [] }); assert.equal(w.sharks.length, 0);
});

test("auto population follows area while explicit counts remain stable", () => {
  const w = world([], 8); const first = w.fish[0];
  w.configure({ fishCount: null }); assert.equal(w.fish.length, 123); assert.equal(w.fish[0], first);
  w.resize(1440, 900, 12, 17); assert.equal(w.fish.length, 295); assert.ok(w.fish.includes(first));
  w.resize(3000, 2000, 13, 19); assert.equal(w.fish.length, 340);
  w.configure({ fishCount: 30 }); w.resize(400, 300, 8, 12); assert.equal(w.fish.length, 30);
});

test("population and shark input reject nonfinite values and enforce practical bounds", () => {
  const w = world([{ kind: "classic", size: 0.8 }], 2);
  w.configure({ fishCount: NaN }); assert.equal(w.fish.length, 2);
  w.configure({ fishCount: Infinity }); assert.equal(w.fish.length, 2);
  w.configure({ fishCount: 99999 }); assert.equal(w.fish.length, 600);
  w.configure({ fishCount: -12 }); assert.equal(w.fish.length, 0);
  w.configure({ sharks: [{kind:"wrong",size:1},{kind:"tiger",size:NaN},{kind:"classic",size:Infinity},...Array.from({length:15},()=>({kind:"mako",size:0.6}))] });
  assert.equal(w.sharks.length, 12);
  for (const sh of w.sharks) assert.ok([...sh.nodes, sh.length, sh.depth].every(Number.isFinite));
  w.step(1/60); assert.ok(Number.isFinite(w.time));
});

for (const worker of [false, true]) {
  const label = worker ? "Worker" : "local";
  test(`${label}: static configure renders once without restart, reseed, or warmup`, () => {
    const env = environment(worker);
    const engine = worker ? (env.init({ initialStatic:true, fishCount:3 }), null) : env.create({ initialStatic:true, fishCount:3 });
    const w = env.world, renderer = env.renderer, canvas = renderer.canvas, time = w.time, before = renderer.draws.length, first = w.fish[0];
    worker ? env.send({ type:"configure", fishCount:8, sharks:[{kind:"tiger",size:.6}], speed:2, interactive:false }) : engine.configure({ fishCount:8, sharks:[{kind:"tiger",size:.6}], speed:2, interactive:false });
    assert.equal(env.world, w); assert.equal(env.renderer, renderer); assert.equal(renderer.canvas, canvas);
    assert.equal(w.time, time); assert.ok(Math.abs(time-4)<1e-8); assert.equal(w.fish[0], first);
    assert.equal(w.fish.length, 8); assert.equal(w.sharks.length, 1); assert.equal(renderer.draws.length, before+1);
    assert.equal(env.timers.size+env.callbacks.size, 0);
    worker ? env.send({ type:"configure", fishCount:0, sharks:[] }) : engine.configure({ fishCount:0, sharks:[] });
    assert.equal(w.time,time); assert.equal(w.fish.length,0); assert.equal(w.sharks.length,0);
    engine?.destroy();
  });
  test(`${label}: disabled interaction clears active pointer and rejects splashes`, () => {
    const env = environment(worker);
    const engine = worker ? (env.init(),env.send({type:"resume"}),null) : env.create({fishCount:0});
    if (!worker) env.frame(17);
    const blank = {clientX:20,clientY:20,button:0,target:{closest:()=>null}};
    worker ? env.send({type:"pointer",x:20,y:20,active:true}) : env.dispatch("pointermove",blank);
    assert.equal(env.world.pointer.active,true);
    worker ? env.send({type:"configure",interactive:false}) : engine.configure({interactive:false});
    assert.equal(env.world.pointer.active,false);
    const before=env.world.events.length;
    worker ? env.send({type:"splash",x:20,y:20}) : env.dispatch("pointerdown",blank);
    assert.equal(env.world.events.length,before);
    worker ? env.send({type:"pointer",x:20,y:20,active:true}) : env.dispatch("pointermove",blank);
    assert.equal(env.world.pointer.active,false);
    engine?.destroy();
  });
  for (const fps of [15,30,45,60]) for (const speed of [.25,1,2]) {
    test(`${label}: ${fps}fps × ${speed} speed advances real simulation time in bounded substeps`, () => {
      const env=environment(worker);
      const engine=worker ? (env.init({maxFps:fps,speed}),env.send({type:"resume"}),null) : env.create({fishCount:0,maxFps:fps,speed});
      const w=worker?env.world:engine.world, steps=[], original=w.step;
      w.step=function(dt){steps.push(dt);return original.call(this,dt)};
      if(worker) for(let i=1;i<=fps*2;i++) env.timer(i*1000/fps);
      else for(let i=1;i<=144*2;i++) env.frame(i*1000/144);
      assert.ok(Math.abs(w.time-2*speed)<=1/60+1e-7,`${w.time} simulation seconds, expected ${2*speed}`);
      assert.ok(steps.length>0&&steps.every(dt=>dt>0&&dt<=1/60));
      engine?.destroy();
    });
  }
  test(`${label}: bad speed/FPS values keep the last valid settings and live configure preserves the loop`, () => {
    const env=environment(worker);
    const engine=worker?(env.init({maxFps:60,speed:1}),env.send({type:"resume"}),null):env.create({fishCount:0,maxFps:60,speed:1});
    const handles=worker?env.timers:env.callbacks;
    const beforeHandle=[...handles.keys()][0];
    worker?env.send({type:"configure",speed:NaN,fishCount:NaN}):engine.configure({speed:NaN,fishCount:NaN});
    assert.equal([...handles.keys()][0],beforeHandle,"configure must not restart the running loop");
    worker?env.send({type:"fps",fps:NaN}):engine.setMaxFps(NaN);
    for(let i=1;i<=60;i++) worker?env.timer(i*1000/60):env.frame(i*1000/60);
    const w=worker?env.world:engine.world;
    assert.ok(Math.abs(w.time-1)<1e-7); assert.equal(w.fish.length,0);
    worker?env.send({type:"configure",speed:2,fishCount:6}):engine.configure({speed:2,fishCount:6});
    for(let i=61;i<=120;i++) worker?env.timer(i*1000/60):env.frame(i*1000/60);
    assert.ok(Math.abs(w.time-3)<1e-7); assert.equal(w.fish.length,6);
    engine?.destroy();
  });
}
