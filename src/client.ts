/**
 * DSH Web client plugin: an ASCII shark ocean background plus an Apple-style
 * "Liquid Glass" sidebar.
 *
 * The glass technique follows rdev/liquid-glass-react (MIT, © Max Rovensky,
 * itself adapted from shuding/liquid-glass): a rounded-rect displacement map is
 * generated per-pixel on a canvas, an SVG filter turns it into edge-only
 * refraction with chromatic aberration, and the result is composed with a
 * backdrop blur inside a floating rounded pane.
 *
 * The ocean itself is one fixed canvas behind the shell. The layout frame's own
 * background is cleared, the conversation column gets translucent surface
 * tokens (fish visible, text readable), and the left sidebar gets the glass pane.
 * The right docking column, menus, and dialogs stay opaque.
 */
import { OceanEngine, type SharkSpec } from "./ascii-sharks";
import { WORKER_SOURCE } from "./worker-source.generated";

const PACKAGE_NAME = "@local/dsh-client-ui-ascii-ocean";
const SURFACE_ID = "dsh-ascii-ocean-surface";
const CANVAS_ID = "dsh-ascii-ocean-canvas";
const VEIL_ID = "dsh-ascii-ocean-veil";
const STYLE_ID = "dsh-ascii-ocean-style";
const FILTER_ID = "dsh-liquid-filter";
const FILTER_SVG_ID = "dsh-liquid-filter-svg";
const PANE_CLASS = "dsh-liquid-pane";
const CAPTURE_CLASS = "dsh-liquid-capture";
const TINT_CLASS = "dsh-liquid-tint";
const GLASS_CLASS = "dsh-liquid-glass";

/** Six shark species, one of each, sized largest to smallest. */
const SHARKS: SharkSpec[] = [
  { kind: "hammerhead", size: 0.9 },
  { kind: "classic", size: 0.8 },
  { kind: "tiger", size: 0.72 },
  { kind: "thresher", size: 0.62 },
  { kind: "mako", size: 0.54 },
  { kind: "zebra", size: 0.46 },
];

type Scheme = "light" | "dark";

/** Surface tokens rebound on the conversation column only. */
const CONVERSATION_TOKENS: Record<string, Record<Scheme, string>> = {
  "--dsw-alias-bg-base": {
    light: "rgba(255, 255, 255, 0.5)",
    dark: "rgba(9, 12, 17, 0.5)",
  },
  "--dsw-alias-bg-layer-1": {
    light: "rgba(255, 255, 255, 0.68)",
    dark: "rgba(28, 32, 40, 0.72)",
  },
  "--dsw-alias-bg-layer-2": {
    light: "rgba(255, 255, 255, 0.8)",
    dark: "rgba(33, 38, 47, 0.82)",
  },
  "--dsw-alias-bg-layer-3": {
    light: "rgba(255, 255, 255, 0.88)",
    dark: "rgba(38, 44, 54, 0.9)",
  },
  "--dsw-alias-bg-module-platform": {
    light: "rgba(248, 249, 251, 0.62)",
    dark: "rgba(22, 26, 33, 0.66)",
  },
};

/** The sidebar's own surface is cleared; the floating pane supplies the glass. */
const SIDEBAR_TOKENS: Record<string, Record<Scheme, string>> = {
  "--dsw-specific-sidebar-fill": {
    light: "rgba(255, 255, 255, 0)",
    dark: "rgba(18, 22, 29, 0)",
  },
};

/** Liquid-glass tuning per scheme. */
const GLASS: Record<Scheme, { scale: number; aberration: number; blur: string }> = {
  light: { scale: 13, aberration: 1.6, blur: "blur(2px) saturate(185%) brightness(1.01)" },
  dark: { scale: 11, aberration: 1.6, blur: "blur(2.5px) saturate(165%) brightness(1.04)" },
};

const VEIL: Record<Scheme, string> = {
  light:
    "radial-gradient(ellipse 85% 75% at 55% 45%, rgba(255,255,255,0.26), rgba(255,255,255,0.08) 62%, rgba(255,255,255,0))",
  dark: "radial-gradient(ellipse 85% 75% at 55% 45%, rgba(2,4,8,0.44), rgba(2,4,8,0.13) 62%, rgba(2,4,8,0.02))",
};

