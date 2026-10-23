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

function environment(worker = false, seed = null) {
  let now = 0, nextId = 0, randomCalls = 0;
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
  if (seed !== null) globals.Math = Object.assign(Object.create(Math), {
    random() { randomCalls++; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; },
  });
  runInNewContext(worker ? workerCode : engineCode, globals);
  return {
    globals, callbacks, timers,
    get randomCalls() { return randomCalls; },
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
  for (const fps of [15,30,45,60,90,120,144]) for (const speed of [.25,1,2]) {
    test(`${label}: ${fps}fps × ${speed} speed advances real simulation time in bounded substeps`, () => {
      const env=environment(worker);
      const engine=worker ? (env.init({maxFps:fps,speed}),env.send({type:"resume"}),null) : env.create({fishCount:0,maxFps:fps,speed});
      const w=worker?env.world:engine.world, steps=[], original=w.step;
      w.step=function(dt){steps.push(dt);return original.call(this,dt)};
      if(worker) for(let i=1;i<=fps*2;i++) env.timer(i*1000/fps);
      else for(let i=1;i<=144*2;i++) env.frame(i*1000/144);
      const step=1/Math.max(60,fps);
      assert.ok(Math.abs(w.time-2*speed)<=step+1e-7,`${w.time} simulation seconds, expected ${2*speed}`);
      assert.ok(steps.length>0&&steps.every(dt=>dt===step));
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

const movementSpecs = [{kind:"classic",size:.8},{kind:"tiger",size:.6}];
const motionState = w => JSON.stringify({
  time:w.time,
  fish:w.fish.map(f=>[f.x,f.y,f.vx,f.vy,f.phase,f.alarm,f.alive]),
  sharks:w.sharks.map(s=>[[...s.nodes],s.heading,s.phase,s.speed,s.hunger,s.wander]),
});

test("60 Hz noise correction preserves the pre-change seeded World state and RNG sequence", () => {
  const env=environment(false,123), engine=env.create({fishCount:24,paused:true},movementSpecs), w=env.world;
  for(let i=0;i<120;i++) w.step(1/60);
  // Captured from the original World before introducing noiseScale. Tolerate
  // floating-point library differences, but preserve the random-call count.
  const expected=[
    839.6331381719485,504.0900113553845,20.52024448707763,47.805404917594565,24.374780395568838,.23418420137332668,
    843.150432868912,443.49111760765163,69.71577508434187,1.0253294562833233,28.54966815054884,.33287147630131286,
    182.27310180664062,352.7033386230469,181.8008575439453,344.3798828125,1.4632479940328749,9.08797249380702,35.64813930052002,.47342495416756725,.04759696106115973,
    724.5423583984375,403.33502197265625,723.5927734375,392.2598571777344,1.5059640789672588,9.042938909418137,69.65420184801448,.42043995234649634,-.26422131349643085,
  ];
  const actual=[...([w.fish[0],w.fish[23]].flatMap(f=>[f.x,f.y,f.vx,f.vy,f.phase,f.alarm])),
    ...w.sharks.flatMap(s=>[...s.nodes.slice(0,4),s.heading,s.phase,s.speed,s.hunger,s.wander])];
  actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-6,`legacy state component ${i}: ${value}`));
  assert.equal(env.randomCalls,6111);assert.ok(Math.abs(w.time-2)<1e-12);engine.destroy();
});

test("real fish jitter retains its velocity-noise variance per simulation second at high refresh", () => {
  for(const fps of [60,90,120,144]) {
    const velocities=[];
    for(const random of [.25,.75]) {
      const env=environment(false,789),engine=env.create({fishCount:1,paused:true}),w=env.world;
      Object.assign(w.fish[0],{x:450,y:300,vx:36,vy:0,species:0,alarm:0,alive:true,turn:0});
      env.globals.Math.random=()=>random;
      w.step(1/fps);velocities.push([w.fish[0].vx,w.fish[0].vy]);engine.destroy();
    }
    // Paired worlds cancel all deterministic steering/current forces. Species
    // 0 has jitter 40; equal quantiles must differ by 20*sqrt(dt/60).
    for(let axis=0;axis<2;axis++) assert.ok(Math.abs((velocities[1][axis]-velocities[0][axis])*Math.sqrt(fps)-20/Math.sqrt(60))<1e-10);
  }
});

test("real shark wander has matching seeded noise variance at 60/90/120/144 Hz", () => {
  let reference;
  for(const fps of [60,90,120,144]) {
    const env=environment(false,2468),engine=env.create({fishCount:0,paused:true},movementSpecs.slice(0,1)),w=env.world;
    const countBefore=env.randomCalls, increments=[];
    for(let i=0;i<256;i++) {
      // Isolate each stochastic increment from the wander boundary clamp.
      w.sharks[0].wander=0;w.step(1/fps);increments.push(w.sharks[0].wander);
    }
    const mean=increments.reduce((sum,value)=>sum+value,0)/increments.length;
    const variancePerSecond=increments.reduce((sum,value)=>sum+(value-mean)**2,0)/increments.length*fps;
    assert.equal(env.randomCalls-countBefore,256,"one RNG draw per shark step, with no reseeding");
    assert.ok(variancePerSecond>.01&&variancePerSecond<.018,"sample agrees with the legacy 3.2²/(12*60) noise strength");
    if(reference===undefined)reference=variancePerSecond;
    else assert.ok(Math.abs(variancePerSecond-reference)<1e-12,"same random quantiles retain equal variance per simulated second");
    engine.destroy();
  }
});

for (const worker of [false,true]) {
  test(`${worker?"Worker":"local"}: default 60fps retains the existing 1/60 World trajectory`,()=>{
    const env=environment(worker,123), reference=environment(false,123);
    const engine=worker?(env.init({fishCount:24,sharks:movementSpecs}),env.send({type:"resume"}),null):env.create({fishCount:24},movementSpecs);
    const baseline=reference.create({fishCount:24,paused:true},movementSpecs);
    for(let i=1;i<=120;i++){
      worker?env.timer(i*1000/60):env.frame(i*1000/60);
      baseline.world.step(1/60);
    }
    assert.equal(motionState(env.world),motionState(baseline.world));
    engine?.destroy();baseline.destroy();
  });
  for(const fps of [90,120,144]) {
    test(`${worker?"Worker":"local"}: ${fps}fps changes real fish and shark positions on every nominal frame`,()=>{
      const env=environment(worker,456);
      const engine=worker?(env.init({fishCount:12,sharks:movementSpecs,maxFps:fps}),env.send({type:"resume"}),null):env.create({fishCount:12,maxFps:fps},movementSpecs);
      const positions=[];
      for(let i=1;i<=fps;i++){
        worker?env.timer(i*1000/fps):env.frame(i*1000/fps);
        const w=env.world,f=w.fish[0],s=w.sharks[0];
        positions.push([f.x,f.y,s.nodes[0],s.nodes[1]]);
        assert.ok([...w.fish.flatMap(f=>[f.x,f.y,f.vx,f.vy,f.phase,f.alarm]),...w.sharks.flatMap(s=>[...s.nodes,s.speed,s.phase])].every(Number.isFinite));
      }
      for(let i=1;i<positions.length;i++) {
        assert.notDeepEqual(positions[i].slice(0,2),positions[i-1].slice(0,2),"fish move between high-refresh frames");
        assert.notDeepEqual(positions[i].slice(2),positions[i-1].slice(2),"sharks move between high-refresh frames");
      }
      assert.ok(Math.abs(env.world.time-1)<1e-9);assert.equal(env.world.fish.length,12);assert.equal(env.world.sharks.length,2);
      engine?.destroy();
    });
  }
}
