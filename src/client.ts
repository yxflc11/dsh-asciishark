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
import { isInteractiveTarget } from "./ascii-sharks/engine";
import { readPreferences, savePreferences, settingsComponent, normalizePreferences, DEFAULT_PREFERENCES, PREFERENCES_KEY, type OceanMode, type OceanPreferences } from "./preferences";
import { GlassCapture } from "./glass-capture";
import { INK_FILTER } from "./ocean-colors";
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

const sharksFor = (count: number): SharkSpec[] =>
  Array.from({ length: count }, (_, index) => ({ ...SHARKS[index % SHARKS.length] }));

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


const CSS = `
/* Settings-only surfaces: ocean, conversation and sidebar materials stay unchanged. */
.dsh-ocean-settings {
  max-width: 800px; color: inherit; font: inherit; font-size: 14px; container-type: inline-size; color-scheme: light;
  --ocean-control-bg: rgba(255,255,255,.96); --ocean-line: #c6d0d7;
  --ocean-ink: #254a61; --ocean-muted: #4e6170; --ocean-accent: #246789;
  --ocean-selected: #e7f2f7; --ocean-hover: #f0f6f9;
}
body[data-ds-dark-theme] .dsh-ocean-settings {
  color-scheme: dark; --ocean-control-bg: rgba(25,29,36,.96); --ocean-line: #586773;
  --ocean-ink: #c3e4f3; --ocean-muted: #b5c1cd; --ocean-accent: #83ccea;
  --ocean-selected: #223f50; --ocean-hover: #263540;
}
.dsh-ocean-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 18px; color: var(--ocean-ink); }
.dsh-ocean-ascii { font: 600 16px/1.5 ui-monospace, Menlo, monospace; white-space: pre; }
.dsh-ocean-settings fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.dsh-ocean-settings legend { padding: 0; margin-bottom: 10px; font-weight: 600; }
.dsh-ocean-modes { display: flex; padding: 4px; gap: 4px; border: 1px solid var(--ocean-line); border-radius: 10px; background: var(--ocean-control-bg); }
.dsh-ocean-mode { position: relative; flex: 1; min-width: 0; display: flex; gap: 9px; align-items: center; justify-content: center; min-height: 44px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.dsh-ocean-mode:has(:checked) { background: var(--ocean-selected); color: var(--ocean-ink); box-shadow: inset 0 0 0 1px var(--ocean-accent); }
.dsh-ocean-settings input[type="radio"] { position: absolute; width: 1px; height: 1px; padding: 0; clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
.dsh-ocean-settings label:has(input[type="radio"]:focus-visible) { outline: 2px solid var(--ocean-accent); outline-offset: 3px; }
.dsh-ocean-mode-detail { color: var(--ocean-muted); font-size: 13px; }
.dsh-ocean-settings input { accent-color: var(--ocean-accent); flex: none; margin: 0; }
.dsh-ocean-settings :is(input,button):focus-visible { outline: 2px solid var(--ocean-accent); outline-offset: 3px; }
.dsh-ocean-settings strong { font-weight: 600; }
.dsh-ocean-settings small { display: block; margin-top: 5px; font-size: 13px; line-height: 1.5; color: var(--ocean-muted); }
.dsh-ocean-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18px; }
.dsh-ocean-settings .dsh-ocean-group { padding: 20px; border: 1px solid var(--ocean-line); border-radius: 12px; background: var(--ocean-control-bg); }
.dsh-ocean-group > legend { float: left; width: 100%; margin-bottom: 20px; color: var(--ocean-ink); font-size: 15px; }
.dsh-ocean-control { clear: both; margin-bottom: 22px; }
.dsh-ocean-control:last-child { margin-bottom: 0; }
.dsh-ocean-label { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.dsh-ocean-settings output { font: 14px/1.5 ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--ocean-ink); }
.dsh-ocean-settings input[type="range"] { display: block; width: 100%; min-height: 28px; margin: 6px 0 0; cursor: pointer; }
.dsh-ocean-settings input:disabled { cursor: default; opacity: .45; }
.dsh-ocean-settings label:has(input:disabled) { cursor: default; }
.dsh-ocean-auto { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; min-height: 24px; font-size: 13px; }
.dsh-ocean-fish { min-height: 83px; }
.dsh-ocean-auto-info { padding-top: 9px; }
.dsh-ocean-school { color: var(--ocean-ink); font: 14px/1.5 ui-monospace, Menlo, monospace; }
.dsh-ocean-manual-value { text-align: right; margin-top: 3px; }
.dsh-ocean-settings .dsh-ocean-fps { margin-bottom: 18px; }
.dsh-ocean-fps legend { float: none; width: auto; margin-bottom: 8px; font-weight: 400; }
.dsh-ocean-fps-options { display: flex; gap: 6px; }
.dsh-ocean-fps-option { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; text-align: center; gap: 7px; padding: 9px 4px; border: 1px solid var(--ocean-line); border-radius: 7px; cursor: pointer; }
.dsh-ocean-fps-option:has(:checked) { background: var(--ocean-selected); border-color: var(--ocean-accent); color: var(--ocean-ink); }
.dsh-ocean-fps-option strong { font: 600 16px/1.3 ui-monospace, Menlo, monospace; }
.dsh-ocean-unit { font: 12px/1.3 ui-monospace, Menlo, monospace; }
.dsh-ocean-fps-option small { font-size: 12px; margin-top: 3px; white-space: nowrap; }
.dsh-ocean-legacy { color: var(--ocean-muted); font-size: 13px; margin: 0 0 8px; }
.dsh-ocean-check { display: flex; align-items: center; justify-content: space-between; gap: 16px; cursor: pointer; padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--ocean-line); min-height: 44px; }
.dsh-ocean-check input { appearance: none; width: 34px; height: 20px; border: 1px solid var(--ocean-muted); border-radius: 20px; background: var(--ocean-line); position: relative; cursor: pointer; }
.dsh-ocean-check input::after { content: ""; position: absolute; width: 14px; height: 14px; top: 2px; left: 2px; border-radius: 50%; background: var(--ocean-control-bg); }
.dsh-ocean-check input:checked { background: var(--ocean-accent); border-color: var(--ocean-accent); }
.dsh-ocean-check input:checked::after { transform: translateX(14px); }
.dsh-ocean-preview-note { color: var(--ocean-muted); font-size: 13px; margin: 10px 0 18px; line-height: 1.6; }
.dsh-ocean-footer { display: flex; gap: 20px; align-items: center; justify-content: space-between; padding-top: 12px; }
.dsh-ocean-status { color: var(--ocean-muted); margin: 0; font-size: 13px; line-height: 1.6; }
.dsh-ocean-footer button { flex: none; border: 0; border-radius: 6px; min-height: 44px; padding: 8px 10px; background: var(--ocean-control-bg); color: var(--ocean-ink); cursor: pointer; font: inherit; text-decoration: underline; text-underline-offset: 4px; }
@media (hover: hover) { .dsh-ocean-mode:hover,.dsh-ocean-fps-option:hover,.dsh-ocean-footer button:hover { background: var(--ocean-hover); } }
@media (forced-colors: active) { .dsh-ocean-mode:has(:checked),.dsh-ocean-fps-option:has(:checked) { outline: 2px solid Highlight; outline-offset: -3px; } }
@container (max-width: 640px) { .dsh-ocean-grid { grid-template-columns: 1fr; } }
@container (max-width: 360px) { .dsh-ocean-settings .dsh-ocean-group { padding: 16px; } .dsh-ocean-mode { gap: 5px; padding: 4px; } .dsh-ocean-mode-detail { display: none; } .dsh-ocean-footer { gap: 8px; align-items: flex-start; flex-direction: column; } .dsh-ocean-settings small { font-size: 14px; } .dsh-ocean-fps-option small { font-size: 12px; } }

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
  setMode(mode: OceanMode): void;
  setPreferences(patch: Partial<OceanPreferences>): void;
  resetPreferences(): void;
  getSnapshot(): any;
  getMetrics(): Promise<any>;
  subscribe(listener: () => void): () => void;
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
  let preferences = readPreferences();
  let saved = true;
  let fallback = false;
  let wrap: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let veil: HTMLDivElement | null = null;
  let engine: OceanEngine | null = null;
  let worker: Worker | null = null;
  let workerUrl: string | null = null;
  let workerFrames = 0;
  let metricId = 0;
  const metricRequests = new Map<string, { resolve: (value: any) => void; timer: ReturnType<typeof setTimeout> }>();
  let targets: Targets | null = null;
  let focused = document.hasFocus();
  let disposed = false;
  let playing: boolean | null = null;
  const motion = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const shouldRun = () => preferences.mode === "dynamic" && !motion?.matches && !document.hidden && focused;
  const listeners = new Set<() => void>();
  const snapshotState = () => ({ ...preferences, reduced: motion?.matches === true, saved, fallback });
  let state = snapshotState();
  const notify = () => { state = snapshotState(); for (const listener of listeners) listener(); };
  const savedProps = new Map<HTMLElement, Map<string, { value: string; priority: string }>>();
  const glassEls = new Set<HTMLElement>();
  let savedFrame: { el: HTMLElement; value: string; priority: string } | null = null;
  let pane: HTMLDivElement | null = null;
  let capture: HTMLCanvasElement | HTMLImageElement | null = null;
  let glassCapture: GlassCapture | null = null;
  let glassCaptureFailed = false;
  let captureCtx: CanvasRenderingContext2D | null = null;
  let filterSvg: SVGSVGElement | null = null;
  let mapUrl = "";
  let mapSize = { width: 0, height: 0 };
  let geometry = "";
  let lastCapturedFrame = -1;
  let captureDirty = true;
  let captureRevision = 0;
  let requestId = 0;
  let inFlight: { id: number; revision: number } | null = null;
  let captureTimer = 0;
  const invalidateCapture = () => { captureRevision++; captureDirty = true; lastCapturedFrame = -1; };
  const sidebarObserver = new ResizeObserver(() => {
    if (disposed || preferences.mode === "off") return;
    ensurePane();
    requestSnapshot();
  });

  const scope = (el: HTMLElement, tokens: Record<string, string>) => {
    let previous = savedProps.get(el);
    if (!previous) { previous = new Map(); savedProps.set(el, previous); }
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
  const applyScopes = (next: Targets) => {
    if (preferences.mode === "off") return;
    const values = Object.fromEntries(Object.entries(CONVERSATION_TOKENS).map(([name, modes]) => [name, modes[scheme]]));
    const alpha = (100 - preferences.clarity) / 100;
    const quiet = quietPage() && !document.querySelector(".dsh-ocean-settings");
    values["--dsw-alias-bg-base"] = quiet
      ? (scheme === "light" ? "rgb(250, 251, 253)" : "rgb(15, 19, 25)")
      : (scheme === "light" ? `rgba(255, 255, 255, ${alpha})` : `rgba(9, 12, 17, ${alpha})`);
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
    glassCapture?.destroy(); glassCapture = null;
    sidebarObserver.disconnect();
    pane?.remove(); filterSvg?.remove();
    pane = null; capture = null; captureCtx = null; filterSvg = null;
    mapUrl = ""; mapSize = { width: 0, height: 0 }; geometry = "";
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
      pane = document.createElement("div"); pane.className = PANE_CLASS;
      pane.setAttribute("aria-hidden", "true");
      capture = document.createElement("canvas");
      if (worker && !glassCaptureFailed && GlassCapture.supported()) {
        const image = document.createElement("img");
        try {
          glassCapture = new GlassCapture(image, () => {
            glassCaptureFailed = true;
            removePane(); ensurePane(); requestSnapshot();
          });
          capture = image;
        } catch { glassCaptureFailed = true; }
      }
      capture.className = CAPTURE_CLASS;
      const tint = document.createElement("div"); tint.className = TINT_CLASS;
      pane.append(capture, tint); side.prepend(pane);
      filterSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      filterSvg.setAttribute("id", FILTER_SVG_ID);
      filterSvg.setAttribute("aria-hidden", "true");
      filterSvg.setAttribute("style", "position:absolute;width:0;height:0;left:-9999px");
      document.body.append(filterSvg);
      sidebarObserver.observe(side);
    }
    const rect = side.getBoundingClientRect();
    const key = [rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight, window.devicePixelRatio].join(":");
    if (key !== geometry) { geometry = key; invalidateCapture(); }
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
  const post = (message: any) => worker?.postMessage(message);
  const stopWorker = () => {
    for (const request of metricRequests.values()) { clearTimeout(request.timer); request.resolve(null); }
    metricRequests.clear();
    if (worker) {
      worker.onmessage = null; worker.onerror = null;
      try { worker.postMessage({ type: "dispose" }); } catch { /* already failed */ }
      worker.terminate(); worker = null;
    }
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = null; workerFrames = 0; inFlight = null; playing = null;
  };
  const restartCanvasForFallback = () => {
    if (!wrap || !canvas) return;
    const next = document.createElement("canvas"); next.id = CANVAS_ID; next.setAttribute("aria-hidden", "true");
    canvas.replaceWith(next); canvas = next; invalidateCapture();
  };
  const startLocalEngine = () => {
    if (!canvas) return;
    fallback = true; notify();
    engine = new OceanEngine(canvas, sharksFor(preferences.sharkCount), {
      fishCount: preferences.fishCount, speed: preferences.speed, interactive: preferences.interactive,
      maxFps: preferences.maxFps, maxDpr: 1.5, paused: !shouldRun(), initialStatic: preferences.mode === "static",
      onFrame: () => {
        if (!shouldRun()) { invalidateCapture(); requestSnapshot(); }
      },
    });
    syncPlayback();
  };
  const startWorker = (): boolean => {
    if (!canvas) return false;
    try {
      const off = canvas.transferControlToOffscreen();
      workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      const next = new Worker(workerUrl); worker = next;
      next.onmessage = (event: MessageEvent) => {
        const data = event.data as Record<string, any>;
        if (data?.type === "metrics") {
          if (worker !== next) return;
          const request = metricRequests.get(data.requestId);
          if (request) { clearTimeout(request.timer); metricRequests.delete(data.requestId); request.resolve({ ...data, glassBackend: glassCapture ? "image" : "canvas", glassBusy: glassCapture?.busy ?? false }); }
          return;
        }
        if (data?.type !== "snapshot") return;
        if (worker !== next || !inFlight || data.requestId !== inFlight.id) { data.bitmap?.close(); return; }
        const revision = inFlight.revision; inFlight = null;
        workerFrames = data.frames;
        if (revision === captureRevision && preferences.mode !== "off" && preferences.glass && !document.hidden) {
          if (data.bitmap) drawSnapshot(data.bitmap, data.frames, revision);
          else if (data.skipped && data.reason === "unchanged") captureDirty = false;
        } else data.bitmap?.close();
        // Coalesce changes during transport; never queue a second request.
        if (captureDirty && revision !== captureRevision) requestSnapshot();
      };
      next.onerror = () => {
        if (worker !== next) return;
        stopWorker(); restartCanvasForFallback(); removePane(); startLocalEngine(); ensurePane(); requestSnapshot();
      };
      next.postMessage({ type: "init", canvas: off, ...workerSize(), dpr: workerDpr(), maxFps: preferences.maxFps, sharks: sharksFor(preferences.sharkCount),
        fishCount: preferences.fishCount, speed: preferences.speed, interactive: preferences.interactive,
        fontFamily: getComputedStyle(canvas).fontFamily, reducedMotion: motion?.matches === true,
        paused: !shouldRun(), initialStatic: preferences.mode === "static" }, [off]);
      fallback = false; notify(); syncPlayback();
      return true;
    } catch {
      stopWorker(); restartCanvasForFallback(); return false;
    }
  };

  const captureContext = (cw: number, ch: number) => {
    if (!(capture instanceof HTMLCanvasElement)) return null;
    if (capture.width !== cw || capture.height !== ch) {
      capture.width = cw; capture.height = ch; captureCtx = null;
    }
    if (!captureCtx || captureCtx.canvas !== capture) captureCtx = capture.getContext("2d");
    return captureCtx;
  };
  const drawSnapshot = (bitmap: ImageBitmap, frames: number, revision: number) => {
    if (glassCapture && capture && pane?.isConnected && targets) {
      const current = glassCapture;
      current.render(bitmap, scheme, bitmap.width, bitmap.height,
        () => current === glassCapture && revision === captureRevision && preferences.mode !== "off" && preferences.glass && !document.hidden,
        accepted => {
          if (current !== glassCapture || disposed) return;
          if (accepted) { lastCapturedFrame = frames; captureDirty = false; }
          if (captureDirty) requestSnapshot();
        });
      return; // The encoder worker owns and closes the transferred bitmap.
    }
    try {
      if (!capture || !pane?.isConnected || !targets) return;
      const rect = targets.sidebar.getBoundingClientRect();
      const cw = Math.max(16, Math.round(rect.width / 2)), ch = Math.max(16, Math.round(rect.height / 2));
      const context = captureContext(cw, ch);
      if (!context) return;
      context.save(); context.filter = scheme === "light" ? INK_FILTER : "none";
      context.drawImage(bitmap, 0, 0, cw, ch); context.restore();
      lastCapturedFrame = frames; captureDirty = false;
    } finally { bitmap.close(); }
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
    context.save(); context.filter = scheme === "light" ? INK_FILTER : "none";
    context.drawImage(canvas, (rect.left - sourceRect.left) * rx, (rect.top - sourceRect.top) * ry,
      rect.width * rx, rect.height * ry, 0, 0, cw, ch);
    context.restore(); lastCapturedFrame = frames; captureDirty = false;
  };
  const requestSnapshot = () => {
    if (disposed || preferences.mode === "off" || !preferences.glass || !capture || !pane?.isConnected || document.hidden || !targets) return;
    if (!shouldRun() && !captureDirty) return;
    if (worker) {
      if (inFlight || glassCapture?.busy) return;
      const rect = targets.sidebar.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      inFlight = { id: ++requestId, revision: captureRevision };
      post({ type: "snapshot", requestId, force: captureDirty, rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        cw: Math.max(16, Math.round(rect.width / 2)), ch: Math.max(16, Math.round(rect.height / 2)), since: lastCapturedFrame });
    } else captureBackdropLocal();
  };
  const syncPlayback = (refresh = true) => {
    const running = shouldRun();
    if (running !== playing) {
      playing = running;
      post({ type: running ? "resume" : "pause" });
      if (running) engine?.resume(); else engine?.pause();
    }
    if (running && preferences.glass && !captureTimer) captureTimer = window.setInterval(requestSnapshot, 120);
    else if ((!running || !preferences.glass) && captureTimer) { clearInterval(captureTimer); captureTimer = 0; }
    // One final snapshot on pause; no periodic messages in a static/hidden tab.
    if (refresh) { invalidateCapture(); requestSnapshot(); }
  };

  let lastPointerPost = 0;
  const onPointerMove = (event: PointerEvent) => {
    if (!shouldRun() || !preferences.interactive) return;
    const now = performance.now(); if (now - lastPointerPost < 50) return;
    lastPointerPost = now;
    post({ type: "pointer", x: event.clientX, y: event.clientY, active: event.pointerType !== "touch" && !isInteractiveTarget(event) });
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!shouldRun() || !preferences.interactive || (event.button !== undefined && event.button !== 0) || isInteractiveTarget(event)) return;
    post({ type: "splash", x: event.clientX, y: event.clientY });
  };
  const onPointerLeave = () => post({ type: "pointer", x: 0, y: 0, active: false });
  const onWindowBlur = () => { focused = false; onPointerLeave(); syncPlayback(); };
  const onWindowFocus = () => { focused = true; syncPlayback(); };
  const onVisibility = () => { focused = document.hasFocus(); syncPlayback(); };
  const onWindowResize = () => {
    post({ type: "resize", ...workerSize(), dpr: workerDpr() });
    invalidateCapture(); ensurePane(); requestSnapshot();
  };
  const onMotionPreference = () => {
    post({ type: "reduce", reducedMotion: motion?.matches === true }); syncPlayback(); notify();
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("blur", onWindowBlur); window.addEventListener("focus", onWindowFocus);
  window.addEventListener("resize", onWindowResize);
  document.addEventListener("visibilitychange", onVisibility);
  motion?.addEventListener("change", onMotionPreference);

  const mountSurface = () => {
    if (wrap?.isConnected) return;
    engine?.destroy(); engine = null; stopWorker(); invalidateCapture();
    wrap = document.createElement("div"); wrap.id = SURFACE_ID; wrap.dataset.scheme = scheme;
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.display = preferences.mode === "off" ? "none" : "";
    canvas = document.createElement("canvas"); canvas.id = CANVAS_ID; canvas.setAttribute("aria-hidden", "true");
    veil = document.createElement("div"); veil.id = VEIL_ID; veil.style.background = VEIL[scheme];
    wrap.append(canvas, veil); (document.body ?? document.documentElement).prepend(wrap);
    if (!startWorker()) {
      // A remounted surface may still have an image-backed glass pane. The
      // local renderer needs its original Canvas capture path instead.
      removePane(); startLocalEngine();
    }
  };
  const mount = (): boolean => {
    if (disposed || !document.body) return false;
    const next = findTargets(); if (!next) return false;
    if (targets?.conversation !== next.conversation || targets?.sidebar !== next.sidebar || targets?.frame !== next.frame) {
      removePane(); restoreScopes(); targets = next;
    }
    mountSurface(); applyScopes(next); ensurePane(); requestSnapshot();
    return true;
  };
  const setScheme = (next: Scheme) => {
    if (next === scheme) return;
    scheme = next;
    if (wrap) wrap.dataset.scheme = scheme;
    if (veil) veil.style.background = VEIL[scheme];
    if (targets) { applyScopes(targets); rebuildFilter(); invalidateCapture(); requestSnapshot(); }
  };
  const ensure = () => { setScheme(currentScheme(ctx)); return mount(); };
  const applyPreferences = (previous: OceanPreferences) => {
    if (preferences.glass !== previous.glass) { removePane(); restoreScopes(); }
    if (wrap) wrap.style.display = preferences.mode === "off" ? "none" : "";
    if (preferences.mode === "off") { removePane(); restoreScopes(); }
    else if (targets) { applyScopes(targets); ensurePane(); }
    // Pause first when a storage update changes mode and population together.
    syncPlayback(false);
    // Reconfigure the running world; keep its canvas, time and pause state.
    const config: { fishCount?: number | null; sharks?: SharkSpec[]; speed?: number; interactive?: boolean } = {};
    if (preferences.fishCount !== previous.fishCount) config.fishCount = preferences.fishCount;
    if (preferences.sharkCount !== previous.sharkCount) config.sharks = sharksFor(preferences.sharkCount);
    if (preferences.speed !== previous.speed) config.speed = preferences.speed;
    if (preferences.interactive !== previous.interactive) config.interactive = preferences.interactive;
    if (Object.keys(config).length) { post({ type: "configure", ...config }); engine?.configure(config); }
    if (preferences.maxFps !== previous.maxFps) { post({ type: "fps", fps: preferences.maxFps }); engine?.setMaxFps(preferences.maxFps); }
    if (!preferences.interactive) onPointerLeave();
    invalidateCapture(); requestSnapshot(); notify();
  };
  const setPreferences = (patch: Partial<OceanPreferences>) => {
    const previous = preferences;
    preferences = normalizePreferences({ ...preferences, ...patch });
    saved = savePreferences(preferences); applyPreferences(previous);
  };
  const setMode = (mode: OceanMode) => {
    if (["dynamic", "static", "off"].includes(mode)) setPreferences({ mode });
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PREFERENCES_KEY && event.key !== null) return;
    const previous = preferences;
    preferences = readPreferences(); saved = true; applyPreferences(previous);
  };
  window.addEventListener("storage", onStorage);
  const offPanel = ctx.layout?.panelInfo?.subscribe(() => { if (targets) applyScopes(targets); });

  return {
    get mounted() { return wrap?.isConnected === true; },
    get frames() { return worker ? workerFrames : (engine?.frames ?? 0); },
    getSnapshot: () => state,
    // Read the renderer clock directly; glass snapshots can carry old counts.
    getMetrics() {
      if (!worker) return Promise.resolve(engine?.getMetrics() ?? null);
      return new Promise(resolve => {
        const id = `metrics-${++metricId}`;
        const timer = setTimeout(() => { metricRequests.delete(id); resolve(null); }, 2000);
        metricRequests.set(id, { resolve, timer });
        try { post({ type: "metrics", requestId: id }); }
        catch { clearTimeout(timer); metricRequests.delete(id); resolve(null); }
      });
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    setMode, setPreferences,
    resetPreferences() { setPreferences({ ...DEFAULT_PREFERENCES }); },
    mount, ensure, setScheme,
    toggle() { const enabled = preferences.mode === "off"; setMode(enabled ? "dynamic" : "off"); return enabled; },
    destroy() {
      disposed = true; clearInterval(captureTimer); captureTimer = 0;
      window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onWindowBlur); window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("resize", onWindowResize); window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility); motion?.removeEventListener("change", onMotionPreference);
      offPanel?.(); engine?.destroy(); engine = null; stopWorker();
      wrap?.remove(); wrap = null; canvas = null; veil = null;
      removePane(); restoreScopes(); targets = null; listeners.clear();
    },
  };
}

let hostReact: any;

/** Client plugin body: mount the ocean and the liquid-glass sidebar. */
function apply(ctx: any) {
  ctx.effect(() => {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);

    const ocean = createOcean(ctx);
    ocean.mount();
    const offSettings = ctx.slots?.inject("plugins.item", () => ctx.slots.register({
      name: "plugins.item", id: "ascii-ocean", order: 50, label: "海洋背景",
    }, settingsComponent(hostReact, ocean)));

    const timer = setInterval(() => ocean.ensure(), 700);
    const offTheme = ctx.on("theme/change", () => ocean.setScheme(currentScheme(ctx)));

    (window as any).__dshAsciiOcean = ocean;

    return () => {
      delete (window as any).__dshAsciiOcean;
      clearInterval(timer);
      offTheme?.();
      offSettings?.();
      ocean.destroy();
      style.remove();
    };
  }, "ascii-ocean: ocean + liquid glass sidebar");
}

(globalThis as any).__dshAsciiOceanPlugin = { apply, inject: ["theme", "slots", "layout"] };

(window as any).__ModuleLoader__.load({
  id: PACKAGE_NAME,
  factory: (require: any) => {
    const module = { exports: {} as any };
    const exports = module.exports;
    hostReact = require("react");
    exports.apply = apply;
    exports.inject = ["theme", "slots", "layout"];
    return module.exports;
  },
});