const INK_FILTER = "invert(1) hue-rotate(180deg) saturate(1.8) contrast(1.35) brightness(0.96)";

const CSS = `
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

interface OceanHandle {
  readonly mounted: boolean;
  mount(): boolean;
  ensure(): boolean;
  setScheme(next: Scheme): void;
  toggle(): boolean;
  destroy(): void;
}

interface Targets {
  frame: HTMLElement;
  sidebar: HTMLElement;
  conversation: HTMLElement;
}

function columnOf(slotName: string): HTMLElement | null {
  const slot = document.querySelector(`[data-slot="${slotName}"]`);
  const parent = slot?.parentElement;
  return parent instanceof HTMLElement ? parent : null;
}

function findTargets(): Targets | null {
  const conversation = columnOf("main");
  const sidebar = columnOf("sidebar");
  const frame = conversation?.parentElement;
  if (!conversation || !sidebar || !frame) return null;
  return { frame, sidebar, conversation };
}

function currentScheme(ctx: any): Scheme {
  try {
    const scheme = ctx.theme.getTheme()?.active?.colorScheme;
    if (scheme === "dark" || scheme === "light") return scheme;
  } catch {
    /* fall through to the media query */
  }
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Rounded-rectangle displacement map: R/B carry the edge normal (for the SVG
 * displacement), G carries the edge strength (for the chromatic fringe mask).
 */
function createDisplacementMap(width: number, height: number, radius: number): string {
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
      data[i] = Math.round(128 + (dx / len) * edge * 126);
      data[i + 1] = Math.round(128 + edge * 126);
      data[i + 2] = Math.round(128 + (dy / len) * edge * 126);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function buildFilterMarkup(mapUrl: string, scale: number, aberration: number): string {
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

function createOcean(ctx: any): OceanHandle {
  let scheme: Scheme = currentScheme(ctx);
  let wrap: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let veil: HTMLDivElement | null = null;
  let engine: OceanEngine | null = null;
  let worker: Worker | null = null;
  let workerUrl: string | null = null;
  let workerFrames = 0;
  let targets: Targets | null = null;
  let hidden = false;
  const savedProps = new Map<HTMLElement, Map<string, { value: string; priority: string }>>();
  const glassEls = new Set<HTMLElement>();
  let savedFrame: { el: HTMLElement; value: string; priority: string } | null = null;

  // --- glass pane state -----------------------------------------------------
  let pane: HTMLDivElement | null = null;
  let capture: HTMLCanvasElement | null = null;
  let captureCtx: CanvasRenderingContext2D | null = null;
  let lastCapturedFrame = -1;
  let captureTimer = 0;
  let tint: HTMLDivElement | null = null;
  let filterSvg: SVGSVGElement | null = null;
  let mapUrl = "";
  let mapSize = { width: 0, height: 0 };

  const scope = (el: HTMLElement, tokens: Record<string, string>) => {
    let previous = savedProps.get(el);
    if (!previous) {
      previous = new Map();
      savedProps.set(el, previous);
    }
    for (const [name, value] of Object.entries(tokens)) {
      if (!previous.has(name)) {
        previous.set(name, {
          value: el.style.getPropertyValue(name),
          priority: el.style.getPropertyPriority(name),
        });
      }
      if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
    }
  };

  const restoreScopes = () => {
    for (const [el, previous] of savedProps) {
      for (const [name, saved] of previous) {
        if (saved.value) el.style.setProperty(name, saved.value, saved.priority);
        else el.style.removeProperty(name);
      }
    }
    savedProps.clear();
    if (savedFrame) {
      if (savedFrame.value) savedFrame.el.style.setProperty("background", savedFrame.value, savedFrame.priority);
      else savedFrame.el.style.removeProperty("background");
      savedFrame = null;
    }
  };

  const convValues = () => Object.fromEntries(Object.entries(CONVERSATION_TOKENS).map(([name, modes]) => [name, modes[scheme]]));
  const sideValues = () => Object.fromEntries(Object.entries(SIDEBAR_TOKENS).map(([name, modes]) => [name, modes[scheme]]));

  const applyScopes = (next: Targets) => {
    scope(next.conversation, convValues());
    scope(next.sidebar, sideValues());
    if (!next.sidebar.classList.contains(GLASS_CLASS)) next.sidebar.classList.add(GLASS_CLASS);
    const rail = next.sidebar.getBoundingClientRect().width < 140;
    next.sidebar.classList.toggle("dsh-liquid-compact", rail);
    glassEls.add(next.sidebar);
    if (!savedFrame || savedFrame.el !== next.frame) {
      savedFrame = {
        el: next.frame,
        value: next.frame.style.getPropertyValue("background"),
        priority: next.frame.style.getPropertyPriority("background"),
      };
    }
    next.frame.style.setProperty("background", "transparent", "important");
  };

  // --- liquid glass pane ----------------------------------------------------

  const rebuildFilter = () => {
    if (!mapUrl || !filterSvg) return;
    const tune = GLASS[scheme];
    filterSvg.innerHTML = `<defs>${buildFilterMarkup(mapUrl, tune.scale, tune.aberration)}</defs>`;
    // A static-ish snapshot is filtered instead of the live page backdrop: the
    // SVG filter then runs at the capture cadence, not on every ocean frame.
    if (capture) capture.style.filter = `${tune.blur} url(#${FILTER_ID})`;
    lastCapturedFrame = -1;
  };

  const ensurePane = () => {
    const side = targets?.sidebar;
    if (!side) return;
    const rect = side.getBoundingClientRect();
    if (!pane || !pane.isConnected) {
      pane = document.createElement("div");
      pane.className = PANE_CLASS;
      capture = document.createElement("canvas");
      capture.className = CAPTURE_CLASS;
      tint = document.createElement("div");
      tint.className = TINT_CLASS;
      pane.append(capture, tint);
      side.prepend(pane);
      filterSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      filterSvg.setAttribute("id", FILTER_SVG_ID);
      filterSvg.setAttribute("aria-hidden", "true");
      filterSvg.setAttribute("style", "position:absolute;width:0;height:0;left:-9999px");
      document.body.append(filterSvg);
      mapUrl = "";
      mapSize = { width: 0, height: 0 };
    }
    const halfW = Math.round(rect.width / 2);
    const halfH = Math.round(rect.height / 2);
    if (halfW > 30 && (Math.abs(halfW - mapSize.width) > 16 || Math.abs(halfH - mapSize.height) > 16)) {
      mapSize = { width: halfW, height: halfH };
      mapUrl = createDisplacementMap(halfW, halfH, 0);
      rebuildFilter();
    } else if (capture && !capture.style.filter) {
      rebuildFilter();
    }
  };

  const removePane = () => {
    pane?.remove();
    pane = null;
    capture = null;
    captureCtx = null;
    lastCapturedFrame = -1;
    tint = null;
    filterSvg?.remove();
    filterSvg = null;
    mapUrl = "";
    mapSize = { width: 0, height: 0 };
  };

  // --- ocean surface --------------------------------------------------------

  const workerSize = () => {
    const rect = wrap?.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect?.width || window.innerWidth)),
      height: Math.max(1, Math.round(rect?.height || window.innerHeight)),
    };
  };
  const workerDpr = () => Math.min(window.devicePixelRatio || 1, 1.5);
  const post = (message: any) => worker?.postMessage(message);

  const stopWorker = () => {
    if (!worker) return;
    try { worker.postMessage({ type: "dispose" }); } catch { /* ignore */ }
    worker.terminate();
    worker = null;
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  };

  const restartCanvasForFallback = () => {
    if (!wrap || !canvas) return;
    const next = document.createElement("canvas");
    next.id = CANVAS_ID;
    next.setAttribute("aria-hidden", "true");
    canvas.replaceWith(next);
    canvas = next;
  };

  const startLocalEngine = () => {
    if (!canvas) return;
    engine = new OceanEngine(canvas, SHARKS, { maxFps: 60, maxDpr: 1.5 });
  };

  const startWorker = (): boolean => {
    if (!canvas) return false;
    try {
      const off = canvas.transferControlToOffscreen();
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      const next = new Worker(url);
      worker = next;
      workerUrl = url;
      next.onmessage = (event: MessageEvent) => {
        const data = event.data as Record<string, any>;
        if (data?.type === "snapshot" && data.bitmap) drawSnapshot(data.bitmap as ImageBitmap, data.frames as number);
      };
      next.onerror = () => {
        // A worker failure is rare; rebuild the canvas and run the in-page engine.
        stopWorker();
        restartCanvasForFallback();
        startLocalEngine();
      };
      const size = workerSize();
      next.postMessage(
        {
          type: "init",
          canvas: off,
          width: size.width,
          height: size.height,
          dpr: workerDpr(),
          maxFps: 60,
          sharks: SHARKS,
          fontFamily: getComputedStyle(canvas).fontFamily,
          reducedMotion: typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
        },
        [off],
      );
      return true;
    } catch {
      stopWorker();
      return false;
    }
  };

  // --- glass snapshot -------------------------------------------------------

  const drawSnapshot = (bitmap: ImageBitmap, frames: number) => {
    workerFrames = frames;
    if (!capture || !pane?.isConnected) {
      bitmap.close();
      return;
    }
    const side = targets?.sidebar;
    if (!side) {
      bitmap.close();
      return;
    }
    const rect = side.getBoundingClientRect();
    const cw = Math.max(16, Math.round(rect.width / 2));
    const ch = Math.max(16, Math.round(rect.height / 2));
    if (capture.width !== cw || capture.height !== ch) {
      capture.width = cw;
      capture.height = ch;
      captureCtx = capture.getContext("2d");
    }
    const ctx2d = captureCtx ?? capture.getContext("2d");
    if (!ctx2d) {
      bitmap.close();
      return;
    }
    captureCtx = ctx2d;
    ctx2d.save();
    ctx2d.filter =
      scheme === "light"
        ? "invert(1) hue-rotate(180deg) saturate(1.8) contrast(1.35) brightness(0.96)"
        : "none";
    ctx2d.drawImage(bitmap, 0, 0, cw, ch);
    ctx2d.restore();
    bitmap.close();
    lastCapturedFrame = frames;
  };

  /** Fallback capture: read the in-page canvas directly. */
  const captureBackdropLocal = () => {
    if (worker || !capture || !canvas || !pane?.isConnected || document.hidden) return;
    const source = canvas;
    const frames = engine?.frames ?? 0;
    if (frames === lastCapturedFrame) return;
    const side = targets?.sidebar;
    if (!side) return;
    const rect = side.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4 || source.width < 4 || source.height < 4) return;
    const cw = Math.max(16, Math.round(rect.width / 2));
    const ch = Math.max(16, Math.round(rect.height / 2));
    if (capture.width !== cw || capture.height !== ch) {
      capture.width = cw;
      capture.height = ch;
      captureCtx = capture.getContext("2d");
      lastCapturedFrame = -1;
    }
    const ctx2d = captureCtx ?? capture.getContext("2d");
    if (!ctx2d) return;
    captureCtx = ctx2d;
    const sx = (rect.left / Math.max(1, window.innerWidth)) * source.width;
    const sy = (rect.top / Math.max(1, window.innerHeight)) * source.height;
    const sw = (rect.width / Math.max(1, window.innerWidth)) * source.width;
    const sh = (rect.height / Math.max(1, window.innerHeight)) * source.height;
    ctx2d.save();
    ctx2d.filter =
      scheme === "light"
        ? "invert(1) hue-rotate(180deg) saturate(1.8) contrast(1.35) brightness(0.96)"
        : "none";
    ctx2d.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch);
    ctx2d.restore();
    lastCapturedFrame = frames;
  };

  const requestSnapshot = () => {
    if (!capture || !pane?.isConnected || document.hidden) return;
    const side = targets?.sidebar;
    if (!side) return;
    if (worker) {
      const rect = side.getBoundingClientRect();
      post({
        type: "snapshot",
        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        cw: Math.max(16, Math.round(rect.width / 2)),
        ch: Math.max(16, Math.round(rect.height / 2)),
        since: lastCapturedFrame,
      });
    } else {
      captureBackdropLocal();
    }
  };

  // Snapshot cadence: the SVG glass filter re-runs only when a bitmap lands.
  captureTimer = window.setInterval(requestSnapshot, 120);

  // --- input / lifecycle ----------------------------------------------------

  let lastPointerPost = 0;
  const onPointerMove = (event: PointerEvent) => {
    const now = performance.now();
    if (now - lastPointerPost < 50) return;
    lastPointerPost = now;
    post({ type: "pointer", x: event.clientX, y: event.clientY, active: true });
  };
  const onPointerDown = (event: PointerEvent) => {
    if (typeof matchMedia === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    post({ type: "splash", x: event.clientX, y: event.clientY });
  };
  const onPointerLeave = () => post({ type: "pointer", x: 0, y: 0, active: false });

  const pauseOcean = () => {
    post({ type: "pause" });
    engine?.pause();
  };
  const resumeOcean = () => {
    post({ type: "resume" });
    engine?.resume();
  };
  const onWindowBlur = () => pauseOcean();
  const onWindowFocus = () => resumeOcean();
  const onVisibility = () => {
    if (document.hidden) pauseOcean();
    else resumeOcean();
  };
  const onWindowResize = () => {
    const size = workerSize();
    post({ type: "resize", width: size.width, height: size.height, dpr: workerDpr() });
  };
  const motion =
    typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const onMotionPreference = () => post({ type: "reduce", reducedMotion: motion?.matches === true });

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
    wrap = document.createElement("div");
    wrap.id = SURFACE_ID;
    wrap.dataset.scheme = scheme;
    if (hidden) wrap.style.display = "none";
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

  const mount = (): boolean => {
    if (!document.body) return false;
    const next = findTargets();
    if (!next) return false;
    if (targets?.conversation !== next.conversation || targets?.sidebar !== next.sidebar || targets?.frame !== next.frame) {
      if (targets) restoreScopes();
      targets = next;
    }
    mountSurface();
    applyScopes(targets);
    ensurePane();
    return true;
  };

  const clear = (restore: boolean) => {
    engine?.destroy();
    engine = null;
    stopWorker();
    workerFrames = 0;
    lastCapturedFrame = -1;
    wrap?.remove();
    wrap = null;
    canvas = null;
    veil = null;
    removePane();
    for (const el of glassEls) {
      el.classList.remove(GLASS_CLASS);
      el.classList.remove("dsh-liquid-compact");
    }
    glassEls.clear();
    if (restore) {
      restoreScopes();
      targets = null;
    }
  };

  const setScheme = (next: Scheme) => {
    if (next === scheme) return;
    scheme = next;
    if (wrap) wrap.dataset.scheme = scheme;
    if (veil) veil.style.background = VEIL[scheme];
    if (targets) {
      applyScopes(targets);
      rebuildFilter();
      lastCapturedFrame = -1;
    }
  };

  const ensure = () => {
    const s = currentScheme(ctx);
    if (s !== scheme) setScheme(s);
    if (!wrap?.isConnected) return mount();
    const next = findTargets();
    if (!next) return false;
    const moved = next.conversation !== targets?.conversation || next.sidebar !== targets?.sidebar || next.frame !== targets?.frame;
    if (moved) {
      clear(false);
      restoreScopes();
      targets = null;
      return mount();
    }
    applyScopes(next);
    ensurePane();
    return true;
  };

  return {
    get mounted() {
      return wrap?.isConnected === true;
    },
    get frames() {
      return worker ? workerFrames : (engine?.frames ?? 0);
    },
    mount,
    ensure,
    setScheme,
    toggle() {
      hidden = !hidden;
      if (wrap) wrap.style.display = hidden ? "none" : "";
      if (hidden) pauseOcean();
      else resumeOcean();
      return !hidden;
    },
    destroy() {
      clearInterval(captureTimer);
      captureTimer = 0;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("resize", onWindowResize);
      document.removeEventListener("visibilitychange", onVisibility);
      motion?.removeEventListener("change", onMotionPreference);
      clear(true);
    },
  };
}

/** Client plugin body: mount the ocean and the liquid-glass sidebar. */
function apply(ctx: any) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);

    const ocean = createOcean(ctx);
    ocean.mount();

    const timer = setInterval(() => ocean.ensure(), 700);
    const offTheme = ctx.on("theme/change", () => ocean.setScheme(currentScheme(ctx)));

    (window as any).__dshAsciiOcean = ocean;

    return () => {
      delete (window as any).__dshAsciiOcean;
      clearInterval(timer);
      offTheme?.();
      ocean.destroy();
      style.remove();
    };
  }, "ascii-ocean: ocean + liquid glass sidebar");
}

(globalThis as any).__dshAsciiOceanPlugin = { apply, inject: ["theme"] };

(window as any).__ModuleLoader__.load({
  id: PACKAGE_NAME,
  factory: (require: any) => {
    const module = { exports: {} as any };
    const exports = module.exports;
    exports.apply = apply;
    exports.inject = ["theme"];
    return module.exports;
  },
});
