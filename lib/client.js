(() => {
  // src/ascii-sharks/math.ts
  var TAU = Math.PI * 2;
  var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  var rand = (lo, hi) => lo + Math.random() * (hi - lo);
  var randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }
  function hash3(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  var K1 = 1 / 260;
  var K2 = 1 / 310;
  var K3 = 1 / 190;
  var CURRENT_SCALE = 3400;
  function current(x, y, t, out) {
    const a = x * K1 + t * 0.07;
    const b = y * K2 - t * 0.05;
    const c = (x + y) * K3 + t * 0.11;
    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
    return out;
  }

  // src/ascii-sharks/species.ts
  var SPECIES = [
    {
      name: "sardine",
      cruise: 36,
      maxSpeed: 64,
      minSpeed: 18,
      weight: 3,
      schoolSize: [18, 28],
      spacing: [1.8, 1.1],
      align: 1.6,
      cohesion: 1.6,
      jitter: 40,
      mill: 70,
      verticalDrag: 0.5
    },
    {
      name: "anchovy",
      cruise: 46,
      maxSpeed: 78,
      minSpeed: 22,
      weight: 3,
      schoolSize: [20, 32],
      spacing: [1.5, 1],
      align: 3.2,
      cohesion: 0.45,
      jitter: 30,
      mill: 0,
      verticalDrag: 1.4
    },
    {
      name: "silverside",
      cruise: 40,
      maxSpeed: 70,
      minSpeed: 20,
      weight: 3,
      schoolSize: [12, 20],
      spacing: [2, 1.1],
      align: 2.4,
      cohesion: 1.1,
      jitter: 35,
      mill: 0,
      verticalDrag: 1.6
    },
    {
      name: "mackerel",
      cruise: 32,
      maxSpeed: 60,
      minSpeed: 16,
      weight: 2,
      schoolSize: [5, 9],
      spacing: [2.6, 1.3],
      align: 2,
      cohesion: 0.9,
      jitter: 25,
      mill: 0,
      verticalDrag: 2
    },
    {
      name: "goby",
      cruise: 26,
      maxSpeed: 56,
      minSpeed: 10,
      weight: 1,
      schoolSize: [8, 12],
      spacing: [1.4, 1.1],
      align: 0.35,
      cohesion: 1.4,
      jitter: 110,
      mill: 0,
      verticalDrag: 0.3
    }
  ];
  var TOTAL_WEIGHT = SPECIES.reduce((sum, s) => sum + s.weight, 0);
  function pickSpecies() {
    let r = Math.random() * TOTAL_WEIGHT;
    for (let i = 0; i < SPECIES.length; i++) {
      r -= SPECIES[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  // src/ascii-sharks/world.ts
  var SHARK_NODES = 20;
  var DEFAULT_SHARKS = [
    { kind: "classic", size: 1 },
    { kind: "classic", size: 0.7 },
    { kind: "classic", size: 0.84 },
    { kind: "classic", size: 0.77 }
  ];
  var FISH_SEPARATION_K = 420;
  var FISH_ALIGN_K = 1.4;
  var FISH_COHESION_K = 1;
  var FISH_FLEE_K = 1100;
  var BLIND_COS = -0.6;
  var REFERENCE_STEP = 1 / 60;
  var SHARK_KINDS = /* @__PURE__ */ new Set(["classic", "hammerhead", "zebra", "tiger", "greathammer", "mako", "thresher", "nurse"]);
  function validSharks(specs) {
    return specs.filter((spec) => spec && SHARK_KINDS.has(spec.kind) && Number.isFinite(spec.size) && spec.size > 0).slice(0, 12).map(({ kind, size }) => ({ kind, size: clamp(size, 0.1, 2) }));
  }
  function population(value, fallback) {
    if (value === null) return null;
    return typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), 0, 600) : fallback;
  }
  var World = class {
    width = 0;
    height = 0;
    time = 0;
    fish = [];
    sharks = [];
    events = [];
    pointer = { x: 0, y: 0, active: false };
    /** Fish neighbourhood radius; the spatial hash bucket size matches it. */
    perception = 60;
    /** Per-species personal space in px (x, y). */
    sepX = [];
    sepY = [];
    foreignSep = 40;
    bucketCols = 0;
    bucketRows = 0;
    bucketHead = new Int32Array(0);
    bucketCount = new Uint16Array(0);
    bucketNext = new Int32Array(0);
    lastSpawn = 0;
    tmp = { x: 0, y: 0 };
    initialized = false;
    nextSharkId = 1;
    sharkSpecs;
    fishCount;
    /** null keeps the original area-based population; zero is an empty ocean. */
    constructor(sharkSpecs = DEFAULT_SHARKS, fishCount = null) {
      this.sharkSpecs = validSharks(Array.isArray(sharkSpecs) ? sharkSpecs : DEFAULT_SHARKS);
      this.fishCount = population(fishCount, null);
    }
    /** Apply population changes without restarting time or moving retained animals. */
    configure(options) {
      if (options.fishCount !== void 0) this.fishCount = population(options.fishCount, this.fishCount);
      const sharksChanged = Array.isArray(options.sharks);
      if (sharksChanged) this.sharkSpecs = validSharks(options.sharks);
      if (!this.initialized) return;
      this.resizePopulation();
      if (sharksChanged) this.reconcileSharks();
    }
    resize(width, height, cellW, cellH) {
      this.width = width;
      this.height = height;
      this.sepX = SPECIES.map((sp) => sp.spacing[0] * cellW);
      this.sepY = SPECIES.map((sp) => sp.spacing[1] * cellH);
      this.perception = Math.max(cellH * 3, cellW * 5.5);
      this.foreignSep = cellW * 3;
      if (!this.initialized) {
        this.seed();
        return;
      }
      for (const f of this.fish) {
        f.x = clamp(f.x, 0, width);
        f.y = clamp(f.y, 0, height);
      }
      this.resizePopulation();
    }
    seed() {
      this.initialized = true;
      this.sharks = this.sharkSpecs.map((spec, index) => this.createShark(spec, index, this.sharkSpecs.length));
      this.sharks.sort((a, b) => a.length - b.length);
      this.fish = [];
      this.resizePopulation();
    }
    createShark({ kind, size }, index, count) {
      const { width: W, height: H } = this;
      const minSide = Math.min(W, H);
      const length = clamp(minSide * 0.44, 170, 430) * size;
      const orbitRadius = minSide * rand(0.28, 0.4);
      const a = index / count * TAU + rand(-0.4, 0.4);
      const orbitDir = index % 2 === 0 ? 1 : -1;
      const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;
      const y = H / 2 + Math.sin(a) * orbitRadius;
      const heading = a + orbitDir * Math.PI / 2;
      const nodes = new Float32Array(SHARK_NODES * 2);
      const seg = length / (SHARK_NODES - 1);
      for (let n = 0; n < SHARK_NODES; n++) {
        nodes[n * 2] = x - Math.cos(heading) * seg * n;
        nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
      }
      return {
        id: this.nextSharkId++,
        kind,
        length,
        nodes,
        heading,
        speed: 30,
        phase: rand(0, TAU),
        turn: 0,
        hunger: rand(0.25, 0.75),
        wander: 0,
        orbitDir,
        orbitRadius,
        target: null,
        retargetAt: this.time,
        depth: size
      };
    }
    reconcileSharks() {
      const available = this.sharks.slice();
      this.sharks = this.sharkSpecs.map((spec, index) => {
        let match = available.findIndex((shark2) => shark2.kind === spec.kind && shark2.depth === spec.size);
        if (match < 0) match = available.findIndex((shark2) => shark2.kind === spec.kind);
        if (match < 0) return this.createShark(spec, index, this.sharkSpecs.length);
        const shark = available.splice(match, 1)[0];
        if (shark.depth !== spec.size) {
          const ratio = spec.size / shark.depth;
          for (let k = 1; k < SHARK_NODES; k++) {
            shark.nodes[k * 2] = shark.nodes[0] + (shark.nodes[k * 2] - shark.nodes[0]) * ratio;
            shark.nodes[k * 2 + 1] = shark.nodes[1] + (shark.nodes[k * 2 + 1] - shark.nodes[1]) * ratio;
          }
          shark.length *= ratio;
          shark.depth = spec.size;
        }
        return shark;
      });
      this.sharks.sort((a, b) => a.length - b.length);
    }
    resizePopulation() {
      const { width: W, height: H } = this;
      const total = this.fishCount ?? clamp(Math.round(W * H / 4400), 85, 340);
      if (this.fish.length === total) return;
      if (this.fish.length > total) {
        const survivors = this.fish.filter((fish) => fish.alive).slice(0, total);
        if (survivors.length < total) survivors.push(...this.fish.filter((fish) => !fish.alive).slice(0, total - survivors.length));
        this.fish = survivors;
        const retained = new Set(this.fish);
        for (const shark of this.sharks) if (shark.target && !retained.has(shark.target)) shark.target = null;
      }
      while (this.fish.length < total) {
        const species = pickSpecies();
        const sp = SPECIES[species];
        const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);
        const millDir = Math.random() < 0.5 ? 1 : -1;
        const cx = rand(W * 0.06, W * 0.94);
        const cy = rand(H * 0.08, H * 0.92);
        const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
        for (let k = 0; k < size; k++) {
          this.fish.push({
            x: cx + rand(-1, 1) * this.sepX[species] * Math.sqrt(size),
            y: cy + rand(-1, 1) * this.sepY[species] * Math.sqrt(size) * 0.6,
            vx: Math.cos(dir) * sp.cruise,
            vy: Math.sin(dir) * sp.cruise,
            species,
            alarm: 0,
            alive: true,
            respawnAt: 0,
            phase: rand(0, TAU),
            turn: 0,
            depth: rand(0.55, 1),
            millDir
          });
        }
      }
      this.bucketNext = new Int32Array(this.fish.length);
    }
    splash(x, y) {
      this.events.push({ kind: "splash", x, y });
      const r = 240;
      for (const f of this.fish) {
        if (!f.alive) continue;
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d > r || d < 1e-3) continue;
        const k = (1 - d / r) * 260;
        f.vx += dx / d * k;
        f.vy += dy / d * k;
        f.alarm = 1;
      }
    }
    step(dt) {
      this.time += dt;
      this.rebuildHash();
      const noiseScale = dt > 0 && Number.isFinite(dt) && dt !== REFERENCE_STEP ? Math.sqrt(REFERENCE_STEP / dt) : 1;
      this.stepFish(dt, noiseScale);
      this.stepSharks(dt, noiseScale);
      this.respawn();
    }
    rebuildHash() {
      const size = this.perception;
      const pad = 2;
      this.bucketCols = Math.ceil(this.width / size) + pad * 2;
      this.bucketRows = Math.ceil(this.height / size) + pad * 2;
      const n = this.bucketCols * this.bucketRows;
      if (this.bucketHead.length !== n) {
        this.bucketHead = new Int32Array(n);
        this.bucketCount = new Uint16Array(n);
      }
      this.bucketHead.fill(-1);
      this.bucketCount.fill(0);
      if (this.bucketNext.length !== this.fish.length) {
        this.bucketNext = new Int32Array(this.fish.length);
      }
      for (let i = 0; i < this.fish.length; i++) {
        const f = this.fish[i];
        if (!f.alive) continue;
        const b = this.bucketOf(f.x, f.y);
        this.bucketNext[i] = this.bucketHead[b];
        this.bucketHead[b] = i;
        this.bucketCount[b]++;
      }
    }
    bucketOf(x, y) {
      const size = this.perception;
      const c = clamp(Math.floor(x / size) + 2, 0, this.bucketCols - 1);
      const r = clamp(Math.floor(y / size) + 2, 0, this.bucketRows - 1);
      return r * this.bucketCols + c;
    }
    stepFish(dt, noiseScale) {
      const { fish, sharks, pointer, width: W, height: H, time } = this;
      const R = this.perception;
      const R2 = R * R;
      const foreignSep = this.foreignSep;
      const size = this.perception;
      const cols = this.bucketCols;
      const rows = this.bucketRows;
      const head = this.bucketHead;
      const next = this.bucketNext;
      const cur = this.tmp;
      const calmDecay = Math.exp(-dt * 0.7);
      const contagion = Math.min(1, dt * 6);
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i];
        if (!f.alive) continue;
        const sp = SPECIES[f.species];
        const spread = 1 + 1.8 * f.alarm;
        const sepX = this.sepX[f.species] * spread;
        const sepY = this.sepY[f.species] * spread;
        const speed = Math.hypot(f.vx, f.vy) || 1;
        const hx = f.vx / speed;
        const hy = f.vy / speed;
        let ax = 0;
        let ay = 0;
        let sx = 0;
        let sy = 0;
        let avx = 0;
        let avy = 0;
        let cx = 0;
        let cy = 0;
        let n = 0;
        let neighbourAlarm = 0;
        const bc = clamp(Math.floor(f.x / size) + 2, 0, cols - 1);
        const br = clamp(Math.floor(f.y / size) + 2, 0, rows - 1);
        for (let r = Math.max(0, br - 1); r <= Math.min(rows - 1, br + 1); r++) {
          for (let c = Math.max(0, bc - 1); c <= Math.min(cols - 1, bc + 1); c++) {
            let j = head[r * cols + c];
            while (j !== -1) {
              if (j !== i) {
                const o = fish[j];
                const dx = o.x - f.x;
                const dy = o.y - f.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < R2 && d2 > 1e-6) {
                  const d = Math.sqrt(d2);
                  if ((dx * hx + dy * hy) / d > BLIND_COS) {
                    const qx = dx / sepX;
                    const qy = dy / sepY;
                    const q2 = qx * qx + qy * qy;
                    if (q2 < 1) {
                      const q = Math.sqrt(q2) || 1e-3;
                      const k = (1 - q) / q;
                      sx -= qx * k;
                      sy -= qy * k;
                    }
                    if (o.species === f.species) {
                      avx += o.vx;
                      avy += o.vy;
                      cx += dx;
                      cy += dy;
                      n++;
                    } else if (d < foreignSep) {
                      const k = (1 - d / foreignSep) / d * 0.6;
                      sx -= dx * k;
                      sy -= dy * k;
                    }
                    if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
                  }
                }
              }
              j = next[j];
            }
          }
        }
        ax += sx * FISH_SEPARATION_K;
        ay += sy * FISH_SEPARATION_K;
        if (n > 0) {
          const alignK = FISH_ALIGN_K * sp.align;
          const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm);
          ax += (avx / n - f.vx) * alignK + cx / n * cohesionK;
          ay += (avy / n - f.vy) * alignK + cy / n * cohesionK;
          if (sp.mill > 0) {
            const cl = Math.hypot(cx, cy) || 1;
            ax += -cy / cl * f.millDir * sp.mill * (1 - f.alarm);
            ay += cx / cl * f.millDir * sp.mill * (1 - f.alarm);
          }
        }
        let fear = 0;
        for (const sh of sharks) {
          const fearR = sh.length * 0.6 + 60;
          let best = Infinity;
          let bx = 0;
          let by = 0;
          for (let k = 0; k <= 12; k += 3) {
            const nx = sh.nodes[k * 2];
            const ny = sh.nodes[k * 2 + 1];
            const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;
            if (d2 < best) {
              best = d2;
              bx = nx;
              by = ny;
            }
          }
          const d = Math.sqrt(best);
          if (d >= fearR || d < 1e-3) continue;
          let w = 1 - d / fearR;
          w *= w;
          const awayX = (f.x - bx) / d;
          const awayY = (f.y - by) / d;
          const shx = Math.cos(sh.heading);
          const shy = Math.sin(sh.heading);
          const side = shx * (f.y - sh.nodes[1]) - shy * (f.x - sh.nodes[0]) >= 0 ? 1 : -1;
          ax += (awayX * 0.7 - shy * side * 0.9) * FISH_FLEE_K * w;
          ay += (awayY * 0.7 + shx * side * 0.9) * FISH_FLEE_K * w;
          fear = Math.max(fear, Math.sqrt(w));
        }
        if (pointer.active) {
          const pr = 130;
          const dx = f.x - pointer.x;
          const dy = f.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < pr && d > 1e-3) {
            const w = (1 - d / pr) ** 2;
            ax += dx / d * FISH_FLEE_K * w;
            ay += dy / d * FISH_FLEE_K * w;
            fear = Math.max(fear, Math.sqrt(w) * 0.8);
          }
        }
        let alarm = Math.max(f.alarm * calmDecay, fear);
        const relayed = neighbourAlarm * 0.86;
        if (relayed > alarm) alarm += (relayed - alarm) * contagion;
        f.alarm = alarm;
        const m = 36;
        if (f.x < m) ax += (m - f.x) * 7;
        else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;
        if (f.y < m) ay += (m - f.y) * 7;
        else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;
        current(f.x, f.y, time, cur);
        ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter * noiseScale;
        ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter * noiseScale;
        ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);
        const preferred = sp.cruise * (1 + 1.3 * f.alarm);
        ax += (preferred - speed) * hx * 1.6;
        ay += (preferred - speed) * hy * 1.6;
        const before = Math.atan2(f.vy, f.vx);
        f.vx += ax * dt;
        f.vy += ay * dt;
        const maxSpeed = sp.maxSpeed * (1 + 1.8 * f.alarm);
        const s = Math.hypot(f.vx, f.vy);
        if (s > maxSpeed) {
          f.vx *= maxSpeed / s;
          f.vy *= maxSpeed / s;
        } else if (s < sp.minSpeed && s > 1e-3) {
          f.vx *= sp.minSpeed / s;
          f.vy *= sp.minSpeed / s;
        }
        f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
        f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12);
        f.x = clamp(f.x + f.vx * dt, -60, W + 60);
        f.y = clamp(f.y + f.vy * dt, -60, H + 60);
      }
    }
    stepSharks(dt, noiseScale) {
      const { sharks, width: W, height: H, time } = this;
      const minSide = Math.min(W, H);
      const cxW = W / 2;
      const cyW = H / 2;
      for (const sh of sharks) {
        const L = sh.length;
        const nodes = sh.nodes;
        const hx = nodes[0];
        const hy = nodes[1];
        sh.hunger = Math.min(1, sh.hunger + dt * 0.03);
        let dx = Math.cos(sh.heading);
        let dy = Math.sin(sh.heading);
        sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2 * noiseScale, -1.1, 1.1);
        dx += Math.cos(sh.heading + sh.wander) * 0.45;
        dy += Math.sin(sh.heading + sh.wander) * 0.45;
        if (time >= sh.retargetAt) {
          sh.target = this.findPrey(sh);
          sh.retargetAt = time + 0.45;
        }
        const t = sh.target;
        let hunting = false;
        let closing = 0;
        if (t && t.alive && sh.hunger > 0.3) {
          const tx = t.x + t.vx * 0.35 - hx;
          const ty = t.y + t.vy * 0.35 - hy;
          const d = Math.hypot(tx, ty) || 1;
          const w = 1.4 + 2.6 * sh.hunger;
          dx += tx / d * w;
          dy += ty / d * w;
          hunting = true;
          closing = clamp(1 - d / (L * 0.9), 0, 1);
        } else {
          const rx = (hx - cxW) / (W / minSide);
          const ry = hy - cyW;
          const r = Math.hypot(rx, ry) || 1;
          const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));
          const radial = clamp((radius - r) / radius, -1, 1);
          dx += (-ry / r * sh.orbitDir + rx / r * radial * 0.9) * 0.55;
          dy += (rx / r * sh.orbitDir + ry / r * radial * 0.9) * 0.55;
        }
        for (const other of sharks) {
          if (other === sh) continue;
          for (let k = 0; k < SHARK_NODES; k += 4) {
            const ox = hx - other.nodes[k * 2];
            const oy = hy - other.nodes[k * 2 + 1];
            const d = Math.hypot(ox, oy);
            const range = (L + other.length) * 0.45;
            if (d < range && d > 1e-3) {
              const w = (1 - d / range) * 3;
              dx += ox / d * w;
              dy += oy / d * w;
            }
          }
        }
        const ex = (hx - cxW) / (W * 0.3);
        const ey = (hy - cyW) / (H * 0.16);
        const e2 = ex * ex + ey * ey;
        if (e2 < 1) {
          const e = Math.sqrt(e2) || 1e-3;
          const w = (1 - e) * (hunting ? 1 : 2.5);
          dx += ex / e * w;
          dy += ey / e * w;
        }
        const over = Math.max(-hx, hx - W, -hy, hy - H);
        if (over > -L * 0.05) {
          const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
          const toX = cxW - hx;
          const toY = cyW - hy;
          const d = Math.hypot(toX, toY) || 1;
          dx += toX / d * w;
          dy += toY / d * w;
        }
        const desired = Math.atan2(dy, dx);
        const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * 0.22));
        const maxTurn = agility * dt;
        const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
        sh.heading += turned;
        sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);
        const cruise = 30 + L * 0.04;
        const targetSpeed = hunting ? cruise * (1.45 + closing * 1.5) : cruise;
        sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);
        sh.phase += dt * (2 + sh.speed / 24);
        nodes[0] += Math.cos(sh.heading) * sh.speed * dt;
        nodes[1] += Math.sin(sh.heading) * sh.speed * dt;
        const seg = L / (SHARK_NODES - 1);
        const maxBend = 0.16;
        let prevAngle = sh.heading + Math.PI;
        for (let k = 1; k < SHARK_NODES; k++) {
          const px = nodes[(k - 1) * 2];
          const py = nodes[(k - 1) * 2 + 1];
          let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);
          angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
          nodes[k * 2] = px + Math.cos(angle) * seg;
          nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
          prevAngle = angle;
        }
        if (sh.hunger > 0.15) {
          const mouthR = L * 0.05 + 8;
          const mx = nodes[0];
          const my = nodes[1];
          for (const f of this.fish) {
            if (!f.alive) continue;
            if ((f.x - mx) ** 2 + (f.y - my) ** 2 < mouthR * mouthR) {
              f.alive = false;
              f.respawnAt = time + rand(3, 8);
              sh.hunger = Math.max(0, sh.hunger - 0.16);
              this.events.push({ kind: "eat", x: f.x, y: f.y });
            }
          }
        }
      }
    }
    /**
     * Pick prey in the shark's forward cone, preferring close fish in sparse
     * buckets (stragglers) over fish buried in a dense school.
     */
    findPrey(sh) {
      const range = sh.length * 0.9 + 160;
      const hx = sh.nodes[0];
      const hy = sh.nodes[1];
      const fx = Math.cos(sh.heading);
      const fy = Math.sin(sh.heading);
      let best = null;
      let bestScore = Infinity;
      let currentScore = Infinity;
      for (const f of this.fish) {
        if (!f.alive) continue;
        const dx = f.x - hx;
        const dy = f.y - hy;
        const d = Math.hypot(dx, dy);
        if (d > range || d < 1e-3) continue;
        const cos = (dx * fx + dy * fy) / d;
        if (cos < 0.2) continue;
        const crowd = this.bucketCount[this.bucketOf(f.x, f.y)];
        const score = d * (1 + (1 - cos) * 0.8) * (1 + crowd * 0.07);
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
        if (f === sh.target) currentScore = score;
      }
      if (sh.target && currentScore < bestScore * 1.3) return sh.target;
      return best;
    }
    respawn() {
      const { time, width: W, height: H } = this;
      const due = [];
      for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);
      if (due.length === 0) return;
      if (due.length < 6 && time - this.lastSpawn < 9) return;
      this.lastSpawn = time;
      const side = randInt(0, 3);
      const along = rand(0.15, 0.85);
      const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
      const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
      const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
      const species = pickSpecies();
      const sp = SPECIES[species];
      const millDir = Math.random() < 0.5 ? 1 : -1;
      for (const f of due.slice(0, sp.schoolSize[1])) {
        f.alive = true;
        f.species = species;
        f.alarm = 0;
        f.turn = 0;
        f.millDir = millDir;
        f.x = x + rand(-1, 1) * this.perception;
        f.y = y + rand(-1, 1) * this.perception;
        f.vx = Math.cos(inward) * sp.cruise * 1.4;
        f.vy = Math.sin(inward) * sp.cruise * 1.4;
      }
    }
  };

  // src/ascii-sharks/renderer.ts
  var ALPHA_LEVELS = 6;
  var FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];
  var DOT_RGB = [
    [48, 52, 235],
    [52, 205, 60],
    [228, 50, 44],
    [190, 212, 255],
    [110, 230, 255]
  ];
  var DOT_BASE_ALPHA = [1, 1, 1, 1, 1];
  var WAKE = DOT_RGB.length - 1;
  var ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
  var SKIN_RAMP = ":;t%SX8#@";
  var FIN_GLYPHS = "%;tS:";
  var RIDGE_GLYPHS = "@8%";
  var EDGE_HEAVY = ":;";
  var EDGE_LIGHT = ".',`";
  var FLAG_BODY = 1;
  var FLAG_EDGE = 2;
  var FLAG_FIN = 3;
  var FLAG_RIDGE = 4;
  var FLAG_EYE = 5;
  var FLAG_MARK = 6;
  var MARK_GLYPHS = "#%@";
  var SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
  function classicHalfWidth(s) {
    if (s < 0.13) return 0.09 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.95);
    if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
    if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
    const k = (s - 0.84) / 0.16;
    return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
  }
  var SHAPES = {
    classic: {
      halfWidth: classicHalfWidth,
      pectoral: [0.15, 0.43, 0.55, 0.26],
      falcate: true,
      pelvic: [0.57, 0.65, 0.69, 0.085],
      caudal: 0.085,
      dorsal: [0.33, 0.47],
      secondDorsal: [0.71, 0.76],
      eye: [0.1, 0.14],
      gills: [0.19, 0.29],
      tint: [0.92, 0.97, 1.05]
    },
    // Slim neck under a wide, swept-back cephalofoil (drawn in sampleShark),
    // tall first dorsal, long upper tail lobe. Bronze-olive grey.
    hammerhead: {
      halfWidth: (s) => {
        if (s < 0.06) return 0.045;
        if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
        return classicHalfWidth(s) * 0.92;
      },
      head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
      pectoral: [0.17, 0.4, 0.5, 0.22],
      falcate: true,
      pelvic: [0.56, 0.63, 0.67, 0.075],
      caudal: 0.11,
      dorsal: [0.28, 0.44],
      secondDorsal: [0.7, 0.74],
      eye: null,
      gills: [0.16, 0.26],
      tint: [0.96, 0.98, 0.9]
    },
    // Blunt, square snout on a heavy body; barred back. Warm grey-brown.
    tiger: {
      halfWidth: (s) => {
        if (s < 0.13) return 0.1 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.45);
        if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
        if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
        const k = (s - 0.84) / 0.16;
        return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
      },
      pectoral: [0.15, 0.42, 0.53, 0.25],
      falcate: true,
      pelvic: [0.57, 0.65, 0.69, 0.085],
      caudal: 0.095,
      dorsal: [0.33, 0.46],
      secondDorsal: [0.71, 0.75],
      eye: [0.08, 0.12],
      gills: [0.19, 0.28],
      tint: [1.02, 0.95, 0.84]
    },
    // Short rounded head, body done by half-length, then a long ribbon of a
    // tail fin. Broad rounded pectorals, spotted sandy skin.
    zebra: {
      halfWidth: (s) => {
        if (s < 0.1) return 0.075 * Math.pow(Math.sin(s / 0.1 * Math.PI / 2), 0.7);
        if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
        if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
        const k = (s - 0.55) / 0.45;
        return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
      },
      pectoral: [0.12, 0.3, 0.36, 0.19],
      falcate: false,
      pelvic: [0.42, 0.48, 0.51, 0.065],
      caudal: 0,
      dorsal: [0.36, 0.44],
      secondDorsal: [0.49, 0.53],
      eye: [0.06, 0.09],
      gills: [0.13, 0.2],
      tint: [1.08, 0.97, 0.74]
    },
    // Great hammerhead: a broader, nearly straight-edged cephalofoil with a notch at the centre,
    // a towering sickle first dorsal (drawn long and bright from above), and a cooler slate skin.
    greathammer: {
      halfWidth: (s) => {
        if (s < 0.05) return 0.04;
        if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
        return classicHalfWidth(s) * 0.95;
      },
      head: { span: 0.21, sweep: 6e-3, depth: 0.085, notch: 0.014 },
      pectoral: [0.16, 0.38, 0.49, 0.24],
      falcate: true,
      pelvic: [0.55, 0.62, 0.67, 0.085],
      caudal: 0.13,
      dorsal: [0.24, 0.45],
      secondDorsal: [0.68, 0.74],
      eye: null,
      gills: [0.15, 0.25],
      tint: [0.86, 0.93, 1.02]
    },
    // Shortfin mako: a long conical snout, a torpedo body that narrows hard to the tail stalk,
    // and a tall crescent tail. Metallic indigo back.
    mako: {
      halfWidth: (s) => {
        if (s < 0.17) return 0.088 * Math.pow(Math.sin(s / 0.17 * Math.PI / 2), 1.5);
        if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
        if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
        const k = (s - 0.86) / 0.14;
        return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
      },
      pectoral: [0.18, 0.4, 0.5, 0.21],
      falcate: true,
      pelvic: [0.58, 0.64, 0.68, 0.06],
      caudal: 0.13,
      dorsal: [0.34, 0.45],
      secondDorsal: [0.76, 0.79],
      eye: [0.11, 0.15],
      gills: [0.2, 0.3],
      tint: [0.78, 0.9, 1.2]
    },
    // Thresher: a compact body over the front half, then the upper tail lobe as a long whip
    // that's as long as the shark itself. Big eyes, long sickle pectorals, bronze-violet skin.
    thresher: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.07 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.75);
        if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
        if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
        const k = (s - 0.48) / 0.52;
        return 0.012 * (1 - k) + 6e-3 * Math.sin(k * Math.PI * 0.9) + 2e-3;
      },
      pectoral: [0.12, 0.27, 0.36, 0.2],
      falcate: true,
      pelvic: [0.37, 0.41, 0.44, 0.045],
      caudal: 0,
      dorsal: [0.24, 0.32],
      secondDorsal: [0.45, 0.47],
      eye: [0.05, 0.1],
      gills: [0.11, 0.18],
      tint: [1, 0.9, 1.08]
    },
    // Nurse shark: a blunt, broad head, a heavy flattened body with both dorsals set far back,
    // rounded paddle pectorals, and a long low tail with no lower lobe. Tawny brown.
    nurse: {
      halfWidth: (s) => {
        if (s < 0.08) return 0.085 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.4);
        if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
        if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
        const k = (s - 0.72) / 0.28;
        return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
      },
      pectoral: [0.16, 0.34, 0.4, 0.17],
      falcate: false,
      pelvic: [0.45, 0.52, 0.55, 0.075],
      caudal: 0,
      dorsal: [0.5, 0.58],
      secondDorsal: [0.63, 0.69],
      eye: [0.05, 0.075],
      gills: [0.14, 0.22],
      tint: [1.1, 0.96, 0.76]
    }
  };
  var KINDS = Object.keys(SHAPES);
  function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }
  function paintGrid(g, W, H, cw, ch, dpr) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = "rgba(255,255,255,0.055)";
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 0; c <= Math.ceil(W / cw); c++) {
      const x = Math.round(c * cw * dpr) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, H * dpr);
    }
    for (let r = 0; r <= Math.ceil(H / ch); r++) {
      const y = Math.round(r * ch * dpr) + 0.5;
      g.moveTo(0, y);
      g.lineTo(W * dpr, y);
    }
    g.stroke();
  }
  var AsciiRenderer = class {
    constructor(canvas) {
      this.canvas = canvas;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("2D canvas unavailable");
      this.ctx = ctx;
      this.bg = typeof document !== "undefined" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
      for (let c = 0; c < DOT_RGB.length; c++) {
        const [r, g, b] = DOT_RGB[c];
        for (let l = 0; l < ALPHA_LEVELS; l++) {
          const a = DOT_BASE_ALPHA[c] * (l + 1) / ALPHA_LEVELS;
          this.dotStyles.push(`rgba(${r},${g},${b},${a.toFixed(3)})`);
        }
      }
    }
    ctx;
    bg;
    dpr = 1;
    width = 0;
    height = 0;
    cw = 12;
    ch = 18;
    cols = 0;
    rows = 0;
    fontFamily = "ui-monospace, Menlo, monospace";
    dotKind = new Uint8Array(0);
    // 0 none, 1 blue, 2 green, 3 red, 4 pale
    dotPhase = new Float32Array(0);
    dotFreq = new Float32Array(0);
    energy = new Float32Array(0);
    energyTmp = new Float32Array(0);
    heat = new Float32Array(0);
    bucketOf = new Uint8Array(0);
    bucketOrder = new Int32Array(0);
    bucketCounts = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);
    dotStyles = [];
    sharkFlag = new Uint8Array(0);
    sharkShade = new Float32Array(0);
    sharkKey = new Uint32Array(0);
    sharkDepth = new Float32Array(0);
    sharkKind = new Uint8Array(0);
    /** Cells darkened by a shark's shadow on the seabed. */
    sharkShadow = new Uint8Array(0);
    spine = new Float32Array(SHARK_NODES * 2);
    arc = new Float32Array(SHARK_NODES);
    arcTotal = 1;
    shape = SHAPES.classic;
    sharkId = 0;
    finTipLeft = 0;
    finTipRight = 0;
    // Scratch outputs of sampleShark(), to avoid allocating per sample.
    hitFlag = 0;
    hitShade = 0;
    hitS = 0;
    hitV = 0;
    hitDist = 0;
    /** Cells holding a fish this frame (frame stamp); dots skip them. */
    fishStamp = new Uint32Array(0);
    frameId = 0;
    /** Fish cells bucketed by brightness, so each bucket is one fillStyle. */
    fishBuckets = FISH_ALPHAS.map(() => []);
    fishStyles = FISH_ALPHAS.map((a) => `rgba(230,238,255,${a})`);
    /** High-refresh frames share the original 60 Hz wake cadence. */
    fieldStep = 0;
    fieldAcc = 0;
    get cellWidth() {
      return this.cw;
    }
    get cellHeight() {
      return this.ch;
    }
    setFontFamily(family) {
      if (family) this.fontFamily = family;
    }
    resize(width, height, dpr) {
      this.fieldAcc = 0;
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.cw = clamp(Math.round(width / 124), 8, 13);
      this.ch = Math.round(this.cw * 1.45);
      this.cols = Math.ceil(width / this.cw);
      this.rows = Math.ceil(height / this.ch);
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.bg.width = this.canvas.width;
      this.bg.height = this.canvas.height;
      const n = this.cols * this.rows;
      this.dotKind = new Uint8Array(n);
      this.dotPhase = new Float32Array(n);
      this.dotFreq = new Float32Array(n);
      this.energy = new Float32Array(n);
      this.energyTmp = new Float32Array(n);
      this.heat = new Float32Array(n);
      this.bucketOf = new Uint8Array(n);
      this.bucketOrder = new Int32Array(n);
      this.sharkFlag = new Uint8Array(n);
      this.sharkShade = new Float32Array(n);
      this.sharkKey = new Uint32Array(n);
      this.sharkDepth = new Float32Array(n);
      this.sharkKind = new Uint8Array(n);
      this.sharkShadow = new Uint8Array(n);
      this.fishStamp = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        const col = i % this.cols;
        const row = i / this.cols | 0;
        this.dotKind[i] = 0;
        this.dotPhase[i] = hash3(col, row, 23) * Math.PI * 2;
        this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;
      }
      this.paintBackground();
    }
    paintBackground() {
      const g = this.bg.getContext("2d");
      if (!g) return;
      const { width: W, height: H, dpr, cw, ch } = this;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#000";
      g.fillRect(0, 0, W, H);
      paintGrid(g, W, H, cw, ch, dpr);
    }
    /** fieldStep is speed / 60 above 60 fps; omit it for legacy/still frames. */
    render(world, dt, fieldStep = 0) {
      const { ctx, dpr, cols, ch } = this;
      if (cols === 0) return;
      const t = world.time;
      this.consumeEvents(world);
      this.rasterizeSharks(world.sharks, t);
      const step = Number.isFinite(fieldStep) && fieldStep > 0 ? fieldStep : 0;
      if (step !== this.fieldStep) {
        this.fieldStep = step;
        this.fieldAcc = 0;
      }
      if (step === 0) {
        this.depositWake(world);
        this.diffuse(dt);
      } else {
        this.fieldAcc = Math.min(this.fieldAcc + (Number.isFinite(dt) ? Math.max(0, dt) : 0), step * 4);
        while (this.fieldAcc + 1e-10 >= step) {
          this.depositWake(world);
          this.diffuse(step);
          this.fieldAcc = Math.max(0, this.fieldAcc - step);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.markFish(world);
      this.drawDots(t);
      ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.drawHeat();
      this.drawFish();
      this.drawSharks(t);
    }
    // ── simulation → field ──────────────────────────────────────────────
    cellIndex(x, y) {
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
      return r * this.cols + c;
    }
    stamp(field, x, y, radius, amount) {
      const c0 = Math.floor(x / this.cw);
      const r0 = Math.floor(y / this.ch);
      for (let r = r0 - radius; r <= r0 + radius; r++) {
        for (let c = c0 - radius; c <= c0 + radius; c++) {
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const d = Math.hypot(c - c0, (r - r0) * 1.4);
          if (d > radius + 0.5) continue;
          const i = r * this.cols + c;
          field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));
        }
      }
    }
    consumeEvents(world) {
      for (const e of world.events) {
        if (e.kind === "eat") {
          this.stamp(this.heat, e.x, e.y, 2, 1);
          this.stamp(this.energy, e.x, e.y, 3, 0.9);
        } else {
          this.stamp(this.energy, e.x, e.y, 6, 1.4);
        }
      }
      world.events.length = 0;
    }
    depositWake(world) {
      const { energy } = this;
      for (const f of world.fish) {
        if (!f.alive) continue;
        const i = this.cellIndex(f.x, f.y);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.012 + f.alarm * 0.03);
      }
      for (const sh of world.sharks) {
        for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
          const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);
          if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.05 + sh.speed * 12e-4);
        }
      }
      if (world.pointer.active) {
        this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
      }
    }
    /** Blur + decay so wakes spread out like ripples and fade. */
    diffuse(dt) {
      const { cols, rows, energy, energyTmp: tmp, heat } = this;
      const decay = Math.exp(-dt * 1.5);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const l = c > 0 ? energy[i - 1] : energy[i];
          const rt = c < cols - 1 ? energy[i + 1] : energy[i];
          const u = r > 0 ? energy[i - cols] : energy[i];
          const d = r < rows - 1 ? energy[i + cols] : energy[i];
          tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;
        }
      }
      this.energy = tmp;
      this.energyTmp = energy;
      const heatDecay = Math.exp(-dt * 2.2);
      for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;
    }
    // ── sharks ──────────────────────────────────────────────────────────
    /**
     * Classify one point against the current shark (spine/arc already built).
     * Body coordinates: s along the spine (0 snout → 1 tail), v across it.
     * Writes hit* fields and returns whether the point is on the shark.
     */
    sampleShark(px, py, L) {
      const { spine, arc } = this;
      const N = SHARK_NODES;
      let best = Infinity;
      let bestSegment = 0;
      let bestU = 0;
      for (let k = 0; k < N - 1; k++) {
        const ax2 = spine[k * 2];
        const ay2 = spine[k * 2 + 1];
        const sx2 = spine[(k + 1) * 2] - ax2;
        const sy2 = spine[(k + 1) * 2 + 1] - ay2;
        const len2 = sx2 * sx2 + sy2 * sy2 || 1;
        const u2 = clamp(((px - ax2) * sx2 + (py - ay2) * sy2) / len2, 0, 1);
        const qx = ax2 + sx2 * u2;
        const qy = ay2 + sy2 * u2;
        const d2 = (px - qx) ** 2 + (py - qy) ** 2;
        if (d2 < best) {
          best = d2;
          bestSegment = k;
          bestU = u2;
        }
      }
      const ax = spine[bestSegment * 2];
      const ay = spine[bestSegment * 2 + 1];
      const sx = spine[(bestSegment + 1) * 2] - ax;
      const sy = spine[(bestSegment + 1) * 2 + 1] - ay;
      const len = Math.sqrt(sx * sx + sy * sy || 1);
      const bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
      const a = Math.sqrt(best);
      const s = (arc[bestSegment] + bestU * len) / this.arcTotal;
      const u = s * L;
      const shape = this.shape;
      const w = shape.halfWidth(s) * L;
      this.hitDist = a;
      this.hitS = s;
      this.hitV = a * bestSign;
      const head = this.shape.head;
      if (head && u < L * (head.sweep + head.depth + head.notch)) {
        const span = L * head.span;
        const r = a / span;
        const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
        const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
        if (r <= 1 && u >= front && u <= front + depth) {
          this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
          this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
          return true;
        }
      }
      if (a <= w) {
        const bestNx = -sy / len * bestSign;
        const bestNy = sx / len * bestSign;
        const across = a / (w || 1);
        const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
        let shade = 0.58 - across * across * 0.42 + facing * 0.26;
        let flag = FLAG_BODY;
        if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
          flag = FLAG_RIDGE;
          shade = 1;
        } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
          shade = Math.max(shade, 0.82);
        } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
          flag = FLAG_EYE;
          shade = 0;
        } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
          if (Math.floor((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0]) * 5) % 2 === 0) shade *= 0.45;
        } else if (s < 0.05) {
          shade = Math.max(shade, 0.7);
        } else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) {
          shade = Math.max(shade, 0.8);
        } else if (this.marked(s, a * bestSign, L, across)) {
          flag = FLAG_MARK;
        }
        this.hitFlag = flag;
        this.hitShade = shade;
        return true;
      }
      const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;
      const [p0, p1, p2] = shape.pectoral;
      if (inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) && // Falcate (sickle) fins get a concave trailing edge.
      !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))) {
        this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;
        this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
        return true;
      }
      const [v0, v1, v2, vr] = shape.pelvic;
      if (inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) || // Forked caudal fin.
      shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal)) {
        this.hitFlag = FLAG_FIN;
        this.hitShade = 0.36;
        return true;
      }
      return false;
    }
    /** Whether a body point (s along, v across) falls on a dark marking. */
    marked(s, v, L, across) {
      if (this.shape === SHAPES.tiger) {
        if (s < 0.2 || s > 0.9 || across > 0.85) return false;
        const wobble = 0.35 * Math.sin(v / L * 25 + s * 5);
        const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
        return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);
      }
      if (this.shape === SHAPES.zebra) {
        if (s < 0.07) return false;
        const gu = s * L / (L * 0.06);
        const gv = v / (L * 0.045);
        const cu = Math.floor(gu);
        const cv = Math.floor(gv);
        const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25;
        const jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;
        return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;
      }
      return false;
    }
    /**
     * Build a smooth, undulating render spine from the sim spine, then
     * supersample every cell in the shark's bounding box against the shape.
     * Fully covered cells become solid skin; partial cells become edge glyphs.
     */
    rasterizeSharks(sharks, t) {
      const { sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, sharkShadow, spine, arc, cw, ch, cols, rows } = this;
      sharkFlag.fill(0);
      sharkShadow.fill(0);
      for (const sh of sharks) {
        const L = sh.length;
        const N = SHARK_NODES;
        const n = sh.nodes;
        const swim = clamp(sh.speed / 60, 0.4, 1.4);
        this.shape = SHAPES[sh.kind];
        this.sharkId = sh.id;
        const kindIndex = KINDS.indexOf(sh.kind);
        for (let k = 0; k < N; k++) {
          const s = k / (N - 1);
          const a = Math.max(0, k - 1);
          const b = Math.min(N - 1, k + 1);
          let tx = n[a * 2] - n[b * 2];
          let ty = n[a * 2 + 1] - n[b * 2 + 1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const amp = L * 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
          const off = amp * Math.sin(sh.phase - s * 5.2);
          spine[k * 2] = n[k * 2] - ty * off;
          spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;
        }
        arc[0] = 0;
        for (let k = 1; k < N; k++) {
          arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);
        }
        this.arcTotal = arc[N - 1] || 1;
        const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
        const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
        const reachFin = this.shape.pectoral[3];
        this.finTipRight = L * reachFin * flex * (1 - bank);
        this.finTipLeft = L * reachFin * flex * (1 + bank);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let k = 0; k < N; k++) {
          minX = Math.min(minX, spine[k * 2]);
          maxX = Math.max(maxX, spine[k * 2]);
          minY = Math.min(minY, spine[k * 2 + 1]);
          maxY = Math.max(maxY, spine[k * 2 + 1]);
        }
        const reach = L * 0.36;
        const c0 = Math.max(0, Math.floor((minX - reach) / cw));
        const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
        const r0 = Math.max(0, Math.floor((minY - reach) / ch));
        const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
        if (c0 > c1 || r0 > r1) continue;
        const skipBeyond = reach + Math.hypot(cw, ch);
        const shadowDc = Math.round(L * 0.035 / cw) + 1;
        const shadowDr = Math.round(L * 0.02 / ch) + 1;
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const x = c * cw;
            const y = r * ch;
            const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);
            if (!centerHit && this.hitDist > skipBeyond) continue;
            const flag = this.hitFlag;
            const shade = this.hitShade;
            const s = this.hitS;
            const v = this.hitV;
            let hits = centerHit ? 1 : 0;
            for (let k = 0; k < SUBSAMPLES.length; k += 2) {
              if (this.sampleShark(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) hits++;
            }
            if (hits === 0) continue;
            const coverage = hits / 5;
            const i = r * cols + c;
            const key = hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295 >>> 0;
            sharkKey[i] = key;
            sharkDepth[i] = sh.depth;
            sharkKind[i] = kindIndex;
            if (centerHit && coverage >= 0.6) {
              sharkFlag[i] = flag;
              const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06;
              sharkShade[i] = clamp(shade + flicker, 0, 1);
              const sc = c + shadowDc;
              const sr = r + shadowDr;
              if (sc < cols && sr < rows) sharkShadow[sr * cols + sc] = 1;
            } else {
              sharkFlag[i] = FLAG_EDGE;
              sharkShade[i] = coverage;
            }
          }
        }
      }
    }
    drawSharks(t) {
      const { ctx, cols, rows, cw, ch, sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind } = this;
      const n = cols * rows;
      for (let i = 0; i < n; i++) {
        const flag = sharkFlag[i];
        if (!flag) continue;
        const col = i % cols;
        const row = i / cols | 0;
        const x = col * cw;
        const y = row * ch;
        const key = sharkKey[i];
        const shade = sharkShade[i];
        const dim = 0.7 + 0.3 * sharkDepth[i];
        const [tr, tg, tb] = SHAPES[KINDS[sharkKind[i]]].tint;
        const tick = Math.floor(t * 2.4 + key % 997 / 97);
        const roll = hash3(key, tick, 7);
        if (flag === FLAG_EDGE) {
          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          const g = (70 + shade * 80) * dim;
          ctx.fillStyle = roll < 0.07 ? ACCENTS[key % ACCENTS.length] : `rgb(${Math.round(g * tr)},${Math.round(g * tg)},${Math.min(255, Math.round(g * tb + 6))})`;
          ctx.fillText(set[(key >>> 8) % set.length], x + cw / 2, y + ch / 2 + 1);
          continue;
        }
        let level;
        let glyph;
        if (flag === FLAG_RIDGE) {
          level = 226;
          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];
        } else if (flag === FLAG_EYE) {
          level = 12;
          glyph = "o";
        } else if (flag === FLAG_MARK) {
          level = 24 + shade * 22;
          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
        } else if (flag === FLAG_FIN) {
          level = 40 + shade * 120;
          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];
        } else {
          level = 46 + shade * 160;
          const jitter = (key >>> 4) % 3 - 1;
          glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];
        }
        level *= dim;
        ctx.fillStyle = `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb + 4))})`;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
        let color;
        if (flag === FLAG_EYE) color = "#9aa0ad";
        else if (flag === FLAG_MARK) color = `rgb(${Math.round(70 * tr)},${Math.round(70 * tg)},${Math.round(70 * tb)})`;
        else if (roll < 0.09) color = ACCENTS[key % ACCENTS.length];
        else if (roll < 0.13) color = "#ffffff";
        else color = shade > 0.55 ? "#0e0f13" : "#1b1d24";
        ctx.fillStyle = color;
        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
      }
    }
    // ── fish, dots, heat ────────────────────────────────────────────────
    /**
     * Snap each fish to a cell and bucket it by brightness: far fish are dim,
     * near fish brighter, and turning or panicking fish glint. Nearer fish
     * claim a cell first when two land in the same one.
     */
    markFish(world) {
      const { fishStamp, fishBuckets, sharkFlag } = this;
      const frame = ++this.frameId;
      for (const bucket of fishBuckets) bucket.length = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (const f of world.fish) {
          if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
          const i = this.cellIndex(f.x, f.y);
          if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
          fishStamp[i] = frame;
          const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
          const v = 0.3 + 0.4 * (f.depth - 0.55) / 0.45 + 0.3 * Math.max(glint, f.alarm);
          fishBuckets[clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)].push(i);
        }
      }
    }
    drawFish() {
      const { ctx, cw, ch, cols, fishBuckets } = this;
      for (let b = 0; b < fishBuckets.length; b++) {
        const bucket = fishBuckets[b];
        if (!bucket.length) continue;
        ctx.fillStyle = this.fishStyles[b];
        for (const i of bucket) {
          ctx.fillText("-", i % cols * cw + cw / 2, (i / cols | 0) * ch + ch / 2 + 1);
        }
      }
    }
    drawHeat() {
      const { ctx, heat, cols, cw, ch } = this;
      for (let i = 0; i < heat.length; i++) {
        const h = heat[i];
        if (h < 0.08) continue;
        const col = i % cols;
        const row = i / cols | 0;
        ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
        ctx.fillText(h > 0.6 ? "*" : "\xB7", col * cw + cw / 2, row * ch + ch / 2 + 1);
      }
    }
    /**
     * Every cell's dot twinkles on its own clock, is modulated by slow
     * caustic light bands, and flares cyan where the wake field is strong.
     * Dots are bucketed by colour/alpha so each bucket is one fillStyle.
     */
    drawDots(t) {
      const { ctx, cols, rows, cw, ch, dotKind, dotPhase, dotFreq, energy, sharkFlag, sharkShadow, fishStamp, frameId } = this;
      const { bucketOf, bucketOrder, bucketCounts } = this;
      const n = cols * rows;
      const SKIP = bucketCounts.length - 1;
      bucketCounts.fill(0);
      for (let i = 0; i < n; i++) {
        const e = energy[i];
        const kind = dotKind[i];
        if (sharkFlag[i] || fishStamp[i] === frameId || kind === 0 && e < 0.45) {
          bucketOf[i] = SKIP;
          continue;
        }
        let bucket;
        if (e > 0.45) {
          const level = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);
          bucket = WAKE * ALPHA_LEVELS + level;
        } else {
          const col = i % cols;
          const row = i / cols | 0;
          const twinkle = 0.5 + 0.5 * Math.sin(t * dotFreq[i] + dotPhase[i]);
          const caustic = 0.85 + 0.15 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);
          let v = clamp((0.55 + 0.45 * twinkle) * caustic + e * 2, 0, 1);
          if (sharkShadow[i]) v *= 0.2;
          bucket = (kind - 1) * ALPHA_LEVELS + clamp(Math.floor(v * ALPHA_LEVELS), 0, ALPHA_LEVELS - 1);
        }
        bucketOf[i] = bucket;
        bucketCounts[bucket]++;
      }
      const starts = new Int32Array(bucketCounts.length);
      for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1] + bucketCounts[b - 1];
      const cursor = starts.slice();
      for (let i = 0; i < n; i++) {
        const b = bucketOf[i];
        if (b !== SKIP) bucketOrder[cursor[b]++] = i;
      }
      const small = Math.max(2, Math.round(cw * 0.19));
      const large = small + 1;
      for (let b = 0; b < SKIP; b++) {
        const count = bucketCounts[b];
        if (!count) continue;
        ctx.fillStyle = this.dotStyles[b];
        const size = b >= WAKE * ALPHA_LEVELS ? large : small;
        const start = starts[b];
        for (let k = start; k < start + count; k++) {
          const i = bucketOrder[k];
          const col = i % cols;
          const row = i / cols | 0;
          ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
        }
      }
    }
  };

  // src/ascii-sharks/engine.ts
  var STEP = 1 / 60;
  var MAX_STEPS = 4;
  var FRAME_EPSILON = 0.5;
  function finiteRange(value, min, max, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  var INTERACTIVE_SELECTOR = [
    "a",
    "button",
    "input",
    "textarea",
    "select",
    "option",
    "label",
    "summary",
    '[contenteditable]:not([contenteditable="false"])',
    "[data-ocean-controls]",
    ...["button", "link", "textbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "tab", "menuitem", "option"].map((role) => `[role="${role}"]`)
  ].join(",");
  function isInteractiveTarget(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      const element2 = node;
      if (typeof element2?.matches === "function" && element2.matches(INTERACTIVE_SELECTOR)) return true;
    }
    const target = event.target;
    const element = typeof target?.closest === "function" ? target : target?.parentElement;
    return !!element?.closest?.(INTERACTIVE_SELECTOR);
  }
  var OceanEngine = class {
    constructor(canvas, sharks, options = {}) {
      this.canvas = canvas;
      this.maxFps = finiteRange(options.maxFps, 5, 144, 60);
      this.maxDpr = finiteRange(options.maxDpr, 1, 2, 2);
      this.speed = finiteRange(options.speed, 0.25, 2, 1);
      this.interactive = options.interactive !== false;
      this.initialStatic = options.initialStatic === true;
      this.paused = options.paused === true || this.initialStatic;
      this.onFrame = options.onFrame;
      this.world = new World(sharks, options.fishCount);
      this.renderer = new AsciiRenderer(canvas);
      this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.intersectionObserver = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        this.schedule();
      });
      this.intersectionObserver.observe(canvas);
      this.reducedMotion.addEventListener("change", this.onMotionPreference);
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("blur", this.onPointerLeave);
      this.resize();
      document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
        if (!this.disposed && (this.reducedMotion.matches || this.paused)) this.drawStill();
      });
      this.schedule();
    }
    world;
    renderer;
    raf = 0;
    last = 0;
    acc = 0;
    visible = true;
    reducedMotion;
    resizeObserver;
    intersectionObserver;
    disposed = false;
    nextDraw = 0;
    maxFps;
    maxDpr;
    initialStatic;
    onFrame;
    speed;
    interactive;
    width = 0;
    height = 0;
    dpr = 1;
    /** Rendered frames, used by the glass backdrop capture to avoid redundant work. */
    frames = 0;
    paused = false;
    /** Stop the animation loop (window hidden or unfocused) without tearing down. */
    pause() {
      this.paused = true;
      this.world.pointer.active = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    /** Resume after {@link pause}. */
    resume() {
      if (!this.paused) return;
      this.paused = false;
      this.schedule();
    }
    /** Change the render-rate cap without changing population or drawing quality. */
    setMaxFps(fps) {
      this.maxFps = finiteRange(fps, 5, 144, this.maxFps);
      cancelAnimationFrame(this.raf);
      this.schedule();
    }
    getMetrics() {
      return {
        frames: this.frames,
        time: performance.now(),
        running: !this.disposed && !this.paused && this.visible && !this.reducedMotion.matches,
        width: this.width,
        height: this.height,
        dpr: this.dpr,
        fishCount: this.world.fish.length,
        sharkCount: this.world.sharks.length,
        maxFps: this.maxFps,
        simulationTime: this.world.time
      };
    }
    /** Change the backing-store DPR cap at runtime (adaptive quality). */
    setMaxDpr(dpr) {
      this.maxDpr = finiteRange(dpr, 1, 2, this.maxDpr);
      this.resize();
    }
    /** Update live controls without recreating the canvas, world, or playback loop. */
    configure(options) {
      if (this.disposed) return;
      this.world.configure(options);
      this.speed = finiteRange(options.speed, 0.25, 2, this.speed);
      if (typeof options.interactive === "boolean") this.interactive = options.interactive;
      if (!this.interactive) this.world.pointer.active = false;
      if (this.paused || this.reducedMotion.matches) this.drawStill();
    }
    destroy() {
      this.disposed = true;
      cancelAnimationFrame(this.raf);
      this.resizeObserver.disconnect();
      this.intersectionObserver.disconnect();
      this.reducedMotion.removeEventListener("change", this.onMotionPreference);
      window.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerdown", this.onPointerDown);
      document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
      window.removeEventListener("blur", this.onPointerLeave);
    }
    resize() {
      if (this.disposed) return;
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      this.width = rect.width;
      this.height = rect.height;
      this.dpr = dpr;
      this.renderer.resize(rect.width, rect.height, dpr);
      this.world.resize(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight);
      if (this.reducedMotion.matches || this.paused) {
        this.drawStill(this.frames === 0 && (this.reducedMotion.matches || this.initialStatic));
      }
    }
    schedule() {
      cancelAnimationFrame(this.raf);
      if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches) return;
      this.last = performance.now();
      this.nextDraw = this.last + 1e3 / this.maxFps;
      this.acc = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
    frame = (now) => {
      this.raf = 0;
      if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches) return;
      if (now + FRAME_EPSILON < this.nextDraw) {
        this.raf = requestAnimationFrame(this.frame);
        return;
      }
      const interval = 1e3 / this.maxFps;
      this.nextDraw += Math.max(1, Math.floor((now - this.nextDraw) / interval) + 1) * interval;
      const dt = Math.min(Math.max(0.1, 1 / this.maxFps), Math.max(0, (now - this.last) / 1e3)) * this.speed;
      this.last = now;
      this.acc += dt;
      let steps = 0;
      const step = 1 / Math.max(60, this.maxFps);
      const maxSteps = Math.max(Math.ceil(MAX_STEPS * STEP / step), Math.ceil(this.speed / this.maxFps / step) + 1);
      while (this.acc + 1e-10 >= step && steps < maxSteps) {
        this.world.step(step);
        this.acc = Math.max(0, this.acc - step);
        steps++;
      }
      if (steps === maxSteps && this.acc >= step) this.acc %= step;
      this.renderer.render(this.world, dt, this.maxFps > 60 ? this.speed / 60 : void 0);
      this.frames++;
      this.onFrame?.();
      if (!this.disposed && !this.paused && this.visible && !this.reducedMotion.matches) {
        this.raf = requestAnimationFrame(this.frame);
      }
    };
    /** Settle only an initial still; resizing a paused scene never advances it. */
    drawStill(warmup = false) {
      if (warmup && this.world.time < 4) {
        for (let i = 0; i < 240; i++) this.world.step(STEP);
      }
      this.renderer.render(this.world, STEP);
      this.frames++;
      this.onFrame?.();
    }
    onMotionPreference = () => {
      if (this.reducedMotion.matches) {
        cancelAnimationFrame(this.raf);
        this.world.pointer.active = false;
        this.drawStill();
      } else {
        this.schedule();
      }
    };
    toLocal(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      return { x, y, inside };
    }
    onPointerMove = (e) => {
      if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches || !this.interactive || isInteractiveTarget(e)) {
        this.world.pointer.active = false;
        return;
      }
      const { x, y, inside } = this.toLocal(e);
      const p = this.world.pointer;
      p.x = x;
      p.y = y;
      p.active = inside && e.pointerType !== "touch";
    };
    onPointerDown = (e) => {
      if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches || !this.interactive || e.button !== void 0 && e.button !== 0 || isInteractiveTarget(e)) return;
      const { x, y, inside } = this.toLocal(e);
      if (inside) this.world.splash(x, y);
    };
    onPointerLeave = () => {
      this.world.pointer.active = false;
    };
  };

  // src/preferences.ts
  var PREFERENCES_KEY = "dsh.ascii-ocean.preferences.v1";
  var FPS_OPTIONS = [30, 60, 120];
  var SUPPORTED_FPS = [15, 30, 45, 60, 90, 120, 144];
  var DEFAULT_PREFERENCES = Object.freeze({
    mode: "dynamic",
    fishCount: null,
    sharkCount: 6,
    maxFps: 60,
    speed: 1,
    clarity: 50,
    interactive: true,
    glass: true
  });
  var finite = (value) => typeof value === "number" && Number.isFinite(value);
  var bounded = (value, min, max, fallback) => finite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  function normalizePreferences(data) {
    const oldClarity = data?.readable === true ? 22 : 50;
    return {
      mode: ["dynamic", "static", "off"].includes(data?.mode) ? data.mode : "dynamic",
      fishCount: finite(data?.fishCount) ? Math.round(bounded(data.fishCount, 0, 600, 0)) : null,
      sharkCount: Math.round(bounded(data?.sharkCount, 0, 12, 6)),
      maxFps: SUPPORTED_FPS.includes(data?.maxFps) ? data.maxFps : 60,
      speed: Math.round(bounded(data?.speed, 0.25, 2, 1) * 4) / 4,
      clarity: Math.round(bounded(data?.clarity, 10, 90, oldClarity)),
      interactive: typeof data?.interactive === "boolean" ? data.interactive : true,
      glass: typeof data?.glass === "boolean" ? data.glass : true
    };
  }
  function parsePreferences(value) {
    try {
      return normalizePreferences(JSON.parse(value ?? "null"));
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }
  function readPreferences() {
    try {
      return parsePreferences(localStorage.getItem(PREFERENCES_KEY));
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }
  function savePreferences(value) {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(value)));
      return true;
    } catch {
      return false;
    }
  }
  function settingsComponent(React, ocean) {
    return function OceanSettings({ view }) {
      const state = React.useSyncExternalStore(ocean.subscribe, ocean.getSnapshot);
      React.useLayoutEffect(() => {
        if (view === "summary") return;
        ocean.ensure();
        return () => queueMicrotask(() => ocean.ensure());
      }, [view]);
      const h = React.createElement;
      if (view === "summary") return "\u517B\u4E00\u7247 ASCII \u6D77\uFF1A\u8C03\u9C7C\u7FA4\u3001\u9009\u5E27\u7387\uFF0C\u8BA9\u9CA8\u9C7C\u6E38\u8FC7\u73BB\u7483\u8237\u7A97\u3002";
      const off = state.mode === "off";
      const update = (key, value) => ocean.setPreferences({ [key]: value });
      const slider = (key, label, min, max, step, text, help, disabled = off) => {
        const id = `dsh-ocean-${key}`;
        return h(
          "div",
          { className: "dsh-ocean-control", key },
          h("div", { className: "dsh-ocean-label" }, h("label", { htmlFor: id }, label), h("output", { htmlFor: id }, text)),
          h("input", {
            id,
            type: "range",
            min,
            max,
            step,
            value: state[key] ?? 240,
            disabled,
            "aria-valuetext": text,
            "aria-describedby": help ? `${id}-help` : void 0,
            onChange: (e) => update(key, Number(e.target.value))
          }),
          help && h("small", { id: `${id}-help` }, help)
        );
      };
      const checkbox = (key, label, help) => h(
        "label",
        { className: "dsh-ocean-check" },
        h("input", { type: "checkbox", checked: state[key], disabled: off, onChange: (e) => update(key, e.target.checked) }),
        h("span", null, label, h("small", null, help))
      );
      const options = [
        ["dynamic", "\u51FA\u6D77 \xB7 \u52A8\u6001", "\u8BA9\u9C7C\u7FA4\u81EA\u5728\u5DE1\u6E38"],
        ["static", "\u505C\u6CCA \xB7 \u9759\u6001", "\u628A\u8FD9\u4E00\u523B\u7559\u6210\u6D77\u666F"],
        ["off", "\u6536\u5E06 \xB7 \u5173\u95ED", "\u56DE\u5230 DSH \u539F\u6709\u80CC\u666F"]
      ];
      const currents = ["\u8F7B\u6D6A", "\u987A\u6D41 \xB7 \u9ED8\u8BA4", "\u98DE\u9C7C"];
      return h(
        "div",
        { className: "dsh-ocean-settings", "data-ocean-controls": true },
        h(
          "div",
          { className: "dsh-ocean-heading" },
          h("span", { className: "dsh-ocean-ascii", "aria-hidden": true }, "><(((o>  ~  ><>"),
          h("span", null, "\u8FD9\u7247\u6D77\uFF0C\u542C\u4F60\u7684")
        ),
        h(
          "fieldset",
          { className: "dsh-ocean-mode-group" },
          h("legend", null, "\u80CC\u666F\u6A21\u5F0F"),
          h("div", { className: "dsh-ocean-modes" }, ...options.map(([value, label, description]) => h(
            "label",
            { key: value, className: "dsh-ocean-mode" },
            h("input", {
              type: "radio",
              name: "dsh-ocean-mode",
              value,
              checked: state.mode === value,
              onChange: () => ocean.setMode(value)
            }),
            h("span", null, h("strong", null, label), h("small", null, description))
          )))
        ),
        h("p", { className: "dsh-ocean-preview-note" }, "\u62E8\u52A8\u4E00\u70B9\uFF0C\u6D77\u91CC\u5C31\u53D8\u4E00\u70B9\u3002\u8C03\u6574\u5373\u65F6\u751F\u6548\uFF0C\u5E76\u81EA\u52A8\u4FDD\u5B58\u5728\u6B64\u5BA2\u6237\u7AEF\u3002"),
        h(
          "div",
          { className: "dsh-ocean-grid" },
          h(
            "fieldset",
            { className: "dsh-ocean-group" },
            h("legend", null, "\u9C7C\u7FA4 \xB7 \u6D77\u91CC\u7684\u90BB\u5C45"),
            slider("sharkCount", "\u5927\u9C7C\u6570\u91CF", 0, 12, 1, `${state.sharkCount} \u6761`, "\u516D\u79CD\u9CA8\u9C7C\u8F6E\u6D41\u767B\u573A\uFF1B\u8C03\u5230 0\uFF0C\u8BA9\u5927\u5BB6\u6682\u65F6\u6F5C\u6C34\u3002"),
            h(
              "label",
              { className: "dsh-ocean-auto" },
              h("input", {
                type: "checkbox",
                checked: state.fishCount === null,
                disabled: off,
                onChange: (e) => update("fishCount", e.target.checked ? null : Math.max(85, Math.min(340, Math.round(window.innerWidth * window.innerHeight / 4400))))
              }),
              "\u5C0F\u9C7C\u6570\u91CF\u968F\u7A97\u53E3\u81EA\u52A8\u8C03\u6574"
            ),
            slider(
              "fishCount",
              "\u5C0F\u9C7C\u6570\u91CF",
              0,
              600,
              1,
              state.fishCount === null ? "\u81EA\u52A8 \xB7 85\u2013340 \u6761" : `${state.fishCount} \u6761`,
              "\u53D6\u6D88\u81EA\u52A8\uFF0C\u4EB2\u81EA\u5B89\u6392\u9C7C\u7FA4\uFF1B\u9C7C\u8D8A\u591A\uFF0C\u7ED8\u5236\u4E5F\u8D8A\u5FD9\u3002",
              off || state.fishCount === null
            ),
            slider("speed", "\u6E38\u52A8\u901F\u5EA6", 0.25, 2, 0.25, `${state.speed}\xD7`, "\u6162\u60A0\u60A0\u6216\u8FFD\u7740\u6D6A\u8DD1\uFF1B1\xD7 \u539F\u901F\uFF0C\u4E0E\u5E27\u7387\u72EC\u7ACB\u3002")
          ),
          h(
            "fieldset",
            { className: "dsh-ocean-group" },
            h("legend", null, "\u6D77\u9762 \xB7 \u5149\u5F71\u4E0E\u8282\u594F"),
            slider("clarity", "\u6D77\u6D0B\u6E05\u6670\u5EA6", 10, 90, 1, `${state.clarity}%`, "\u8BA9\u9C7C\u66F4\u8FD1\u4E00\u70B9\uFF1B\u8D8A\u9AD8\u8D8A\u6E05\u695A\uFF0C50% \u4E3A\u9ED8\u8BA4\u3002"),
            h(
              "div",
              { className: "dsh-ocean-control" },
              h("label", { htmlFor: "dsh-ocean-maxFps" }, "\u5E27\u7387\u4E0A\u9650"),
              h(
                "select",
                { id: "dsh-ocean-maxFps", value: state.maxFps, disabled: off, "aria-describedby": "dsh-ocean-fps-help", onChange: (e) => update("maxFps", Number(e.target.value)) },
                !FPS_OPTIONS.includes(state.maxFps) && h("option", { value: state.maxFps }, `${state.maxFps} fps \xB7 \u5F53\u524D\u65E7\u8BBE\u7F6E`),
                ...FPS_OPTIONS.map((fps, i) => h("option", { key: fps, value: fps }, `${fps} fps \xB7 ${currents[i]}`))
              ),
              h("small", { id: "dsh-ocean-fps-help" }, state.maxFps > 60 ? "\u5DF2\u9009\u62E9\u9AD8\u5237\u4E0A\u9650\u3002\u66F4\u7EC6\u7684\u6E38\u52A8\u8282\u594F\u9700\u8981\u9AD8\u5237\u5C4F\uFF1B\u5B9E\u9645\u5E27\u7387\u53D7\u8BBE\u5907\u8D1F\u8F7D\u5F71\u54CD\u3002" : "60 fps \u662F\u9ED8\u8BA4\u5E27\u7387\u3002\u8FD9\u91CC\u8BBE\u5B9A\u7ED8\u5236\u4E0A\u9650\uFF0C\u5B9E\u9645\u6D41\u7545\u5EA6\u4E5F\u53D6\u51B3\u4E8E\u5C4F\u5E55\u4E0E\u8BBE\u5907\u8D1F\u8F7D\u3002")
            ),
            checkbox("glass", "\u4FA7\u680F\u73BB\u7483", "\u900F\u8FC7\u73BB\u7483\u8237\u7A97\u770B\u6D77\uFF0C\u4FDD\u7559\u6298\u5C04\u4E0E\u6726\u80E7\u5149\u5F71\u3002"),
            checkbox("interactive", "\u9F20\u6807\u4E92\u52A8", "\u6307\u9488\u5E26\u9C7C\u7FA4\u8F6C\u5F2F\uFF0C\u70B9\u4E00\u4E0B\u7A7A\u767D\u6D77\u9762\uFF0C\u6E85\u8D77\u6C34\u82B1\u3002")
          )
        ),
        h(
          "div",
          { className: "dsh-ocean-footer" },
          h(
            "p",
            { role: "status", "aria-live": "polite", className: "dsh-ocean-status" },
            !state.saved ? "\u8BBE\u7F6E\u5DF2\u751F\u6548\uFF0C\u4F46\u672C\u6B21\u65E0\u6CD5\u4FDD\u5B58\uFF1B\u4E0B\u6B21\u6253\u5F00\u53EF\u80FD\u6062\u590D\u4E4B\u524D\u7684\u8BBE\u7F6E\u3002" : off ? "\u5DF2\u6536\u5E06\uFF0C\u9C7C\u7FA4\u914D\u7F6E\u66FF\u4F60\u7559\u7740\u3002\u51FA\u6D77\u65F6\u7EE7\u7EED\u3002" : state.reduced ? "\u5DF2\u9075\u5FAA\u7CFB\u7EDF\u7684\u51CF\u5C11\u52A8\u6001\u6548\u679C\u8BBE\u7F6E\uFF0C\u663E\u793A\u9759\u6001\u753B\u9762\u3002" : state.mode === "static" ? "\u6D77\u666F\u5DF2\u505C\u6CCA\uFF1B\u4ECD\u53EF\u8C03\u6574\u9C7C\u7FA4\u3002\u5207\u56DE\u52A8\u6001\uFF0C\u518D\u63A5\u7740\u6E38\u3002" : state.fallback ? "\u6B63\u5728\u4F7F\u7528\u517C\u5BB9\u7ED8\u5236\uFF0C\u6240\u9009\u53C2\u6570\u4FDD\u6301\u751F\u6548\u3002" : "\u822A\u6D77\u504F\u597D\u5DF2\u4FDD\u5B58\u3002\u653E\u5FC3\u8C03\u8282\uFF0C\u8FD9\u91CC\u4E0D\u4F1A\u8BEF\u89E6\u6C34\u82B1\u3002"
          ),
          h("button", { type: "button", onClick: () => ocean.resetPreferences() }, "\u6062\u590D\u9ED8\u8BA4\u6D77\u666F")
        )
      );
    };
  }

  // src/worker-source.generated.ts
  var WORKER_SOURCE = '(() => {\n  // src/ascii-sharks/math.ts\n  var TAU = Math.PI * 2;\n  var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;\n  var rand = (lo, hi) => lo + Math.random() * (hi - lo);\n  var randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));\n  function smoothstep(e0, e1, x) {\n    const t = clamp((x - e0) / (e1 - e0), 0, 1);\n    return t * t * (3 - 2 * t);\n  }\n  function angleDiff(a, b) {\n    let d = (b - a) % TAU;\n    if (d > Math.PI) d -= TAU;\n    if (d < -Math.PI) d += TAU;\n    return d;\n  }\n  function hash3(x, y, z) {\n    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);\n    h = Math.imul(h ^ h >>> 13, 1274126177);\n    h ^= h >>> 16;\n    return (h >>> 0) / 4294967296;\n  }\n  var K1 = 1 / 260;\n  var K2 = 1 / 310;\n  var K3 = 1 / 190;\n  var CURRENT_SCALE = 3400;\n  function current(x, y, t, out) {\n    const a = x * K1 + t * 0.07;\n    const b = y * K2 - t * 0.05;\n    const c = (x + y) * K3 + t * 0.11;\n    out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;\n    out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;\n    return out;\n  }\n\n  // src/ascii-sharks/species.ts\n  var SPECIES = [\n    {\n      name: "sardine",\n      cruise: 36,\n      maxSpeed: 64,\n      minSpeed: 18,\n      weight: 3,\n      schoolSize: [18, 28],\n      spacing: [1.8, 1.1],\n      align: 1.6,\n      cohesion: 1.6,\n      jitter: 40,\n      mill: 70,\n      verticalDrag: 0.5\n    },\n    {\n      name: "anchovy",\n      cruise: 46,\n      maxSpeed: 78,\n      minSpeed: 22,\n      weight: 3,\n      schoolSize: [20, 32],\n      spacing: [1.5, 1],\n      align: 3.2,\n      cohesion: 0.45,\n      jitter: 30,\n      mill: 0,\n      verticalDrag: 1.4\n    },\n    {\n      name: "silverside",\n      cruise: 40,\n      maxSpeed: 70,\n      minSpeed: 20,\n      weight: 3,\n      schoolSize: [12, 20],\n      spacing: [2, 1.1],\n      align: 2.4,\n      cohesion: 1.1,\n      jitter: 35,\n      mill: 0,\n      verticalDrag: 1.6\n    },\n    {\n      name: "mackerel",\n      cruise: 32,\n      maxSpeed: 60,\n      minSpeed: 16,\n      weight: 2,\n      schoolSize: [5, 9],\n      spacing: [2.6, 1.3],\n      align: 2,\n      cohesion: 0.9,\n      jitter: 25,\n      mill: 0,\n      verticalDrag: 2\n    },\n    {\n      name: "goby",\n      cruise: 26,\n      maxSpeed: 56,\n      minSpeed: 10,\n      weight: 1,\n      schoolSize: [8, 12],\n      spacing: [1.4, 1.1],\n      align: 0.35,\n      cohesion: 1.4,\n      jitter: 110,\n      mill: 0,\n      verticalDrag: 0.3\n    }\n  ];\n  var TOTAL_WEIGHT = SPECIES.reduce((sum, s) => sum + s.weight, 0);\n  function pickSpecies() {\n    let r = Math.random() * TOTAL_WEIGHT;\n    for (let i = 0; i < SPECIES.length; i++) {\n      r -= SPECIES[i].weight;\n      if (r <= 0) return i;\n    }\n    return 0;\n  }\n\n  // src/ascii-sharks/world.ts\n  var SHARK_NODES = 20;\n  var DEFAULT_SHARKS = [\n    { kind: "classic", size: 1 },\n    { kind: "classic", size: 0.7 },\n    { kind: "classic", size: 0.84 },\n    { kind: "classic", size: 0.77 }\n  ];\n  var FISH_SEPARATION_K = 420;\n  var FISH_ALIGN_K = 1.4;\n  var FISH_COHESION_K = 1;\n  var FISH_FLEE_K = 1100;\n  var BLIND_COS = -0.6;\n  var REFERENCE_STEP = 1 / 60;\n  var SHARK_KINDS = /* @__PURE__ */ new Set(["classic", "hammerhead", "zebra", "tiger", "greathammer", "mako", "thresher", "nurse"]);\n  function validSharks(specs) {\n    return specs.filter((spec) => spec && SHARK_KINDS.has(spec.kind) && Number.isFinite(spec.size) && spec.size > 0).slice(0, 12).map(({ kind, size }) => ({ kind, size: clamp(size, 0.1, 2) }));\n  }\n  function population(value, fallback) {\n    if (value === null) return null;\n    return typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), 0, 600) : fallback;\n  }\n  var World = class {\n    width = 0;\n    height = 0;\n    time = 0;\n    fish = [];\n    sharks = [];\n    events = [];\n    pointer = { x: 0, y: 0, active: false };\n    /** Fish neighbourhood radius; the spatial hash bucket size matches it. */\n    perception = 60;\n    /** Per-species personal space in px (x, y). */\n    sepX = [];\n    sepY = [];\n    foreignSep = 40;\n    bucketCols = 0;\n    bucketRows = 0;\n    bucketHead = new Int32Array(0);\n    bucketCount = new Uint16Array(0);\n    bucketNext = new Int32Array(0);\n    lastSpawn = 0;\n    tmp = { x: 0, y: 0 };\n    initialized = false;\n    nextSharkId = 1;\n    sharkSpecs;\n    fishCount;\n    /** null keeps the original area-based population; zero is an empty ocean. */\n    constructor(sharkSpecs = DEFAULT_SHARKS, fishCount = null) {\n      this.sharkSpecs = validSharks(Array.isArray(sharkSpecs) ? sharkSpecs : DEFAULT_SHARKS);\n      this.fishCount = population(fishCount, null);\n    }\n    /** Apply population changes without restarting time or moving retained animals. */\n    configure(options) {\n      if (options.fishCount !== void 0) this.fishCount = population(options.fishCount, this.fishCount);\n      const sharksChanged = Array.isArray(options.sharks);\n      if (sharksChanged) this.sharkSpecs = validSharks(options.sharks);\n      if (!this.initialized) return;\n      this.resizePopulation();\n      if (sharksChanged) this.reconcileSharks();\n    }\n    resize(width2, height2, cellW, cellH) {\n      this.width = width2;\n      this.height = height2;\n      this.sepX = SPECIES.map((sp) => sp.spacing[0] * cellW);\n      this.sepY = SPECIES.map((sp) => sp.spacing[1] * cellH);\n      this.perception = Math.max(cellH * 3, cellW * 5.5);\n      this.foreignSep = cellW * 3;\n      if (!this.initialized) {\n        this.seed();\n        return;\n      }\n      for (const f of this.fish) {\n        f.x = clamp(f.x, 0, width2);\n        f.y = clamp(f.y, 0, height2);\n      }\n      this.resizePopulation();\n    }\n    seed() {\n      this.initialized = true;\n      this.sharks = this.sharkSpecs.map((spec, index) => this.createShark(spec, index, this.sharkSpecs.length));\n      this.sharks.sort((a, b) => a.length - b.length);\n      this.fish = [];\n      this.resizePopulation();\n    }\n    createShark({ kind, size }, index, count) {\n      const { width: W, height: H } = this;\n      const minSide = Math.min(W, H);\n      const length = clamp(minSide * 0.44, 170, 430) * size;\n      const orbitRadius = minSide * rand(0.28, 0.4);\n      const a = index / count * TAU + rand(-0.4, 0.4);\n      const orbitDir = index % 2 === 0 ? 1 : -1;\n      const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;\n      const y = H / 2 + Math.sin(a) * orbitRadius;\n      const heading = a + orbitDir * Math.PI / 2;\n      const nodes = new Float32Array(SHARK_NODES * 2);\n      const seg = length / (SHARK_NODES - 1);\n      for (let n = 0; n < SHARK_NODES; n++) {\n        nodes[n * 2] = x - Math.cos(heading) * seg * n;\n        nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;\n      }\n      return {\n        id: this.nextSharkId++,\n        kind,\n        length,\n        nodes,\n        heading,\n        speed: 30,\n        phase: rand(0, TAU),\n        turn: 0,\n        hunger: rand(0.25, 0.75),\n        wander: 0,\n        orbitDir,\n        orbitRadius,\n        target: null,\n        retargetAt: this.time,\n        depth: size\n      };\n    }\n    reconcileSharks() {\n      const available = this.sharks.slice();\n      this.sharks = this.sharkSpecs.map((spec, index) => {\n        let match = available.findIndex((shark2) => shark2.kind === spec.kind && shark2.depth === spec.size);\n        if (match < 0) match = available.findIndex((shark2) => shark2.kind === spec.kind);\n        if (match < 0) return this.createShark(spec, index, this.sharkSpecs.length);\n        const shark = available.splice(match, 1)[0];\n        if (shark.depth !== spec.size) {\n          const ratio = spec.size / shark.depth;\n          for (let k = 1; k < SHARK_NODES; k++) {\n            shark.nodes[k * 2] = shark.nodes[0] + (shark.nodes[k * 2] - shark.nodes[0]) * ratio;\n            shark.nodes[k * 2 + 1] = shark.nodes[1] + (shark.nodes[k * 2 + 1] - shark.nodes[1]) * ratio;\n          }\n          shark.length *= ratio;\n          shark.depth = spec.size;\n        }\n        return shark;\n      });\n      this.sharks.sort((a, b) => a.length - b.length);\n    }\n    resizePopulation() {\n      const { width: W, height: H } = this;\n      const total = this.fishCount ?? clamp(Math.round(W * H / 4400), 85, 340);\n      if (this.fish.length === total) return;\n      if (this.fish.length > total) {\n        const survivors = this.fish.filter((fish) => fish.alive).slice(0, total);\n        if (survivors.length < total) survivors.push(...this.fish.filter((fish) => !fish.alive).slice(0, total - survivors.length));\n        this.fish = survivors;\n        const retained = new Set(this.fish);\n        for (const shark of this.sharks) if (shark.target && !retained.has(shark.target)) shark.target = null;\n      }\n      while (this.fish.length < total) {\n        const species = pickSpecies();\n        const sp = SPECIES[species];\n        const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);\n        const millDir = Math.random() < 0.5 ? 1 : -1;\n        const cx = rand(W * 0.06, W * 0.94);\n        const cy = rand(H * 0.08, H * 0.92);\n        const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);\n        for (let k = 0; k < size; k++) {\n          this.fish.push({\n            x: cx + rand(-1, 1) * this.sepX[species] * Math.sqrt(size),\n            y: cy + rand(-1, 1) * this.sepY[species] * Math.sqrt(size) * 0.6,\n            vx: Math.cos(dir) * sp.cruise,\n            vy: Math.sin(dir) * sp.cruise,\n            species,\n            alarm: 0,\n            alive: true,\n            respawnAt: 0,\n            phase: rand(0, TAU),\n            turn: 0,\n            depth: rand(0.55, 1),\n            millDir\n          });\n        }\n      }\n      this.bucketNext = new Int32Array(this.fish.length);\n    }\n    splash(x, y) {\n      this.events.push({ kind: "splash", x, y });\n      const r = 240;\n      for (const f of this.fish) {\n        if (!f.alive) continue;\n        const dx = f.x - x;\n        const dy = f.y - y;\n        const d = Math.hypot(dx, dy);\n        if (d > r || d < 1e-3) continue;\n        const k = (1 - d / r) * 260;\n        f.vx += dx / d * k;\n        f.vy += dy / d * k;\n        f.alarm = 1;\n      }\n    }\n    step(dt) {\n      this.time += dt;\n      this.rebuildHash();\n      const noiseScale = dt > 0 && Number.isFinite(dt) && dt !== REFERENCE_STEP ? Math.sqrt(REFERENCE_STEP / dt) : 1;\n      this.stepFish(dt, noiseScale);\n      this.stepSharks(dt, noiseScale);\n      this.respawn();\n    }\n    rebuildHash() {\n      const size = this.perception;\n      const pad = 2;\n      this.bucketCols = Math.ceil(this.width / size) + pad * 2;\n      this.bucketRows = Math.ceil(this.height / size) + pad * 2;\n      const n = this.bucketCols * this.bucketRows;\n      if (this.bucketHead.length !== n) {\n        this.bucketHead = new Int32Array(n);\n        this.bucketCount = new Uint16Array(n);\n      }\n      this.bucketHead.fill(-1);\n      this.bucketCount.fill(0);\n      if (this.bucketNext.length !== this.fish.length) {\n        this.bucketNext = new Int32Array(this.fish.length);\n      }\n      for (let i = 0; i < this.fish.length; i++) {\n        const f = this.fish[i];\n        if (!f.alive) continue;\n        const b = this.bucketOf(f.x, f.y);\n        this.bucketNext[i] = this.bucketHead[b];\n        this.bucketHead[b] = i;\n        this.bucketCount[b]++;\n      }\n    }\n    bucketOf(x, y) {\n      const size = this.perception;\n      const c = clamp(Math.floor(x / size) + 2, 0, this.bucketCols - 1);\n      const r = clamp(Math.floor(y / size) + 2, 0, this.bucketRows - 1);\n      return r * this.bucketCols + c;\n    }\n    stepFish(dt, noiseScale) {\n      const { fish, sharks, pointer, width: W, height: H, time } = this;\n      const R = this.perception;\n      const R2 = R * R;\n      const foreignSep = this.foreignSep;\n      const size = this.perception;\n      const cols = this.bucketCols;\n      const rows = this.bucketRows;\n      const head = this.bucketHead;\n      const next = this.bucketNext;\n      const cur = this.tmp;\n      const calmDecay = Math.exp(-dt * 0.7);\n      const contagion = Math.min(1, dt * 6);\n      for (let i = 0; i < fish.length; i++) {\n        const f = fish[i];\n        if (!f.alive) continue;\n        const sp = SPECIES[f.species];\n        const spread = 1 + 1.8 * f.alarm;\n        const sepX = this.sepX[f.species] * spread;\n        const sepY = this.sepY[f.species] * spread;\n        const speed2 = Math.hypot(f.vx, f.vy) || 1;\n        const hx = f.vx / speed2;\n        const hy = f.vy / speed2;\n        let ax = 0;\n        let ay = 0;\n        let sx = 0;\n        let sy = 0;\n        let avx = 0;\n        let avy = 0;\n        let cx = 0;\n        let cy = 0;\n        let n = 0;\n        let neighbourAlarm = 0;\n        const bc = clamp(Math.floor(f.x / size) + 2, 0, cols - 1);\n        const br = clamp(Math.floor(f.y / size) + 2, 0, rows - 1);\n        for (let r = Math.max(0, br - 1); r <= Math.min(rows - 1, br + 1); r++) {\n          for (let c = Math.max(0, bc - 1); c <= Math.min(cols - 1, bc + 1); c++) {\n            let j = head[r * cols + c];\n            while (j !== -1) {\n              if (j !== i) {\n                const o = fish[j];\n                const dx = o.x - f.x;\n                const dy = o.y - f.y;\n                const d2 = dx * dx + dy * dy;\n                if (d2 < R2 && d2 > 1e-6) {\n                  const d = Math.sqrt(d2);\n                  if ((dx * hx + dy * hy) / d > BLIND_COS) {\n                    const qx = dx / sepX;\n                    const qy = dy / sepY;\n                    const q2 = qx * qx + qy * qy;\n                    if (q2 < 1) {\n                      const q = Math.sqrt(q2) || 1e-3;\n                      const k = (1 - q) / q;\n                      sx -= qx * k;\n                      sy -= qy * k;\n                    }\n                    if (o.species === f.species) {\n                      avx += o.vx;\n                      avy += o.vy;\n                      cx += dx;\n                      cy += dy;\n                      n++;\n                    } else if (d < foreignSep) {\n                      const k = (1 - d / foreignSep) / d * 0.6;\n                      sx -= dx * k;\n                      sy -= dy * k;\n                    }\n                    if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;\n                  }\n                }\n              }\n              j = next[j];\n            }\n          }\n        }\n        ax += sx * FISH_SEPARATION_K;\n        ay += sy * FISH_SEPARATION_K;\n        if (n > 0) {\n          const alignK = FISH_ALIGN_K * sp.align;\n          const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm);\n          ax += (avx / n - f.vx) * alignK + cx / n * cohesionK;\n          ay += (avy / n - f.vy) * alignK + cy / n * cohesionK;\n          if (sp.mill > 0) {\n            const cl = Math.hypot(cx, cy) || 1;\n            ax += -cy / cl * f.millDir * sp.mill * (1 - f.alarm);\n            ay += cx / cl * f.millDir * sp.mill * (1 - f.alarm);\n          }\n        }\n        let fear = 0;\n        for (const sh of sharks) {\n          const fearR = sh.length * 0.6 + 60;\n          let best = Infinity;\n          let bx = 0;\n          let by = 0;\n          for (let k = 0; k <= 12; k += 3) {\n            const nx = sh.nodes[k * 2];\n            const ny = sh.nodes[k * 2 + 1];\n            const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;\n            if (d2 < best) {\n              best = d2;\n              bx = nx;\n              by = ny;\n            }\n          }\n          const d = Math.sqrt(best);\n          if (d >= fearR || d < 1e-3) continue;\n          let w = 1 - d / fearR;\n          w *= w;\n          const awayX = (f.x - bx) / d;\n          const awayY = (f.y - by) / d;\n          const shx = Math.cos(sh.heading);\n          const shy = Math.sin(sh.heading);\n          const side = shx * (f.y - sh.nodes[1]) - shy * (f.x - sh.nodes[0]) >= 0 ? 1 : -1;\n          ax += (awayX * 0.7 - shy * side * 0.9) * FISH_FLEE_K * w;\n          ay += (awayY * 0.7 + shx * side * 0.9) * FISH_FLEE_K * w;\n          fear = Math.max(fear, Math.sqrt(w));\n        }\n        if (pointer.active) {\n          const pr = 130;\n          const dx = f.x - pointer.x;\n          const dy = f.y - pointer.y;\n          const d = Math.hypot(dx, dy);\n          if (d < pr && d > 1e-3) {\n            const w = (1 - d / pr) ** 2;\n            ax += dx / d * FISH_FLEE_K * w;\n            ay += dy / d * FISH_FLEE_K * w;\n            fear = Math.max(fear, Math.sqrt(w) * 0.8);\n          }\n        }\n        let alarm = Math.max(f.alarm * calmDecay, fear);\n        const relayed = neighbourAlarm * 0.86;\n        if (relayed > alarm) alarm += (relayed - alarm) * contagion;\n        f.alarm = alarm;\n        const m = 36;\n        if (f.x < m) ax += (m - f.x) * 7;\n        else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;\n        if (f.y < m) ay += (m - f.y) * 7;\n        else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;\n        current(f.x, f.y, time, cur);\n        ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter * noiseScale;\n        ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter * noiseScale;\n        ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);\n        const preferred = sp.cruise * (1 + 1.3 * f.alarm);\n        ax += (preferred - speed2) * hx * 1.6;\n        ay += (preferred - speed2) * hy * 1.6;\n        const before = Math.atan2(f.vy, f.vx);\n        f.vx += ax * dt;\n        f.vy += ay * dt;\n        const maxSpeed = sp.maxSpeed * (1 + 1.8 * f.alarm);\n        const s = Math.hypot(f.vx, f.vy);\n        if (s > maxSpeed) {\n          f.vx *= maxSpeed / s;\n          f.vy *= maxSpeed / s;\n        } else if (s < sp.minSpeed && s > 1e-3) {\n          f.vx *= sp.minSpeed / s;\n          f.vy *= sp.minSpeed / s;\n        }\n        f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);\n        f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12);\n        f.x = clamp(f.x + f.vx * dt, -60, W + 60);\n        f.y = clamp(f.y + f.vy * dt, -60, H + 60);\n      }\n    }\n    stepSharks(dt, noiseScale) {\n      const { sharks, width: W, height: H, time } = this;\n      const minSide = Math.min(W, H);\n      const cxW = W / 2;\n      const cyW = H / 2;\n      for (const sh of sharks) {\n        const L = sh.length;\n        const nodes = sh.nodes;\n        const hx = nodes[0];\n        const hy = nodes[1];\n        sh.hunger = Math.min(1, sh.hunger + dt * 0.03);\n        let dx = Math.cos(sh.heading);\n        let dy = Math.sin(sh.heading);\n        sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2 * noiseScale, -1.1, 1.1);\n        dx += Math.cos(sh.heading + sh.wander) * 0.45;\n        dy += Math.sin(sh.heading + sh.wander) * 0.45;\n        if (time >= sh.retargetAt) {\n          sh.target = this.findPrey(sh);\n          sh.retargetAt = time + 0.45;\n        }\n        const t = sh.target;\n        let hunting = false;\n        let closing = 0;\n        if (t && t.alive && sh.hunger > 0.3) {\n          const tx = t.x + t.vx * 0.35 - hx;\n          const ty = t.y + t.vy * 0.35 - hy;\n          const d = Math.hypot(tx, ty) || 1;\n          const w = 1.4 + 2.6 * sh.hunger;\n          dx += tx / d * w;\n          dy += ty / d * w;\n          hunting = true;\n          closing = clamp(1 - d / (L * 0.9), 0, 1);\n        } else {\n          const rx = (hx - cxW) / (W / minSide);\n          const ry = hy - cyW;\n          const r = Math.hypot(rx, ry) || 1;\n          const radius = sh.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + sh.id));\n          const radial = clamp((radius - r) / radius, -1, 1);\n          dx += (-ry / r * sh.orbitDir + rx / r * radial * 0.9) * 0.55;\n          dy += (rx / r * sh.orbitDir + ry / r * radial * 0.9) * 0.55;\n        }\n        for (const other of sharks) {\n          if (other === sh) continue;\n          for (let k = 0; k < SHARK_NODES; k += 4) {\n            const ox = hx - other.nodes[k * 2];\n            const oy = hy - other.nodes[k * 2 + 1];\n            const d = Math.hypot(ox, oy);\n            const range = (L + other.length) * 0.45;\n            if (d < range && d > 1e-3) {\n              const w = (1 - d / range) * 3;\n              dx += ox / d * w;\n              dy += oy / d * w;\n            }\n          }\n        }\n        const ex = (hx - cxW) / (W * 0.3);\n        const ey = (hy - cyW) / (H * 0.16);\n        const e2 = ex * ex + ey * ey;\n        if (e2 < 1) {\n          const e = Math.sqrt(e2) || 1e-3;\n          const w = (1 - e) * (hunting ? 1 : 2.5);\n          dx += ex / e * w;\n          dy += ey / e * w;\n        }\n        const over = Math.max(-hx, hx - W, -hy, hy - H);\n        if (over > -L * 0.05) {\n          const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;\n          const toX = cxW - hx;\n          const toY = cyW - hy;\n          const d = Math.hypot(toX, toY) || 1;\n          dx += toX / d * w;\n          dy += toY / d * w;\n        }\n        const desired = Math.atan2(dy, dx);\n        const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * 0.22));\n        const maxTurn = agility * dt;\n        const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);\n        sh.heading += turned;\n        sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);\n        const cruise = 30 + L * 0.04;\n        const targetSpeed = hunting ? cruise * (1.45 + closing * 1.5) : cruise;\n        sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);\n        sh.phase += dt * (2 + sh.speed / 24);\n        nodes[0] += Math.cos(sh.heading) * sh.speed * dt;\n        nodes[1] += Math.sin(sh.heading) * sh.speed * dt;\n        const seg = L / (SHARK_NODES - 1);\n        const maxBend = 0.16;\n        let prevAngle = sh.heading + Math.PI;\n        for (let k = 1; k < SHARK_NODES; k++) {\n          const px = nodes[(k - 1) * 2];\n          const py = nodes[(k - 1) * 2 + 1];\n          let angle = Math.atan2(nodes[k * 2 + 1] - py, nodes[k * 2] - px);\n          angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);\n          nodes[k * 2] = px + Math.cos(angle) * seg;\n          nodes[k * 2 + 1] = py + Math.sin(angle) * seg;\n          prevAngle = angle;\n        }\n        if (sh.hunger > 0.15) {\n          const mouthR = L * 0.05 + 8;\n          const mx = nodes[0];\n          const my = nodes[1];\n          for (const f of this.fish) {\n            if (!f.alive) continue;\n            if ((f.x - mx) ** 2 + (f.y - my) ** 2 < mouthR * mouthR) {\n              f.alive = false;\n              f.respawnAt = time + rand(3, 8);\n              sh.hunger = Math.max(0, sh.hunger - 0.16);\n              this.events.push({ kind: "eat", x: f.x, y: f.y });\n            }\n          }\n        }\n      }\n    }\n    /**\n     * Pick prey in the shark\'s forward cone, preferring close fish in sparse\n     * buckets (stragglers) over fish buried in a dense school.\n     */\n    findPrey(sh) {\n      const range = sh.length * 0.9 + 160;\n      const hx = sh.nodes[0];\n      const hy = sh.nodes[1];\n      const fx = Math.cos(sh.heading);\n      const fy = Math.sin(sh.heading);\n      let best = null;\n      let bestScore = Infinity;\n      let currentScore = Infinity;\n      for (const f of this.fish) {\n        if (!f.alive) continue;\n        const dx = f.x - hx;\n        const dy = f.y - hy;\n        const d = Math.hypot(dx, dy);\n        if (d > range || d < 1e-3) continue;\n        const cos = (dx * fx + dy * fy) / d;\n        if (cos < 0.2) continue;\n        const crowd = this.bucketCount[this.bucketOf(f.x, f.y)];\n        const score = d * (1 + (1 - cos) * 0.8) * (1 + crowd * 0.07);\n        if (score < bestScore) {\n          bestScore = score;\n          best = f;\n        }\n        if (f === sh.target) currentScore = score;\n      }\n      if (sh.target && currentScore < bestScore * 1.3) return sh.target;\n      return best;\n    }\n    respawn() {\n      const { time, width: W, height: H } = this;\n      const due = [];\n      for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);\n      if (due.length === 0) return;\n      if (due.length < 6 && time - this.lastSpawn < 9) return;\n      this.lastSpawn = time;\n      const side = randInt(0, 3);\n      const along = rand(0.15, 0.85);\n      const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;\n      const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;\n      const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);\n      const species = pickSpecies();\n      const sp = SPECIES[species];\n      const millDir = Math.random() < 0.5 ? 1 : -1;\n      for (const f of due.slice(0, sp.schoolSize[1])) {\n        f.alive = true;\n        f.species = species;\n        f.alarm = 0;\n        f.turn = 0;\n        f.millDir = millDir;\n        f.x = x + rand(-1, 1) * this.perception;\n        f.y = y + rand(-1, 1) * this.perception;\n        f.vx = Math.cos(inward) * sp.cruise * 1.4;\n        f.vy = Math.sin(inward) * sp.cruise * 1.4;\n      }\n    }\n  };\n\n  // src/ascii-sharks/renderer.ts\n  var ALPHA_LEVELS = 6;\n  var FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];\n  var DOT_RGB = [\n    [48, 52, 235],\n    [52, 205, 60],\n    [228, 50, 44],\n    [190, 212, 255],\n    [110, 230, 255]\n  ];\n  var DOT_BASE_ALPHA = [1, 1, 1, 1, 1];\n  var WAKE = DOT_RGB.length - 1;\n  var ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];\n  var SKIN_RAMP = ":;t%SX8#@";\n  var FIN_GLYPHS = "%;tS:";\n  var RIDGE_GLYPHS = "@8%";\n  var EDGE_HEAVY = ":;";\n  var EDGE_LIGHT = ".\',`";\n  var FLAG_BODY = 1;\n  var FLAG_EDGE = 2;\n  var FLAG_FIN = 3;\n  var FLAG_RIDGE = 4;\n  var FLAG_EYE = 5;\n  var FLAG_MARK = 6;\n  var MARK_GLYPHS = "#%@";\n  var SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];\n  function classicHalfWidth(s) {\n    if (s < 0.13) return 0.09 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.95);\n    if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);\n    if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);\n    const k = (s - 0.84) / 0.16;\n    return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);\n  }\n  var SHAPES = {\n    classic: {\n      halfWidth: classicHalfWidth,\n      pectoral: [0.15, 0.43, 0.55, 0.26],\n      falcate: true,\n      pelvic: [0.57, 0.65, 0.69, 0.085],\n      caudal: 0.085,\n      dorsal: [0.33, 0.47],\n      secondDorsal: [0.71, 0.76],\n      eye: [0.1, 0.14],\n      gills: [0.19, 0.29],\n      tint: [0.92, 0.97, 1.05]\n    },\n    // Slim neck under a wide, swept-back cephalofoil (drawn in sampleShark),\n    // tall first dorsal, long upper tail lobe. Bronze-olive grey.\n    hammerhead: {\n      halfWidth: (s) => {\n        if (s < 0.06) return 0.045;\n        if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);\n        return classicHalfWidth(s) * 0.92;\n      },\n      head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },\n      pectoral: [0.17, 0.4, 0.5, 0.22],\n      falcate: true,\n      pelvic: [0.56, 0.63, 0.67, 0.075],\n      caudal: 0.11,\n      dorsal: [0.28, 0.44],\n      secondDorsal: [0.7, 0.74],\n      eye: null,\n      gills: [0.16, 0.26],\n      tint: [0.96, 0.98, 0.9]\n    },\n    // Blunt, square snout on a heavy body; barred back. Warm grey-brown.\n    tiger: {\n      halfWidth: (s) => {\n        if (s < 0.13) return 0.1 * Math.pow(Math.sin(s / 0.13 * Math.PI / 2), 0.45);\n        if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);\n        if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);\n        const k = (s - 0.84) / 0.16;\n        return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);\n      },\n      pectoral: [0.15, 0.42, 0.53, 0.25],\n      falcate: true,\n      pelvic: [0.57, 0.65, 0.69, 0.085],\n      caudal: 0.095,\n      dorsal: [0.33, 0.46],\n      secondDorsal: [0.71, 0.75],\n      eye: [0.08, 0.12],\n      gills: [0.19, 0.28],\n      tint: [1.02, 0.95, 0.84]\n    },\n    // Short rounded head, body done by half-length, then a long ribbon of a\n    // tail fin. Broad rounded pectorals, spotted sandy skin.\n    zebra: {\n      halfWidth: (s) => {\n        if (s < 0.1) return 0.075 * Math.pow(Math.sin(s / 0.1 * Math.PI / 2), 0.7);\n        if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);\n        if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);\n        const k = (s - 0.55) / 0.45;\n        return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);\n      },\n      pectoral: [0.12, 0.3, 0.36, 0.19],\n      falcate: false,\n      pelvic: [0.42, 0.48, 0.51, 0.065],\n      caudal: 0,\n      dorsal: [0.36, 0.44],\n      secondDorsal: [0.49, 0.53],\n      eye: [0.06, 0.09],\n      gills: [0.13, 0.2],\n      tint: [1.08, 0.97, 0.74]\n    },\n    // Great hammerhead: a broader, nearly straight-edged cephalofoil with a notch at the centre,\n    // a towering sickle first dorsal (drawn long and bright from above), and a cooler slate skin.\n    greathammer: {\n      halfWidth: (s) => {\n        if (s < 0.05) return 0.04;\n        if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);\n        return classicHalfWidth(s) * 0.95;\n      },\n      head: { span: 0.21, sweep: 6e-3, depth: 0.085, notch: 0.014 },\n      pectoral: [0.16, 0.38, 0.49, 0.24],\n      falcate: true,\n      pelvic: [0.55, 0.62, 0.67, 0.085],\n      caudal: 0.13,\n      dorsal: [0.24, 0.45],\n      secondDorsal: [0.68, 0.74],\n      eye: null,\n      gills: [0.15, 0.25],\n      tint: [0.86, 0.93, 1.02]\n    },\n    // Shortfin mako: a long conical snout, a torpedo body that narrows hard to the tail stalk,\n    // and a tall crescent tail. Metallic indigo back.\n    mako: {\n      halfWidth: (s) => {\n        if (s < 0.17) return 0.088 * Math.pow(Math.sin(s / 0.17 * Math.PI / 2), 1.5);\n        if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);\n        if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);\n        const k = (s - 0.86) / 0.14;\n        return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);\n      },\n      pectoral: [0.18, 0.4, 0.5, 0.21],\n      falcate: true,\n      pelvic: [0.58, 0.64, 0.68, 0.06],\n      caudal: 0.13,\n      dorsal: [0.34, 0.45],\n      secondDorsal: [0.76, 0.79],\n      eye: [0.11, 0.15],\n      gills: [0.2, 0.3],\n      tint: [0.78, 0.9, 1.2]\n    },\n    // Thresher: a compact body over the front half, then the upper tail lobe as a long whip\n    // that\'s as long as the shark itself. Big eyes, long sickle pectorals, bronze-violet skin.\n    thresher: {\n      halfWidth: (s) => {\n        if (s < 0.08) return 0.07 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.75);\n        if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);\n        if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);\n        const k = (s - 0.48) / 0.52;\n        return 0.012 * (1 - k) + 6e-3 * Math.sin(k * Math.PI * 0.9) + 2e-3;\n      },\n      pectoral: [0.12, 0.27, 0.36, 0.2],\n      falcate: true,\n      pelvic: [0.37, 0.41, 0.44, 0.045],\n      caudal: 0,\n      dorsal: [0.24, 0.32],\n      secondDorsal: [0.45, 0.47],\n      eye: [0.05, 0.1],\n      gills: [0.11, 0.18],\n      tint: [1, 0.9, 1.08]\n    },\n    // Nurse shark: a blunt, broad head, a heavy flattened body with both dorsals set far back,\n    // rounded paddle pectorals, and a long low tail with no lower lobe. Tawny brown.\n    nurse: {\n      halfWidth: (s) => {\n        if (s < 0.08) return 0.085 * Math.pow(Math.sin(s / 0.08 * Math.PI / 2), 0.4);\n        if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);\n        if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);\n        const k = (s - 0.72) / 0.28;\n        return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);\n      },\n      pectoral: [0.16, 0.34, 0.4, 0.17],\n      falcate: false,\n      pelvic: [0.45, 0.52, 0.55, 0.075],\n      caudal: 0,\n      dorsal: [0.5, 0.58],\n      secondDorsal: [0.63, 0.69],\n      eye: [0.05, 0.075],\n      gills: [0.14, 0.22],\n      tint: [1.1, 0.96, 0.76]\n    }\n  };\n  var KINDS = Object.keys(SHAPES);\n  function inTriangle(px, py, ax, ay, bx, by, cx, cy) {\n    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);\n    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);\n    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);\n    const neg = d1 < 0 || d2 < 0 || d3 < 0;\n    const pos = d1 > 0 || d2 > 0 || d3 > 0;\n    return !(neg && pos);\n  }\n  function paintGrid(g, W, H, cw, ch, dpr2) {\n    g.setTransform(1, 0, 0, 1, 0, 0);\n    g.strokeStyle = "rgba(255,255,255,0.055)";\n    g.lineWidth = 1;\n    g.beginPath();\n    for (let c = 0; c <= Math.ceil(W / cw); c++) {\n      const x = Math.round(c * cw * dpr2) + 0.5;\n      g.moveTo(x, 0);\n      g.lineTo(x, H * dpr2);\n    }\n    for (let r = 0; r <= Math.ceil(H / ch); r++) {\n      const y = Math.round(r * ch * dpr2) + 0.5;\n      g.moveTo(0, y);\n      g.lineTo(W * dpr2, y);\n    }\n    g.stroke();\n  }\n  var AsciiRenderer = class {\n    constructor(canvas2) {\n      this.canvas = canvas2;\n      const ctx = canvas2.getContext("2d", { alpha: false });\n      if (!ctx) throw new Error("2D canvas unavailable");\n      this.ctx = ctx;\n      this.bg = typeof document !== "undefined" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);\n      for (let c = 0; c < DOT_RGB.length; c++) {\n        const [r, g, b] = DOT_RGB[c];\n        for (let l = 0; l < ALPHA_LEVELS; l++) {\n          const a = DOT_BASE_ALPHA[c] * (l + 1) / ALPHA_LEVELS;\n          this.dotStyles.push(`rgba(${r},${g},${b},${a.toFixed(3)})`);\n        }\n      }\n    }\n    ctx;\n    bg;\n    dpr = 1;\n    width = 0;\n    height = 0;\n    cw = 12;\n    ch = 18;\n    cols = 0;\n    rows = 0;\n    fontFamily = "ui-monospace, Menlo, monospace";\n    dotKind = new Uint8Array(0);\n    // 0 none, 1 blue, 2 green, 3 red, 4 pale\n    dotPhase = new Float32Array(0);\n    dotFreq = new Float32Array(0);\n    energy = new Float32Array(0);\n    energyTmp = new Float32Array(0);\n    heat = new Float32Array(0);\n    bucketOf = new Uint8Array(0);\n    bucketOrder = new Int32Array(0);\n    bucketCounts = new Int32Array(DOT_RGB.length * ALPHA_LEVELS + 1);\n    dotStyles = [];\n    sharkFlag = new Uint8Array(0);\n    sharkShade = new Float32Array(0);\n    sharkKey = new Uint32Array(0);\n    sharkDepth = new Float32Array(0);\n    sharkKind = new Uint8Array(0);\n    /** Cells darkened by a shark\'s shadow on the seabed. */\n    sharkShadow = new Uint8Array(0);\n    spine = new Float32Array(SHARK_NODES * 2);\n    arc = new Float32Array(SHARK_NODES);\n    arcTotal = 1;\n    shape = SHAPES.classic;\n    sharkId = 0;\n    finTipLeft = 0;\n    finTipRight = 0;\n    // Scratch outputs of sampleShark(), to avoid allocating per sample.\n    hitFlag = 0;\n    hitShade = 0;\n    hitS = 0;\n    hitV = 0;\n    hitDist = 0;\n    /** Cells holding a fish this frame (frame stamp); dots skip them. */\n    fishStamp = new Uint32Array(0);\n    frameId = 0;\n    /** Fish cells bucketed by brightness, so each bucket is one fillStyle. */\n    fishBuckets = FISH_ALPHAS.map(() => []);\n    fishStyles = FISH_ALPHAS.map((a) => `rgba(230,238,255,${a})`);\n    /** High-refresh frames share the original 60 Hz wake cadence. */\n    fieldStep = 0;\n    fieldAcc = 0;\n    get cellWidth() {\n      return this.cw;\n    }\n    get cellHeight() {\n      return this.ch;\n    }\n    setFontFamily(family) {\n      if (family) this.fontFamily = family;\n    }\n    resize(width2, height2, dpr2) {\n      this.fieldAcc = 0;\n      this.width = width2;\n      this.height = height2;\n      this.dpr = dpr2;\n      this.cw = clamp(Math.round(width2 / 124), 8, 13);\n      this.ch = Math.round(this.cw * 1.45);\n      this.cols = Math.ceil(width2 / this.cw);\n      this.rows = Math.ceil(height2 / this.ch);\n      this.canvas.width = Math.round(width2 * dpr2);\n      this.canvas.height = Math.round(height2 * dpr2);\n      this.bg.width = this.canvas.width;\n      this.bg.height = this.canvas.height;\n      const n = this.cols * this.rows;\n      this.dotKind = new Uint8Array(n);\n      this.dotPhase = new Float32Array(n);\n      this.dotFreq = new Float32Array(n);\n      this.energy = new Float32Array(n);\n      this.energyTmp = new Float32Array(n);\n      this.heat = new Float32Array(n);\n      this.bucketOf = new Uint8Array(n);\n      this.bucketOrder = new Int32Array(n);\n      this.sharkFlag = new Uint8Array(n);\n      this.sharkShade = new Float32Array(n);\n      this.sharkKey = new Uint32Array(n);\n      this.sharkDepth = new Float32Array(n);\n      this.sharkKind = new Uint8Array(n);\n      this.sharkShadow = new Uint8Array(n);\n      this.fishStamp = new Uint32Array(n);\n      for (let i = 0; i < n; i++) {\n        const col = i % this.cols;\n        const row = i / this.cols | 0;\n        this.dotKind[i] = 0;\n        this.dotPhase[i] = hash3(col, row, 23) * Math.PI * 2;\n        this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;\n      }\n      this.paintBackground();\n    }\n    paintBackground() {\n      const g = this.bg.getContext("2d");\n      if (!g) return;\n      const { width: W, height: H, dpr: dpr2, cw, ch } = this;\n      g.setTransform(dpr2, 0, 0, dpr2, 0, 0);\n      g.fillStyle = "#000";\n      g.fillRect(0, 0, W, H);\n      paintGrid(g, W, H, cw, ch, dpr2);\n    }\n    /** fieldStep is speed / 60 above 60 fps; omit it for legacy/still frames. */\n    render(world2, dt, fieldStep = 0) {\n      const { ctx, dpr: dpr2, cols, ch } = this;\n      if (cols === 0) return;\n      const t = world2.time;\n      this.consumeEvents(world2);\n      this.rasterizeSharks(world2.sharks, t);\n      const step = Number.isFinite(fieldStep) && fieldStep > 0 ? fieldStep : 0;\n      if (step !== this.fieldStep) {\n        this.fieldStep = step;\n        this.fieldAcc = 0;\n      }\n      if (step === 0) {\n        this.depositWake(world2);\n        this.diffuse(dt);\n      } else {\n        this.fieldAcc = Math.min(this.fieldAcc + (Number.isFinite(dt) ? Math.max(0, dt) : 0), step * 4);\n        while (this.fieldAcc + 1e-10 >= step) {\n          this.depositWake(world2);\n          this.diffuse(step);\n          this.fieldAcc = Math.max(0, this.fieldAcc - step);\n        }\n      }\n      ctx.setTransform(1, 0, 0, 1, 0, 0);\n      ctx.drawImage(this.bg, 0, 0);\n      ctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);\n      this.markFish(world2);\n      this.drawDots(t);\n      ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;\n      ctx.textAlign = "center";\n      ctx.textBaseline = "middle";\n      this.drawHeat();\n      this.drawFish();\n      this.drawSharks(t);\n    }\n    // \u2500\u2500 simulation \u2192 field \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    cellIndex(x, y) {\n      const c = Math.floor(x / this.cw);\n      const r = Math.floor(y / this.ch);\n      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;\n      return r * this.cols + c;\n    }\n    stamp(field, x, y, radius, amount) {\n      const c0 = Math.floor(x / this.cw);\n      const r0 = Math.floor(y / this.ch);\n      for (let r = r0 - radius; r <= r0 + radius; r++) {\n        for (let c = c0 - radius; c <= c0 + radius; c++) {\n          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;\n          const d = Math.hypot(c - c0, (r - r0) * 1.4);\n          if (d > radius + 0.5) continue;\n          const i = r * this.cols + c;\n          field[i] = Math.min(1.6, field[i] + amount * (1 - d / (radius + 1)));\n        }\n      }\n    }\n    consumeEvents(world2) {\n      for (const e of world2.events) {\n        if (e.kind === "eat") {\n          this.stamp(this.heat, e.x, e.y, 2, 1);\n          this.stamp(this.energy, e.x, e.y, 3, 0.9);\n        } else {\n          this.stamp(this.energy, e.x, e.y, 6, 1.4);\n        }\n      }\n      world2.events.length = 0;\n    }\n    depositWake(world2) {\n      const { energy } = this;\n      for (const f of world2.fish) {\n        if (!f.alive) continue;\n        const i = this.cellIndex(f.x, f.y);\n        if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.012 + f.alarm * 0.03);\n      }\n      for (const sh of world2.sharks) {\n        for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {\n          const i = this.cellIndex(sh.nodes[k * 2], sh.nodes[k * 2 + 1]);\n          if (i >= 0) energy[i] = Math.min(1.6, energy[i] + 0.05 + sh.speed * 12e-4);\n        }\n      }\n      if (world2.pointer.active) {\n        this.stamp(energy, world2.pointer.x, world2.pointer.y, 1, 0.08);\n      }\n    }\n    /** Blur + decay so wakes spread out like ripples and fade. */\n    diffuse(dt) {\n      const { cols, rows, energy, energyTmp: tmp, heat } = this;\n      const decay = Math.exp(-dt * 1.5);\n      for (let r = 0; r < rows; r++) {\n        for (let c = 0; c < cols; c++) {\n          const i = r * cols + c;\n          const l = c > 0 ? energy[i - 1] : energy[i];\n          const rt = c < cols - 1 ? energy[i + 1] : energy[i];\n          const u = r > 0 ? energy[i - cols] : energy[i];\n          const d = r < rows - 1 ? energy[i + cols] : energy[i];\n          tmp[i] = (energy[i] * 4 + l + rt + u + d) * 0.125 * decay;\n        }\n      }\n      this.energy = tmp;\n      this.energyTmp = energy;\n      const heatDecay = Math.exp(-dt * 2.2);\n      for (let i = 0; i < heat.length; i++) heat[i] *= heatDecay;\n    }\n    // \u2500\u2500 sharks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    /**\n     * Classify one point against the current shark (spine/arc already built).\n     * Body coordinates: s along the spine (0 snout \u2192 1 tail), v across it.\n     * Writes hit* fields and returns whether the point is on the shark.\n     */\n    sampleShark(px, py, L) {\n      const { spine, arc } = this;\n      const N = SHARK_NODES;\n      let best = Infinity;\n      let bestSegment = 0;\n      let bestU = 0;\n      for (let k = 0; k < N - 1; k++) {\n        const ax2 = spine[k * 2];\n        const ay2 = spine[k * 2 + 1];\n        const sx2 = spine[(k + 1) * 2] - ax2;\n        const sy2 = spine[(k + 1) * 2 + 1] - ay2;\n        const len2 = sx2 * sx2 + sy2 * sy2 || 1;\n        const u2 = clamp(((px - ax2) * sx2 + (py - ay2) * sy2) / len2, 0, 1);\n        const qx = ax2 + sx2 * u2;\n        const qy = ay2 + sy2 * u2;\n        const d2 = (px - qx) ** 2 + (py - qy) ** 2;\n        if (d2 < best) {\n          best = d2;\n          bestSegment = k;\n          bestU = u2;\n        }\n      }\n      const ax = spine[bestSegment * 2];\n      const ay = spine[bestSegment * 2 + 1];\n      const sx = spine[(bestSegment + 1) * 2] - ax;\n      const sy = spine[(bestSegment + 1) * 2 + 1] - ay;\n      const len = Math.sqrt(sx * sx + sy * sy || 1);\n      const bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;\n      const a = Math.sqrt(best);\n      const s = (arc[bestSegment] + bestU * len) / this.arcTotal;\n      const u = s * L;\n      const shape = this.shape;\n      const w = shape.halfWidth(s) * L;\n      this.hitDist = a;\n      this.hitS = s;\n      this.hitV = a * bestSign;\n      const head = this.shape.head;\n      if (head && u < L * (head.sweep + head.depth + head.notch)) {\n        const span = L * head.span;\n        const r = a / span;\n        const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);\n        const depth = L * head.depth * (1 - 0.2 * r * r * r * r);\n        if (r <= 1 && u >= front && u <= front + depth) {\n          this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;\n          this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);\n          return true;\n        }\n      }\n      if (a <= w) {\n        const bestNx = -sy / len * bestSign;\n        const bestNy = sx / len * bestSign;\n        const across = a / (w || 1);\n        const facing = (bestNx * -0.6 + bestNy * -0.8) * across;\n        let shade = 0.58 - across * across * 0.42 + facing * 0.26;\n        let flag = FLAG_BODY;\n        if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {\n          flag = FLAG_RIDGE;\n          shade = 1;\n        } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {\n          shade = Math.max(shade, 0.82);\n        } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {\n          flag = FLAG_EYE;\n          shade = 0;\n        } else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {\n          if (Math.floor((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0]) * 5) % 2 === 0) shade *= 0.45;\n        } else if (s < 0.05) {\n          shade = Math.max(shade, 0.7);\n        } else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) {\n          shade = Math.max(shade, 0.8);\n        } else if (this.marked(s, a * bestSign, L, across)) {\n          flag = FLAG_MARK;\n        }\n        this.hitFlag = flag;\n        this.hitShade = shade;\n        return true;\n      }\n      const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;\n      const [p0, p1, p2] = shape.pectoral;\n      if (inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) && // Falcate (sickle) fins get a concave trailing edge.\n      !(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))) {\n        this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;\n        this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));\n        return true;\n      }\n      const [v0, v1, v2, vr] = shape.pelvic;\n      if (inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) || // Forked caudal fin.\n      shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal)) {\n        this.hitFlag = FLAG_FIN;\n        this.hitShade = 0.36;\n        return true;\n      }\n      return false;\n    }\n    /** Whether a body point (s along, v across) falls on a dark marking. */\n    marked(s, v, L, across) {\n      if (this.shape === SHAPES.tiger) {\n        if (s < 0.2 || s > 0.9 || across > 0.85) return false;\n        const wobble = 0.35 * Math.sin(v / L * 25 + s * 5);\n        const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);\n        return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);\n      }\n      if (this.shape === SHAPES.zebra) {\n        if (s < 0.07) return false;\n        const gu = s * L / (L * 0.06);\n        const gv = v / (L * 0.045);\n        const cu = Math.floor(gu);\n        const cv = Math.floor(gv);\n        const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25;\n        const jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;\n        return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;\n      }\n      return false;\n    }\n    /**\n     * Build a smooth, undulating render spine from the sim spine, then\n     * supersample every cell in the shark\'s bounding box against the shape.\n     * Fully covered cells become solid skin; partial cells become edge glyphs.\n     */\n    rasterizeSharks(sharks, t) {\n      const { sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, sharkShadow, spine, arc, cw, ch, cols, rows } = this;\n      sharkFlag.fill(0);\n      sharkShadow.fill(0);\n      for (const sh of sharks) {\n        const L = sh.length;\n        const N = SHARK_NODES;\n        const n = sh.nodes;\n        const swim = clamp(sh.speed / 60, 0.4, 1.4);\n        this.shape = SHAPES[sh.kind];\n        this.sharkId = sh.id;\n        const kindIndex = KINDS.indexOf(sh.kind);\n        for (let k = 0; k < N; k++) {\n          const s = k / (N - 1);\n          const a = Math.max(0, k - 1);\n          const b = Math.min(N - 1, k + 1);\n          let tx = n[a * 2] - n[b * 2];\n          let ty = n[a * 2 + 1] - n[b * 2 + 1];\n          const tl = Math.hypot(tx, ty) || 1;\n          tx /= tl;\n          ty /= tl;\n          const amp = L * 0.05 * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;\n          const off = amp * Math.sin(sh.phase - s * 5.2);\n          spine[k * 2] = n[k * 2] - ty * off;\n          spine[k * 2 + 1] = n[k * 2 + 1] + tx * off;\n        }\n        arc[0] = 0;\n        for (let k = 1; k < N; k++) {\n          arc[k] = arc[k - 1] + Math.hypot(spine[k * 2] - spine[(k - 1) * 2], spine[k * 2 + 1] - spine[(k - 1) * 2 + 1]);\n        }\n        this.arcTotal = arc[N - 1] || 1;\n        const bank = clamp(sh.turn * 0.45, -0.35, 0.35);\n        const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);\n        const reachFin = this.shape.pectoral[3];\n        this.finTipRight = L * reachFin * flex * (1 - bank);\n        this.finTipLeft = L * reachFin * flex * (1 + bank);\n        let minX = Infinity;\n        let minY = Infinity;\n        let maxX = -Infinity;\n        let maxY = -Infinity;\n        for (let k = 0; k < N; k++) {\n          minX = Math.min(minX, spine[k * 2]);\n          maxX = Math.max(maxX, spine[k * 2]);\n          minY = Math.min(minY, spine[k * 2 + 1]);\n          maxY = Math.max(maxY, spine[k * 2 + 1]);\n        }\n        const reach = L * 0.36;\n        const c0 = Math.max(0, Math.floor((minX - reach) / cw));\n        const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));\n        const r0 = Math.max(0, Math.floor((minY - reach) / ch));\n        const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));\n        if (c0 > c1 || r0 > r1) continue;\n        const skipBeyond = reach + Math.hypot(cw, ch);\n        const shadowDc = Math.round(L * 0.035 / cw) + 1;\n        const shadowDr = Math.round(L * 0.02 / ch) + 1;\n        for (let r = r0; r <= r1; r++) {\n          for (let c = c0; c <= c1; c++) {\n            const x = c * cw;\n            const y = r * ch;\n            const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);\n            if (!centerHit && this.hitDist > skipBeyond) continue;\n            const flag = this.hitFlag;\n            const shade = this.hitShade;\n            const s = this.hitS;\n            const v = this.hitV;\n            let hits = centerHit ? 1 : 0;\n            for (let k = 0; k < SUBSAMPLES.length; k += 2) {\n              if (this.sampleShark(x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch, L)) hits++;\n            }\n            if (hits === 0) continue;\n            const coverage = hits / 5;\n            const i = r * cols + c;\n            const key = hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295 >>> 0;\n            sharkKey[i] = key;\n            sharkDepth[i] = sh.depth;\n            sharkKind[i] = kindIndex;\n            if (centerHit && coverage >= 0.6) {\n              sharkFlag[i] = flag;\n              const flicker = (hash3(c, r, Math.floor(t * 6)) - 0.5) * 0.06;\n              sharkShade[i] = clamp(shade + flicker, 0, 1);\n              const sc = c + shadowDc;\n              const sr = r + shadowDr;\n              if (sc < cols && sr < rows) sharkShadow[sr * cols + sc] = 1;\n            } else {\n              sharkFlag[i] = FLAG_EDGE;\n              sharkShade[i] = coverage;\n            }\n          }\n        }\n      }\n    }\n    drawSharks(t) {\n      const { ctx, cols, rows, cw, ch, sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind } = this;\n      const n = cols * rows;\n      for (let i = 0; i < n; i++) {\n        const flag = sharkFlag[i];\n        if (!flag) continue;\n        const col = i % cols;\n        const row = i / cols | 0;\n        const x = col * cw;\n        const y = row * ch;\n        const key = sharkKey[i];\n        const shade = sharkShade[i];\n        const dim = 0.7 + 0.3 * sharkDepth[i];\n        const [tr, tg, tb] = SHAPES[KINDS[sharkKind[i]]].tint;\n        const tick = Math.floor(t * 2.4 + key % 997 / 97);\n        const roll = hash3(key, tick, 7);\n        if (flag === FLAG_EDGE) {\n          const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;\n          const g = (70 + shade * 80) * dim;\n          ctx.fillStyle = roll < 0.07 ? ACCENTS[key % ACCENTS.length] : `rgb(${Math.round(g * tr)},${Math.round(g * tg)},${Math.min(255, Math.round(g * tb + 6))})`;\n          ctx.fillText(set[(key >>> 8) % set.length], x + cw / 2, y + ch / 2 + 1);\n          continue;\n        }\n        let level;\n        let glyph;\n        if (flag === FLAG_RIDGE) {\n          level = 226;\n          glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length];\n        } else if (flag === FLAG_EYE) {\n          level = 12;\n          glyph = "o";\n        } else if (flag === FLAG_MARK) {\n          level = 24 + shade * 22;\n          glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];\n        } else if (flag === FLAG_FIN) {\n          level = 40 + shade * 120;\n          glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length];\n        } else {\n          level = 46 + shade * 160;\n          const jitter = (key >>> 4) % 3 - 1;\n          glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + jitter, 0, SKIN_RAMP.length - 1)];\n        }\n        level *= dim;\n        ctx.fillStyle = `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb + 4))})`;\n        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);\n        let color;\n        if (flag === FLAG_EYE) color = "#9aa0ad";\n        else if (flag === FLAG_MARK) color = `rgb(${Math.round(70 * tr)},${Math.round(70 * tg)},${Math.round(70 * tb)})`;\n        else if (roll < 0.09) color = ACCENTS[key % ACCENTS.length];\n        else if (roll < 0.13) color = "#ffffff";\n        else color = shade > 0.55 ? "#0e0f13" : "#1b1d24";\n        ctx.fillStyle = color;\n        ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);\n      }\n    }\n    // \u2500\u2500 fish, dots, heat \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n    /**\n     * Snap each fish to a cell and bucket it by brightness: far fish are dim,\n     * near fish brighter, and turning or panicking fish glint. Nearer fish\n     * claim a cell first when two land in the same one.\n     */\n    markFish(world2) {\n      const { fishStamp, fishBuckets, sharkFlag } = this;\n      const frame2 = ++this.frameId;\n      for (const bucket of fishBuckets) bucket.length = 0;\n      for (let pass = 0; pass < 2; pass++) {\n        for (const f of world2.fish) {\n          if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;\n          const i = this.cellIndex(f.x, f.y);\n          if (i < 0 || fishStamp[i] === frame2 || sharkFlag[i]) continue;\n          fishStamp[i] = frame2;\n          const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);\n          const v = 0.3 + 0.4 * (f.depth - 0.55) / 0.45 + 0.3 * Math.max(glint, f.alarm);\n          fishBuckets[clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)].push(i);\n        }\n      }\n    }\n    drawFish() {\n      const { ctx, cw, ch, cols, fishBuckets } = this;\n      for (let b = 0; b < fishBuckets.length; b++) {\n        const bucket = fishBuckets[b];\n        if (!bucket.length) continue;\n        ctx.fillStyle = this.fishStyles[b];\n        for (const i of bucket) {\n          ctx.fillText("-", i % cols * cw + cw / 2, (i / cols | 0) * ch + ch / 2 + 1);\n        }\n      }\n    }\n    drawHeat() {\n      const { ctx, heat, cols, cw, ch } = this;\n      for (let i = 0; i < heat.length; i++) {\n        const h = heat[i];\n        if (h < 0.08) continue;\n        const col = i % cols;\n        const row = i / cols | 0;\n        ctx.fillStyle = h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;\n        ctx.fillText(h > 0.6 ? "*" : "\\xB7", col * cw + cw / 2, row * ch + ch / 2 + 1);\n      }\n    }\n    /**\n     * Every cell\'s dot twinkles on its own clock, is modulated by slow\n     * caustic light bands, and flares cyan where the wake field is strong.\n     * Dots are bucketed by colour/alpha so each bucket is one fillStyle.\n     */\n    drawDots(t) {\n      const { ctx, cols, rows, cw, ch, dotKind, dotPhase, dotFreq, energy, sharkFlag, sharkShadow, fishStamp, frameId } = this;\n      const { bucketOf, bucketOrder, bucketCounts } = this;\n      const n = cols * rows;\n      const SKIP = bucketCounts.length - 1;\n      bucketCounts.fill(0);\n      for (let i = 0; i < n; i++) {\n        const e = energy[i];\n        const kind = dotKind[i];\n        if (sharkFlag[i] || fishStamp[i] === frameId || kind === 0 && e < 0.45) {\n          bucketOf[i] = SKIP;\n          continue;\n        }\n        let bucket;\n        if (e > 0.45) {\n          const level = clamp(Math.floor((e - 0.45) * 5), 0, ALPHA_LEVELS - 1);\n          bucket = WAKE * ALPHA_LEVELS + level;\n        } else {\n          const col = i % cols;\n          const row = i / cols | 0;\n          const twinkle = 0.5 + 0.5 * Math.sin(t * dotFreq[i] + dotPhase[i]);\n          const caustic = 0.85 + 0.15 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);\n          let v = clamp((0.55 + 0.45 * twinkle) * caustic + e * 2, 0, 1);\n          if (sharkShadow[i]) v *= 0.2;\n          bucket = (kind - 1) * ALPHA_LEVELS + clamp(Math.floor(v * ALPHA_LEVELS), 0, ALPHA_LEVELS - 1);\n        }\n        bucketOf[i] = bucket;\n        bucketCounts[bucket]++;\n      }\n      const starts = new Int32Array(bucketCounts.length);\n      for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1] + bucketCounts[b - 1];\n      const cursor = starts.slice();\n      for (let i = 0; i < n; i++) {\n        const b = bucketOf[i];\n        if (b !== SKIP) bucketOrder[cursor[b]++] = i;\n      }\n      const small = Math.max(2, Math.round(cw * 0.19));\n      const large = small + 1;\n      for (let b = 0; b < SKIP; b++) {\n        const count = bucketCounts[b];\n        if (!count) continue;\n        ctx.fillStyle = this.dotStyles[b];\n        const size = b >= WAKE * ALPHA_LEVELS ? large : small;\n        const start = starts[b];\n        for (let k = start; k < start + count; k++) {\n          const i = bucketOrder[k];\n          const col = i % cols;\n          const row = i / cols | 0;\n          ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);\n        }\n      }\n    }\n  };\n\n  // src/ocean-worker.ts\n  var STEP = 1 / 60;\n  var MAX_STEPS = 4;\n  var FRAME_EPSILON = 0.5;\n  function finiteRange(value, min, max, fallback) {\n    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;\n  }\n  var canvas = null;\n  var renderer = null;\n  var world = null;\n  var timer = null;\n  var snapshotCanvas = null;\n  var maxFps = 60;\n  var speed = 1;\n  var interactive = true;\n  var dpr = 1;\n  var paused = false;\n  var reduced = false;\n  var initialStatic = false;\n  var disposed = false;\n  var acc = 0;\n  var last = 0;\n  var nextDraw = 0;\n  var frames = 0;\n  var width = 0;\n  var height = 0;\n  function stop() {\n    if (timer !== null) clearTimeout(timer);\n    timer = null;\n  }\n  function schedule() {\n    stop();\n    if (paused || reduced || disposed || !renderer) return;\n    last = performance.now();\n    nextDraw = last + 1e3 / maxFps;\n    acc = 0;\n    timer = setTimeout(frame, 1e3 / maxFps);\n  }\n  function frame() {\n    timer = null;\n    if (paused || reduced || disposed || !renderer || !world) return;\n    const now = performance.now();\n    if (now + FRAME_EPSILON < nextDraw) {\n      timer = setTimeout(frame, nextDraw - now);\n      return;\n    }\n    const interval = 1e3 / maxFps;\n    nextDraw += Math.max(1, Math.floor((now - nextDraw) / interval) + 1) * interval;\n    const dt = Math.min(Math.max(0.1, 1 / maxFps), Math.max(0, (now - last) / 1e3)) * speed;\n    last = now;\n    acc += dt;\n    let steps = 0;\n    const step = 1 / Math.max(60, maxFps);\n    const maxSteps = Math.max(Math.ceil(MAX_STEPS * STEP / step), Math.ceil(speed / maxFps / step) + 1);\n    while (acc + 1e-10 >= step && steps < maxSteps) {\n      world.step(step);\n      acc = Math.max(0, acc - step);\n      steps++;\n    }\n    if (steps === maxSteps && acc >= step) acc %= step;\n    renderer.render(world, dt, maxFps > 60 ? speed / 60 : void 0);\n    frames++;\n    const wait = Math.max(0, nextDraw - performance.now());\n    timer = setTimeout(frame, wait);\n  }\n  function drawStill(warmup = false) {\n    if (!renderer || !world) return;\n    if (warmup && world.time < 4) for (let i = 0; i < 240; i++) world.step(STEP);\n    renderer.render(world, STEP);\n    frames++;\n  }\n  function resize(nextWidth, nextHeight, nextDpr) {\n    width = Math.max(1, Math.round(nextWidth));\n    height = Math.max(1, Math.round(nextHeight));\n    dpr = Math.max(1, Math.min(2, nextDpr));\n    if (!renderer || !world) return;\n    renderer.resize(width, height, dpr);\n    world.resize(width, height, renderer.cellWidth, renderer.cellHeight);\n    if (reduced || paused) drawStill(frames === 0 && (reduced || initialStatic));\n  }\n  function makeRenderer(nextCanvas, fontFamily, sharks, fishCount) {\n    canvas = nextCanvas;\n    renderer = new AsciiRenderer(nextCanvas);\n    renderer.setFontFamily(fontFamily || "ui-monospace, Menlo, monospace");\n    world = new World(sharks, fishCount);\n  }\n  function replySnapshot(requestId, rect, cw, ch, since, force) {\n    const skip = (reason) => self.postMessage({ type: "snapshot", requestId, frames, skipped: true, reason });\n    if (!canvas || disposed) return skip("unavailable");\n    if (frames === since && !force) return skip("unchanged");\n    if (!rect || ![rect.x, rect.y, rect.w, rect.h, cw, ch].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0 || cw <= 0 || ch <= 0) return skip("empty");\n    let bitmap = null;\n    try {\n      const w = Math.max(1, Math.round(cw));\n      const h = Math.max(1, Math.round(ch));\n      if (!snapshotCanvas) snapshotCanvas = new OffscreenCanvas(w, h);\n      if (snapshotCanvas.width !== w) snapshotCanvas.width = w;\n      if (snapshotCanvas.height !== h) snapshotCanvas.height = h;\n      const ctx = snapshotCanvas.getContext("2d");\n      if (!ctx) return skip("unavailable");\n      const sx = Math.max(0, rect.x * dpr);\n      const sy = Math.max(0, rect.y * dpr);\n      const sw = Math.min(canvas.width - sx, rect.w * dpr);\n      const sh = Math.min(canvas.height - sy, rect.h * dpr);\n      if (sw < 1 || sh < 1) return skip("empty");\n      ctx.clearRect(0, 0, w, h);\n      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);\n      bitmap = snapshotCanvas.transferToImageBitmap();\n      self.postMessage({ type: "snapshot", requestId, bitmap, frames }, { transfer: [bitmap] });\n    } catch {\n      bitmap?.close();\n      skip("failed");\n    }\n  }\n  self.onmessage = (event) => {\n    const data = event.data;\n    switch (data?.type) {\n      case "init": {\n        makeRenderer(data.canvas, data.fontFamily ?? "", data.sharks, data.fishCount);\n        maxFps = finiteRange(data.maxFps, 5, 144, 60);\n        speed = finiteRange(data.speed, 0.25, 2, 1);\n        interactive = data.interactive !== false;\n        reduced = data.reducedMotion === true;\n        initialStatic = data.initialStatic === true;\n        paused = data.paused === true || initialStatic;\n        resize(data.width, data.height, data.dpr ?? 1);\n        schedule();\n        break;\n      }\n      case "resize":\n        resize(data.width, data.height, data.dpr ?? dpr);\n        break;\n      case "fps":\n        maxFps = finiteRange(data.fps, 5, 144, maxFps);\n        schedule();\n        break;\n      case "configure":\n        if (!world || disposed) break;\n        world.configure(data);\n        speed = finiteRange(data.speed, 0.25, 2, speed);\n        if (typeof data.interactive === "boolean") interactive = data.interactive;\n        if (!interactive) world.pointer.active = false;\n        if (paused || reduced) drawStill();\n        break;\n      case "reduce":\n        reduced = data.reducedMotion === true;\n        if (reduced) {\n          if (world) world.pointer.active = false;\n          stop();\n          drawStill();\n        } else {\n          schedule();\n        }\n        break;\n      case "pause":\n        paused = true;\n        if (world) world.pointer.active = false;\n        stop();\n        break;\n      case "resume":\n        paused = false;\n        schedule();\n        break;\n      case "pointer":\n        if (world) {\n          if (Number.isFinite(data.x) && Number.isFinite(data.y)) {\n            world.pointer.x = data.x;\n            world.pointer.y = data.y;\n            world.pointer.active = !paused && !reduced && interactive && data.active === true;\n          } else world.pointer.active = false;\n        }\n        break;\n      case "splash":\n        if (!paused && !reduced && !disposed && interactive && Number.isFinite(data.x) && Number.isFinite(data.y)) world?.splash(data.x, data.y);\n        break;\n      case "snapshot":\n        replySnapshot(data.requestId, data.rect, data.cw, data.ch, data.since ?? -1, data.force === true);\n        break;\n      case "metrics":\n        self.postMessage({\n          type: "metrics",\n          requestId: data.requestId,\n          frames,\n          time: performance.now(),\n          running: !paused && !reduced && !disposed && renderer !== null,\n          width,\n          height,\n          dpr,\n          fishCount: world?.fish.length ?? 0,\n          sharkCount: world?.sharks.length ?? 0,\n          maxFps,\n          simulationTime: world?.time ?? 0\n        });\n        break;\n      case "dispose":\n        disposed = true;\n        stop();\n        renderer = null;\n        world = null;\n        canvas = null;\n        snapshotCanvas = null;\n        break;\n    }\n  };\n})();\n';

  // src/client.ts
  var PACKAGE_NAME = "@local/dsh-client-ui-ascii-ocean";
  var SURFACE_ID = "dsh-ascii-ocean-surface";
  var CANVAS_ID = "dsh-ascii-ocean-canvas";
  var VEIL_ID = "dsh-ascii-ocean-veil";
  var STYLE_ID = "dsh-ascii-ocean-style";
  var FILTER_ID = "dsh-liquid-filter";
  var FILTER_SVG_ID = "dsh-liquid-filter-svg";
  var PANE_CLASS = "dsh-liquid-pane";
  var CAPTURE_CLASS = "dsh-liquid-capture";
  var TINT_CLASS = "dsh-liquid-tint";
  var GLASS_CLASS = "dsh-liquid-glass";
  var SHARKS = [
    { kind: "hammerhead", size: 0.9 },
    { kind: "classic", size: 0.8 },
    { kind: "tiger", size: 0.72 },
    { kind: "thresher", size: 0.62 },
    { kind: "mako", size: 0.54 },
    { kind: "zebra", size: 0.46 }
  ];
  var sharksFor = (count) => Array.from({ length: count }, (_, index) => ({ ...SHARKS[index % SHARKS.length] }));
  var CONVERSATION_TOKENS = {
    "--dsw-alias-bg-base": {
      light: "rgba(255, 255, 255, 0.5)",
      dark: "rgba(9, 12, 17, 0.5)"
    },
    "--dsw-alias-bg-layer-1": {
      light: "rgba(255, 255, 255, 0.68)",
      dark: "rgba(28, 32, 40, 0.72)"
    },
    "--dsw-alias-bg-layer-2": {
      light: "rgba(255, 255, 255, 0.8)",
      dark: "rgba(33, 38, 47, 0.82)"
    },
    "--dsw-alias-bg-layer-3": {
      light: "rgba(255, 255, 255, 0.88)",
      dark: "rgba(38, 44, 54, 0.9)"
    },
    "--dsw-alias-bg-module-platform": {
      light: "rgba(248, 249, 251, 0.62)",
      dark: "rgba(22, 26, 33, 0.66)"
    }
  };
  var SIDEBAR_TOKENS = {
    "--dsw-specific-sidebar-fill": {
      light: "rgba(255, 255, 255, 0)",
      dark: "rgba(18, 22, 29, 0)"
    }
  };
  var GLASS = {
    light: { scale: 13, aberration: 1.6, blur: "blur(2px) saturate(185%) brightness(1.01)" },
    dark: { scale: 11, aberration: 1.6, blur: "blur(2.5px) saturate(165%) brightness(1.04)" }
  };
  var VEIL = {
    light: "radial-gradient(ellipse 85% 75% at 55% 45%, rgba(255,255,255,0.26), rgba(255,255,255,0.08) 62%, rgba(255,255,255,0))",
    dark: "radial-gradient(ellipse 85% 75% at 55% 45%, rgba(2,4,8,0.44), rgba(2,4,8,0.13) 62%, rgba(2,4,8,0.02))"
  };
  var INK_FILTER = "invert(1) hue-rotate(180deg) saturate(1.8) contrast(1.35) brightness(0.96)";
  var CSS = `
.dsh-ocean-settings { max-width: 800px; color: inherit; font: inherit; --ocean-control-bg: rgba(255,255,255,.94); }
body[data-ds-dark-theme] .dsh-ocean-settings { --ocean-control-bg: rgba(25,29,36,.95); }
.dsh-ocean-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 20px; font-size: 13px; }
.dsh-ocean-ascii { font: 600 15px/1.5 ui-monospace, Menlo, monospace; color: #27678b; letter-spacing: .04em; white-space: pre; }
body[data-ds-dark-theme] .dsh-ocean-ascii { color: #85c7e6; }
.dsh-ocean-settings fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.dsh-ocean-settings legend { font-weight: 600; padding: 0; margin-bottom: 12px; }
.dsh-ocean-modes { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; }
.dsh-ocean-mode { display: flex; gap: 9px; align-items: flex-start; padding: 14px 12px; border: 1px solid #8885; background: var(--ocean-control-bg); border-radius: 10px; cursor: pointer; }
.dsh-ocean-mode:has(:checked) { border-color: #4f7edb; box-shadow: inset 0 0 0 1px #4f7edb; }
.dsh-ocean-settings input { accent-color: #4279dc; flex: none; margin: 3px 0 0; }
.dsh-ocean-settings :is(input,select,button):focus-visible { outline: 2px solid #4279dc; outline-offset: 3px; }
.dsh-ocean-settings strong { display: block; font-weight: 600; }
.dsh-ocean-settings small { display: block; margin-top: 6px; font-size: 12px; line-height: 1.5; opacity: .75; }
.dsh-ocean-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18px; }
.dsh-ocean-settings .dsh-ocean-group { padding: 18px; border: 1px solid #8884; border-radius: 12px; background: var(--ocean-control-bg); }
.dsh-ocean-group legend { float: left; width: 100%; margin-bottom: 16px; }
.dsh-ocean-control { clear: both; margin-bottom: 20px; }
.dsh-ocean-control:last-child { margin-bottom: 0; }
.dsh-ocean-label { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.dsh-ocean-label output { font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
.dsh-ocean-settings input[type="range"] { display: block; width: 100%; min-height: 28px; margin: 7px 0 0; cursor: pointer; }
.dsh-ocean-settings input:disabled { cursor: default; opacity: .45; }
.dsh-ocean-check,.dsh-ocean-auto { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; line-height: 1.5; }
.dsh-ocean-check { margin-top: 18px; }
.dsh-ocean-auto { clear: both; font-size: 13px; margin-bottom: 12px; }
.dsh-ocean-settings select { display: block; width: 100%; margin-top: 8px; padding: 8px; border: 1px solid #8887; border-radius: 6px; color: inherit; background: var(--ocean-control-bg); font: inherit; }
.dsh-ocean-preview-note { font-size: 13px; margin: 20px 0; line-height: 1.6; }
.dsh-ocean-footer { display: flex; gap: 20px; align-items: center; justify-content: space-between; padding-top: 16px; }
.dsh-ocean-status { margin: 0; font-size: 12px; line-height: 1.6; }
.dsh-ocean-footer button { flex: none; border: 1px solid #8886; border-radius: 7px; padding: 8px 12px; background: var(--ocean-control-bg); color: inherit; cursor: pointer; font: inherit; font-size: 13px; }
@media (max-width: 680px) { .dsh-ocean-grid { grid-template-columns: 1fr; } }
@media (max-width: 460px) { .dsh-ocean-modes { grid-template-columns: 1fr; } .dsh-ocean-footer { align-items: flex-start; flex-direction: column; } }

#root {
  position: relative;
  z-index: 1;
}
#${SURFACE_ID} {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  animation: dsh-ascii-ocean-fade 900ms ease-out 60ms both;
}
@keyframes dsh-ascii-ocean-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
#${SURFACE_ID}[data-scheme="light"] #${CANVAS_ID} {
  filter: ${INK_FILTER};
}
#${SURFACE_ID}[data-scheme="dark"] #${CANVAS_ID} {
  filter: none;
}
#${CANVAS_ID} {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  font-family: "Geist Mono", ui-monospace, Menlo, Consolas, monospace;
}
#${VEIL_ID} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: background 260ms ease;
}
@media (prefers-reduced-motion: reduce) {
  #${SURFACE_ID} { animation: none; }
}

/* Liquid-glass sidebar: floating rounded pane whose backdrop is displaced by
   the SVG filter, with a tint/highlight layer and a bright glass rim. */
.${GLASS_CLASS} {
  position: relative;
  isolation: isolate;
}
.${PANE_CLASS} {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  box-shadow: none;
}
body[data-ds-dark-theme] .${PANE_CLASS} {
  box-shadow: none;
}
.${CAPTURE_CLASS} {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  width: 50%;
  height: 50%;
  transform: scale(2);
  transform-origin: 0 0;
}
.${TINT_CLASS} {
  position: absolute;
  inset: 0;
  background: linear-gradient(150deg,
    rgba(196, 224, 255, 0.2) 0%, rgba(255, 255, 255, 0.03) 44%, rgba(255, 214, 244, 0.12) 100%);
}
body[data-ds-dark-theme] .${TINT_CLASS} {
  background: linear-gradient(150deg,
    rgba(90, 130, 200, 0.18) 0%, rgba(255, 255, 255, 0.02) 44%, rgba(150, 90, 180, 0.12) 100%);
}
`;
  function columnOf(slotName) {
    const slot = document.querySelector(`[data-slot="${slotName}"]`);
    const parent = slot?.parentElement;
    return parent instanceof HTMLElement ? parent : null;
  }
  function findTargets() {
    const conversation = columnOf("main");
    const sidebar = columnOf("sidebar");
    const frame = conversation?.parentElement;
    if (!conversation || !sidebar || !frame) return null;
    return { frame, sidebar, conversation };
  }
  function currentScheme(ctx) {
    try {
      const scheme = ctx.theme.getTheme()?.active?.colorScheme;
      if (scheme === "dark" || scheme === "light") return scheme;
    } catch {
    }
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function createDisplacementMap(width, height, radius) {
    const W = Math.max(32, Math.round(width / 2));
    const H = Math.max(32, Math.round(height / 2));
    const r = Math.max(0, radius / 2);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const image = ctx.createImageData(W, H);
    const data = image.data;
    const cx = W / 2;
    const cy = H / 2;
    const rx = Math.max(0, cx - r);
    const ry = Math.max(0, cy - r);
    const band = Math.max(6, Math.min(44, Math.min(W, H) * 0.35));
    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - cy;
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - cx;
        const qx = Math.abs(dx) - rx;
        const qy = Math.abs(dy) - ry;
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const dist = Math.min(Math.max(qx, qy), 0) + outside - r;
        let edge = Math.min(1, Math.max(0, -dist / band));
        edge = edge * edge * (3 - 2 * edge);
        const len = Math.hypot(dx, dy) || 1;
        const i = (y * W + x) * 4;
        data[i] = Math.round(128 + dx / len * edge * 126);
        data[i + 1] = Math.round(128 + edge * 126);
        data[i + 2] = Math.round(128 + dy / len * edge * 126);
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  }
  function buildFilterMarkup(mapUrl, scale, aberration) {
    const blur = Math.max(0.1, 0.45 - aberration * 0.08);
    return `<filter id="${FILTER_ID}" x="-9%" y="-3%" width="118%" height="106%" color-interpolation-filters="sRGB">
    <feImage href="${mapUrl}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="MAP"/>
    <feColorMatrix in="MAP" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 1 0 0 0" result="EDGE_RGBA"/>
    <feComponentTransfer in="EDGE_RGBA" result="EDGE_MASK">
      <feFuncA type="discrete" tableValues="0 0.08 1"/>
    </feComponentTransfer>
    <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER"/>
    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${-scale}" xChannelSelector="R" yChannelSelector="B" result="RD"/>
    <feColorMatrix in="RD" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="RC"/>
    <feDisplacementMap in="SourceGraphic" in2="MAP" scale="${-scale * (1 + aberration * 0.03)}" xChannelSelector="R" yChannelSelector="B" result="GBD"/>
    <feColorMatrix in="GBD" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="GBC"/>
    <feBlend in="RC" in2="GBC" mode="screen" result="RGB"/>
    <feGaussianBlur in="RGB" stdDeviation="${blur}" result="ABERRATED"/>
    <feComposite in="ABERRATED" in2="EDGE_MASK" operator="in" result="EDGE_ART"/>
    <feComponentTransfer in="EDGE_MASK" result="INVERTED">
      <feFuncA type="table" tableValues="1 0"/>
    </feComponentTransfer>
    <feComposite in="CENTER" in2="INVERTED" operator="in" result="CENTER_CLEAN"/>
    <feComposite in="EDGE_ART" in2="CENTER_CLEAN" operator="over"/>
  </filter>`;
  }
  function createOcean(ctx) {
    let scheme = currentScheme(ctx);
    let preferences = readPreferences();
    let saved = true;
    let fallback = false;
    let wrap = null;
    let canvas = null;
    let veil = null;
    let engine = null;
    let worker = null;
    let workerUrl = null;
    let workerFrames = 0;
    let metricId = 0;
    const metricRequests = /* @__PURE__ */ new Map();
    let targets = null;
    let focused = document.hasFocus();
    let disposed = false;
    let playing = null;
    const motion = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const shouldRun = () => preferences.mode === "dynamic" && !motion?.matches && !document.hidden && focused;
    const listeners = /* @__PURE__ */ new Set();
    const snapshotState = () => ({ ...preferences, reduced: motion?.matches === true, saved, fallback });
    let state = snapshotState();
    const notify = () => {
      state = snapshotState();
      for (const listener of listeners) listener();
    };
    const savedProps = /* @__PURE__ */ new Map();
    const glassEls = /* @__PURE__ */ new Set();
    let savedFrame = null;
    let pane = null;
    let capture = null;
    let captureCtx = null;
    let filterSvg = null;
    let mapUrl = "";
    let mapSize = { width: 0, height: 0 };
    let geometry = "";
    let lastCapturedFrame = -1;
    let captureDirty = true;
    let captureRevision = 0;
    let requestId = 0;
    let inFlight = null;
    let captureTimer = 0;
    const invalidateCapture = () => {
      captureRevision++;
      captureDirty = true;
      lastCapturedFrame = -1;
    };
    const sidebarObserver = new ResizeObserver(() => {
      if (disposed || preferences.mode === "off") return;
      ensurePane();
      requestSnapshot();
    });
    const scope = (el, tokens) => {
      let previous = savedProps.get(el);
      if (!previous) {
        previous = /* @__PURE__ */ new Map();
        savedProps.set(el, previous);
      }
      for (const [name, value] of Object.entries(tokens)) {
        if (!previous.has(name)) previous.set(name, { value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) });
        if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
      }
    };
    const restoreScopes = () => {
      for (const [el, previous] of savedProps) for (const [name, original] of previous) {
        if (original.value) el.style.setProperty(name, original.value, original.priority);
        else el.style.removeProperty(name);
      }
      savedProps.clear();
      if (savedFrame) {
        if (savedFrame.value) savedFrame.el.style.setProperty("background", savedFrame.value, savedFrame.priority);
        else savedFrame.el.style.removeProperty("background");
        savedFrame = null;
      }
      for (const el of glassEls) {
        el.classList.remove(GLASS_CLASS);
        el.classList.remove("dsh-liquid-compact");
      }
      glassEls.clear();
    };
    const quietPage = () => {
      const id = ctx.layout?.panelInfo?.getSnapshot()?.activePanelId;
      return id === "plugins" || id === "settings" || id === "automations" || id === "automation";
    };
    const applyScopes = (next) => {
      if (preferences.mode === "off") return;
      const values = Object.fromEntries(Object.entries(CONVERSATION_TOKENS).map(([name, modes]) => [name, modes[scheme]]));
      const alpha = (100 - preferences.clarity) / 100;
      const quiet = quietPage() && !document.querySelector(".dsh-ocean-settings");
      values["--dsw-alias-bg-base"] = quiet ? scheme === "light" ? "rgb(250, 251, 253)" : "rgb(15, 19, 25)" : scheme === "light" ? `rgba(255, 255, 255, ${alpha})` : `rgba(9, 12, 17, ${alpha})`;
      scope(next.conversation, values);
      if (preferences.glass) {
        scope(next.sidebar, Object.fromEntries(Object.entries(SIDEBAR_TOKENS).map(([name, modes]) => [name, modes[scheme]])));
        next.sidebar.classList.add(GLASS_CLASS);
        next.sidebar.classList.toggle("dsh-liquid-compact", next.sidebar.getBoundingClientRect().width < 140);
        glassEls.add(next.sidebar);
      }
      if (!savedFrame) savedFrame = { el: next.frame, value: next.frame.style.getPropertyValue("background"), priority: next.frame.style.getPropertyPriority("background") };
      next.frame.style.setProperty("background", "transparent", "important");
    };
    const removePane = () => {
      sidebarObserver.disconnect();
      pane?.remove();
      filterSvg?.remove();
      pane = null;
      capture = null;
      captureCtx = null;
      filterSvg = null;
      mapUrl = "";
      mapSize = { width: 0, height: 0 };
      geometry = "";
      invalidateCapture();
    };
    const rebuildFilter = () => {
      if (!mapUrl || !filterSvg) return;
      const tune = GLASS[scheme];
      filterSvg.innerHTML = `<defs>${buildFilterMarkup(mapUrl, tune.scale, tune.aberration)}</defs>`;
      if (capture) capture.style.filter = `${tune.blur} url(#${FILTER_ID})`;
      invalidateCapture();
    };
    const ensurePane = () => {
      const side = targets?.sidebar;
      if (!side || preferences.mode === "off" || !preferences.glass) return;
      if (!pane?.isConnected || pane.parentElement !== side) {
        removePane();
        pane = document.createElement("div");
        pane.className = PANE_CLASS;
        pane.setAttribute("aria-hidden", "true");
        capture = document.createElement("canvas");
        capture.className = CAPTURE_CLASS;
        const tint = document.createElement("div");
        tint.className = TINT_CLASS;
        pane.append(capture, tint);
        side.prepend(pane);
        filterSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        filterSvg.setAttribute("id", FILTER_SVG_ID);
        filterSvg.setAttribute("aria-hidden", "true");
        filterSvg.setAttribute("style", "position:absolute;width:0;height:0;left:-9999px");
        document.body.append(filterSvg);
        sidebarObserver.observe(side);
      }
      const rect = side.getBoundingClientRect();
      const key = [rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight, window.devicePixelRatio].join(":");
      if (key !== geometry) {
        geometry = key;
        invalidateCapture();
      }
      const halfW = Math.round(rect.width / 2), halfH = Math.round(rect.height / 2);
      if (halfW > 30 && (!mapUrl || Math.abs(halfW - mapSize.width) > 16 || Math.abs(halfH - mapSize.height) > 16)) {
        mapSize = { width: halfW, height: halfH };
        mapUrl = createDisplacementMap(halfW, halfH, 0);
        rebuildFilter();
      } else if (capture && !capture.style.filter) rebuildFilter();
    };
    const workerSize = () => {
      const rect = wrap?.getBoundingClientRect();
      return { width: Math.max(1, Math.round(rect?.width || window.innerWidth)), height: Math.max(1, Math.round(rect?.height || window.innerHeight)) };
    };
    const workerDpr = () => Math.min(window.devicePixelRatio || 1, 1.5);
    const post = (message) => worker?.postMessage(message);
    const stopWorker = () => {
      for (const request of metricRequests.values()) {
        clearTimeout(request.timer);
        request.resolve(null);
      }
      metricRequests.clear();
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        try {
          worker.postMessage({ type: "dispose" });
        } catch {
        }
        worker.terminate();
        worker = null;
      }
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerUrl = null;
      workerFrames = 0;
      inFlight = null;
      playing = null;
    };
    const restartCanvasForFallback = () => {
      if (!wrap || !canvas) return;
      const next = document.createElement("canvas");
      next.id = CANVAS_ID;
      next.setAttribute("aria-hidden", "true");
      canvas.replaceWith(next);
      canvas = next;
      invalidateCapture();
    };
    const startLocalEngine = () => {
      if (!canvas) return;
      fallback = true;
      notify();
      engine = new OceanEngine(canvas, sharksFor(preferences.sharkCount), {
        fishCount: preferences.fishCount,
        speed: preferences.speed,
        interactive: preferences.interactive,
        maxFps: preferences.maxFps,
        maxDpr: 1.5,
        paused: !shouldRun(),
        initialStatic: preferences.mode === "static",
        onFrame: () => {
          if (!shouldRun()) {
            invalidateCapture();
            requestSnapshot();
          }
        }
      });
      syncPlayback();
    };
    const startWorker = () => {
      if (!canvas) return false;
      try {
        const off = canvas.transferControlToOffscreen();
        workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
        const next = new Worker(workerUrl);
        worker = next;
        next.onmessage = (event) => {
          const data = event.data;
          if (data?.type === "metrics") {
            if (worker !== next) return;
            const request = metricRequests.get(data.requestId);
            if (request) {
              clearTimeout(request.timer);
              metricRequests.delete(data.requestId);
              request.resolve(data);
            }
            return;
          }
          if (data?.type !== "snapshot") return;
          if (worker !== next || !inFlight || data.requestId !== inFlight.id) {
            data.bitmap?.close();
            return;
          }
          const revision = inFlight.revision;
          inFlight = null;
          workerFrames = data.frames;
          if (revision === captureRevision && preferences.mode !== "off" && preferences.glass && !document.hidden) {
            if (data.bitmap) drawSnapshot(data.bitmap, data.frames);
            else if (data.skipped && data.reason === "unchanged") captureDirty = false;
          } else data.bitmap?.close();
          if (captureDirty && revision !== captureRevision) requestSnapshot();
        };
        next.onerror = () => {
          if (worker !== next) return;
          stopWorker();
          restartCanvasForFallback();
          startLocalEngine();
          requestSnapshot();
        };
        next.postMessage({
          type: "init",
          canvas: off,
          ...workerSize(),
          dpr: workerDpr(),
          maxFps: preferences.maxFps,
          sharks: sharksFor(preferences.sharkCount),
          fishCount: preferences.fishCount,
          speed: preferences.speed,
          interactive: preferences.interactive,
          fontFamily: getComputedStyle(canvas).fontFamily,
          reducedMotion: motion?.matches === true,
          paused: !shouldRun(),
          initialStatic: preferences.mode === "static"
        }, [off]);
        fallback = false;
        notify();
        syncPlayback();
        return true;
      } catch {
        stopWorker();
        restartCanvasForFallback();
        return false;
      }
    };
    const captureContext = (cw, ch) => {
      if (!capture) return null;
      if (capture.width !== cw || capture.height !== ch) {
        capture.width = cw;
        capture.height = ch;
        captureCtx = null;
      }
      if (!captureCtx || captureCtx.canvas !== capture) captureCtx = capture.getContext("2d");
      return captureCtx;
    };
    const drawSnapshot = (bitmap, frames) => {
      try {
        if (!capture || !pane?.isConnected || !targets) return;
        const rect = targets.sidebar.getBoundingClientRect();
        const cw = Math.max(16, Math.round(rect.width / 2)), ch = Math.max(16, Math.round(rect.height / 2));
        const context = captureContext(cw, ch);
        if (!context) return;
        context.save();
        context.filter = scheme === "light" ? INK_FILTER : "none";
        context.drawImage(bitmap, 0, 0, cw, ch);
        context.restore();
        lastCapturedFrame = frames;
        captureDirty = false;
      } finally {
        bitmap.close();
      }
    };
    const captureBackdropLocal = () => {
      if (!capture || !canvas || !pane?.isConnected || !targets) return;
      const frames = engine?.frames ?? 0;
      if (!captureDirty && frames === lastCapturedFrame) return;
      const rect = targets.sidebar.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4 || canvas.width < 4 || canvas.height < 4) return;
      const cw = Math.max(16, Math.round(rect.width / 2)), ch = Math.max(16, Math.round(rect.height / 2));
      const context = captureContext(cw, ch);
      if (!context) return;
      const sourceRect = canvas.getBoundingClientRect();
      const rx = canvas.width / Math.max(1, sourceRect.width), ry = canvas.height / Math.max(1, sourceRect.height);
      context.save();
      context.filter = scheme === "light" ? INK_FILTER : "none";
      context.drawImage(
        canvas,
        (rect.left - sourceRect.left) * rx,
        (rect.top - sourceRect.top) * ry,
        rect.width * rx,
        rect.height * ry,
        0,
        0,
        cw,
        ch
      );
      context.restore();
      lastCapturedFrame = frames;
      captureDirty = false;
    };
    const requestSnapshot = () => {
      if (disposed || preferences.mode === "off" || !preferences.glass || !capture || !pane?.isConnected || document.hidden || !targets) return;
      if (!shouldRun() && !captureDirty) return;
      if (worker) {
        if (inFlight) return;
        const rect = targets.sidebar.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return;
        inFlight = { id: ++requestId, revision: captureRevision };
        post({
          type: "snapshot",
          requestId,
          force: captureDirty,
          rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
          cw: Math.max(16, Math.round(rect.width / 2)),
          ch: Math.max(16, Math.round(rect.height / 2)),
          since: lastCapturedFrame
        });
      } else captureBackdropLocal();
    };
    const syncPlayback = (refresh = true) => {
      const running = shouldRun();
      if (running !== playing) {
        playing = running;
        post({ type: running ? "resume" : "pause" });
        if (running) engine?.resume();
        else engine?.pause();
      }
      if (running && preferences.glass && !captureTimer) captureTimer = window.setInterval(requestSnapshot, 120);
      else if ((!running || !preferences.glass) && captureTimer) {
        clearInterval(captureTimer);
        captureTimer = 0;
      }
      if (refresh) {
        invalidateCapture();
        requestSnapshot();
      }
    };
    let lastPointerPost = 0;
    const onPointerMove = (event) => {
      if (!shouldRun() || !preferences.interactive) return;
      const now = performance.now();
      if (now - lastPointerPost < 50) return;
      lastPointerPost = now;
      post({ type: "pointer", x: event.clientX, y: event.clientY, active: event.pointerType !== "touch" && !isInteractiveTarget(event) });
    };
    const onPointerDown = (event) => {
      if (!shouldRun() || !preferences.interactive || event.button !== void 0 && event.button !== 0 || isInteractiveTarget(event)) return;
      post({ type: "splash", x: event.clientX, y: event.clientY });
    };
    const onPointerLeave = () => post({ type: "pointer", x: 0, y: 0, active: false });
    const onWindowBlur = () => {
      focused = false;
      onPointerLeave();
      syncPlayback();
    };
    const onWindowFocus = () => {
      focused = true;
      syncPlayback();
    };
    const onVisibility = () => {
      focused = document.hasFocus();
      syncPlayback();
    };
    const onWindowResize = () => {
      post({ type: "resize", ...workerSize(), dpr: workerDpr() });
      invalidateCapture();
      ensurePane();
      requestSnapshot();
    };
    const onMotionPreference = () => {
      post({ type: "reduce", reducedMotion: motion?.matches === true });
      syncPlayback();
      notify();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("resize", onWindowResize);
    document.addEventListener("visibilitychange", onVisibility);
    motion?.addEventListener("change", onMotionPreference);
    const mountSurface = () => {
      if (wrap?.isConnected) return;
      engine?.destroy();
      engine = null;
      stopWorker();
      invalidateCapture();
      wrap = document.createElement("div");
      wrap.id = SURFACE_ID;
      wrap.dataset.scheme = scheme;
      wrap.setAttribute("aria-hidden", "true");
      wrap.style.display = preferences.mode === "off" ? "none" : "";
      canvas = document.createElement("canvas");
      canvas.id = CANVAS_ID;
      canvas.setAttribute("aria-hidden", "true");
      veil = document.createElement("div");
      veil.id = VEIL_ID;
      veil.style.background = VEIL[scheme];
      wrap.append(canvas, veil);
      (document.body ?? document.documentElement).prepend(wrap);
      if (!startWorker()) startLocalEngine();
    };
    const mount = () => {
      if (disposed || !document.body) return false;
      const next = findTargets();
      if (!next) return false;
      if (targets?.conversation !== next.conversation || targets?.sidebar !== next.sidebar || targets?.frame !== next.frame) {
        removePane();
        restoreScopes();
        targets = next;
      }
      mountSurface();
      applyScopes(next);
      ensurePane();
      requestSnapshot();
      return true;
    };
    const setScheme = (next) => {
      if (next === scheme) return;
      scheme = next;
      if (wrap) wrap.dataset.scheme = scheme;
      if (veil) veil.style.background = VEIL[scheme];
      if (targets) {
        applyScopes(targets);
        rebuildFilter();
        invalidateCapture();
        requestSnapshot();
      }
    };
    const ensure = () => {
      setScheme(currentScheme(ctx));
      return mount();
    };
    const applyPreferences = (previous) => {
      if (preferences.glass !== previous.glass) {
        removePane();
        restoreScopes();
      }
      if (wrap) wrap.style.display = preferences.mode === "off" ? "none" : "";
      if (preferences.mode === "off") {
        removePane();
        restoreScopes();
      } else if (targets) {
        applyScopes(targets);
        ensurePane();
      }
      syncPlayback(false);
      const config = {};
      if (preferences.fishCount !== previous.fishCount) config.fishCount = preferences.fishCount;
      if (preferences.sharkCount !== previous.sharkCount) config.sharks = sharksFor(preferences.sharkCount);
      if (preferences.speed !== previous.speed) config.speed = preferences.speed;
      if (preferences.interactive !== previous.interactive) config.interactive = preferences.interactive;
      if (Object.keys(config).length) {
        post({ type: "configure", ...config });
        engine?.configure(config);
      }
      if (preferences.maxFps !== previous.maxFps) {
        post({ type: "fps", fps: preferences.maxFps });
        engine?.setMaxFps(preferences.maxFps);
      }
      if (!preferences.interactive) onPointerLeave();
      invalidateCapture();
      requestSnapshot();
      notify();
    };
    const setPreferences = (patch) => {
      const previous = preferences;
      preferences = normalizePreferences({ ...preferences, ...patch });
      saved = savePreferences(preferences);
      applyPreferences(previous);
    };
    const setMode = (mode) => {
      if (["dynamic", "static", "off"].includes(mode)) setPreferences({ mode });
    };
    const onStorage = (event) => {
      if (event.key !== PREFERENCES_KEY && event.key !== null) return;
      const previous = preferences;
      preferences = readPreferences();
      saved = true;
      applyPreferences(previous);
    };
    window.addEventListener("storage", onStorage);
    const offPanel = ctx.layout?.panelInfo?.subscribe(() => {
      if (targets) applyScopes(targets);
    });
    return {
      get mounted() {
        return wrap?.isConnected === true;
      },
      get frames() {
        return worker ? workerFrames : engine?.frames ?? 0;
      },
      getSnapshot: () => state,
      // Read the renderer clock directly; glass snapshots can carry old counts.
      getMetrics() {
        if (!worker) return Promise.resolve(engine?.getMetrics() ?? null);
        return new Promise((resolve) => {
          const id = `metrics-${++metricId}`;
          const timer = setTimeout(() => {
            metricRequests.delete(id);
            resolve(null);
          }, 2e3);
          metricRequests.set(id, { resolve, timer });
          try {
            post({ type: "metrics", requestId: id });
          } catch {
            clearTimeout(timer);
            metricRequests.delete(id);
            resolve(null);
          }
        });
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setMode,
      setPreferences,
      resetPreferences() {
        setPreferences({ ...DEFAULT_PREFERENCES });
      },
      mount,
      ensure,
      setScheme,
      toggle() {
        const enabled = preferences.mode === "off";
        setMode(enabled ? "dynamic" : "off");
        return enabled;
      },
      destroy() {
        disposed = true;
        clearInterval(captureTimer);
        captureTimer = 0;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerdown", onPointerDown);
        document.documentElement.removeEventListener("pointerleave", onPointerLeave);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        window.removeEventListener("resize", onWindowResize);
        window.removeEventListener("storage", onStorage);
        document.removeEventListener("visibilitychange", onVisibility);
        motion?.removeEventListener("change", onMotionPreference);
        offPanel?.();
        engine?.destroy();
        engine = null;
        stopWorker();
        wrap?.remove();
        wrap = null;
        canvas = null;
        veil = null;
        removePane();
        restoreScopes();
        targets = null;
        listeners.clear();
      }
    };
  }
  var hostReact;
  function apply(ctx) {
    ctx.effect(() => {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.append(style);
      const ocean = createOcean(ctx);
      ocean.mount();
      const offSettings = ctx.slots?.inject("plugins.item", () => ctx.slots.register({
        name: "plugins.item",
        id: "ascii-ocean",
        order: 50,
        label: "\u6D77\u6D0B\u80CC\u666F"
      }, settingsComponent(hostReact, ocean)));
      const timer = setInterval(() => ocean.ensure(), 700);
      const offTheme = ctx.on("theme/change", () => ocean.setScheme(currentScheme(ctx)));
      window.__dshAsciiOcean = ocean;
      return () => {
        delete window.__dshAsciiOcean;
        clearInterval(timer);
        offTheme?.();
        offSettings?.();
        ocean.destroy();
        style.remove();
      };
    }, "ascii-ocean: ocean + liquid glass sidebar");
  }
  globalThis.__dshAsciiOceanPlugin = { apply, inject: ["theme", "slots", "layout"] };
  window.__ModuleLoader__.load({
    id: PACKAGE_NAME,
    factory: (require2) => {
      const module = { exports: {} };
      const exports = module.exports;
      hostReact = require2("react");
      exports.apply = apply;
      exports.inject = ["theme", "slots", "layout"];
      return module.exports;
    }
  });
})();
