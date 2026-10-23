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

  // src/preview.ts
  window.OceanEngine = OceanEngine;
})();
