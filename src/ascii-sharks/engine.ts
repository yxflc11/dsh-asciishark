import { AsciiRenderer } from "./renderer";
import { World, type SharkSpec } from "./world";

const STEP = 1 / 60;
const MAX_STEPS = 4;
const FRAME_EPSILON = 0.5;

const INTERACTIVE_SELECTOR = [
  "a", "button", "input", "textarea", "select", "option", "label", "summary",
  '[contenteditable]:not([contenteditable="false"])', "[data-ocean-controls]",
  ...["button", "link", "textbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "tab", "menuitem", "option"]
    .map((role) => `[role="${role}"]`),
].join(",");

/** Controls keep their normal clicks, including controls inside a shadow root. */
export function isInteractiveTarget(event: Event): boolean {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of path) {
    const element = node as Element;
    if (typeof element?.matches === "function" && element.matches(INTERACTIVE_SELECTOR)) return true;
  }
  const target = event.target as Element | null;
  const element = typeof target?.closest === "function" ? target : target?.parentElement;
  return !!element?.closest?.(INTERACTIVE_SELECTOR);
}

/**
 * Wires World + AsciiRenderer to a canvas: fixed-timestep loop, resize,
 * pointer input, pausing off-screen, and prefers-reduced-motion.
 */
export class OceanEngine {
  private world: World;
  private renderer: AsciiRenderer;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private visible = true;
  private reducedMotion: MediaQueryList;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private disposed = false;
  private nextDraw = 0;
  private maxFps: number;
  private maxDpr: number;
  private initialStatic: boolean;
  private onFrame?: () => void;
  /** Rendered frames, used by the glass backdrop capture to avoid redundant work. */
  frames = 0;
  private paused = false;

  constructor(
    private canvas: HTMLCanvasElement,
    sharks?: SharkSpec[],
    options: { maxFps?: number; maxDpr?: number; paused?: boolean; initialStatic?: boolean; onFrame?: () => void } = {},
  ) {
    this.maxFps = Math.max(5, Math.min(60, options.maxFps ?? 60));
    this.maxDpr = options.maxDpr ?? 2;
    this.initialStatic = options.initialStatic === true;
    this.paused = options.paused === true || this.initialStatic;
    this.onFrame = options.onFrame;
    this.world = new World(sharks);
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
    // Canvas text can't trigger a webfont load; once the mono face is in, redraw.
    document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
      if (!this.disposed && (this.reducedMotion.matches || this.paused)) this.drawStill();
    });
    this.schedule();
  }

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

  /** Change the render-rate cap at runtime (adaptive quality). */
  setMaxFps(fps: number) {
    this.maxFps = Math.max(5, Math.min(60, fps));
    cancelAnimationFrame(this.raf);
    this.schedule();
  }

  /** Change the backing-store DPR cap at runtime (adaptive quality). */
  setMaxDpr(dpr: number) {
    this.maxDpr = Math.max(1, Math.min(2, dpr));
    this.resize();
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

  private resize() {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.resize(rect.width, rect.height, dpr);
    this.world.resize(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight);
    if (this.reducedMotion.matches || this.paused) {
      this.drawStill(this.frames === 0 && (this.reducedMotion.matches || this.initialStatic));
    }
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches) return;
    this.last = performance.now();
    this.nextDraw = this.last + 1000 / this.maxFps;
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches) return;
    if (now + FRAME_EPSILON < this.nextDraw) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const interval = 1000 / this.maxFps;
    // Keep the fractional interval instead of rounding the cap down to a
    // divisor of the display's refresh rate. Long stalls still draw only once.
    this.nextDraw += Math.max(1, Math.floor((now - this.nextDraw) / interval) + 1) * interval;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.renderer.render(this.world, dt);
    this.frames++;
    this.onFrame?.();
    if (!this.disposed && !this.paused && this.visible && !this.reducedMotion.matches) {
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  /** Settle only an initial still; resizing a paused scene never advances it. */
  private drawStill(warmup = false) {
    if (warmup && this.world.time < 4) {
      for (let i = 0; i < 240; i++) this.world.step(STEP);
    }
    this.renderer.render(this.world, STEP);
    this.frames++;
    this.onFrame?.();
  }

  private onMotionPreference = () => {
    if (this.reducedMotion.matches) {
      cancelAnimationFrame(this.raf);
      this.world.pointer.active = false;
      this.drawStill();
    } else {
      this.schedule();
    }
  };

  private toLocal(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    return { x, y, inside };
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches || isInteractiveTarget(e)) {
      this.world.pointer.active = false;
      return;
    }
    const { x, y, inside } = this.toLocal(e);
    const p = this.world.pointer;
    p.x = x;
    p.y = y;
    p.active = inside && e.pointerType !== "touch";
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.disposed || this.paused || !this.visible || this.reducedMotion.matches ||
      (e.button !== undefined && e.button !== 0) || isInteractiveTarget(e)) return;
    const { x, y, inside } = this.toLocal(e);
    if (inside) this.world.splash(x, y);
  };

  private onPointerLeave = () => {
    this.world.pointer.active = false;
  };
}
