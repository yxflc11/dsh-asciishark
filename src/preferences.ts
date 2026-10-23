export type OceanMode = "dynamic" | "static" | "off";
export interface OceanPreferences {
  mode: OceanMode;
  fishCount: number | null;
  sharkCount: number;
  maxFps: number;
  speed: number;
  clarity: number;
  interactive: boolean;
  glass: boolean;
}
export const PREFERENCES_KEY = "dsh.ascii-ocean.preferences.v1";
export const FPS_OPTIONS: readonly number[] = [30, 60, 120];
// Preserve saved choices from earlier versions without crowding the menu.
const SUPPORTED_FPS = [15, 30, 45, 60, 90, 120, 144];
export const DEFAULT_PREFERENCES: Readonly<OceanPreferences> = Object.freeze({
  mode: "dynamic", fishCount: null, sharkCount: 6, maxFps: 60,
  speed: 1, clarity: 50, interactive: true, glass: true,
});

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const bounded = (value: unknown, min: number, max: number, fallback: number) =>
  finite(value) ? Math.max(min, Math.min(max, value)) : fallback;

/** Keep the existing storage key and migrate the old reading checkbox once. */
export function normalizePreferences(data: any): OceanPreferences {
  const oldClarity = data?.readable === true ? 22 : 50;
  return {
    mode: ["dynamic", "static", "off"].includes(data?.mode) ? data.mode : "dynamic",
    fishCount: finite(data?.fishCount) ? Math.round(bounded(data.fishCount, 0, 600, 0)) : null,
    sharkCount: Math.round(bounded(data?.sharkCount, 0, 12, 6)),
    maxFps: SUPPORTED_FPS.includes(data?.maxFps) ? data.maxFps : 60,
    speed: Math.round(bounded(data?.speed, 0.25, 2, 1) * 4) / 4,
    clarity: Math.round(bounded(data?.clarity, 10, 90, oldClarity)),
    interactive: typeof data?.interactive === "boolean" ? data.interactive : true,
    glass: typeof data?.glass === "boolean" ? data.glass : true,
  };
}

export function parsePreferences(value: string | null): OceanPreferences {
  try { return normalizePreferences(JSON.parse(value ?? "null")); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}

export function readPreferences(): OceanPreferences {
  try { return parsePreferences(localStorage.getItem(PREFERENCES_KEY)); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}

export function savePreferences(value: OceanPreferences): boolean {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(value))); return true; }
  catch { return false; }
}

/** Uses the host's React instance; every control edits the live ocean. */
export function settingsComponent(React: any, ocean: any) {
  return function OceanSettings({ view }: { view: string }) {
    const state = React.useSyncExternalStore(ocean.subscribe, ocean.getSnapshot);
    React.useLayoutEffect(() => {
      if (view === "summary") return;
      ocean.ensure();
      return () => queueMicrotask(() => ocean.ensure());
    }, [view]);
    const h = React.createElement;
    if (view === "summary") return "养一片 ASCII 海：调鱼群、选帧率，让鲨鱼游过玻璃舷窗。";
    const off = state.mode === "off";
    const update = (key: keyof OceanPreferences, value: any) => ocean.setPreferences({ [key]: value });
    const slider = (key: keyof OceanPreferences, label: string, min: number, max: number, step: number, text: string, help?: string, disabled = off) => {
      const id = `dsh-ocean-${key}`;
      return h("div", { className: "dsh-ocean-control", key },
        h("div", { className: "dsh-ocean-label" }, h("label", { htmlFor: id }, label), h("output", { htmlFor: id }, text)),
        h("input", { id, type: "range", min, max, step, value: state[key] ?? 240, disabled,
          "aria-valuetext": text, "aria-describedby": help ? `${id}-help` : undefined,
          onChange: (e: any) => update(key, Number(e.target.value)) }),
        help && h("small", { id: `${id}-help` }, help));
    };
    const checkbox = (key: "glass" | "interactive", label: string, help: string) =>
      h("label", { className: "dsh-ocean-check" },
        h("input", { type: "checkbox", checked: state[key], disabled: off, onChange: (e: any) => update(key, e.target.checked) }),
        h("span", null, label, h("small", null, help)));
    const options = [
      ["dynamic", "出海 · 动态", "让鱼群自在巡游"], ["static", "停泊 · 静态", "把这一刻留成海景"], ["off", "收帆 · 关闭", "回到 DSH 原有背景"],
    ];
    const currents = ["轻浪", "顺流 · 默认", "飞鱼"];
    return h("div", { className: "dsh-ocean-settings", "data-ocean-controls": true },
      h("div", { className: "dsh-ocean-heading" },
        h("span", { className: "dsh-ocean-ascii", "aria-hidden": true }, "><(((o>  ~  ><>") ,
        h("span", null, "这片海，听你的")),
      h("fieldset", { className: "dsh-ocean-mode-group" },
        h("legend", null, "背景模式"),
        h("div", { className: "dsh-ocean-modes" }, ...options.map(([value, label, description]) =>
          h("label", { key: value, className: "dsh-ocean-mode" },
            h("input", { type: "radio", name: "dsh-ocean-mode", value,
              checked: state.mode === value, onChange: () => ocean.setMode(value) }),
            h("span", null, h("strong", null, label), h("small", null, description)))))),
      h("p", { className: "dsh-ocean-preview-note" }, "拨动一点，海里就变一点。调整即时生效，并自动保存在此客户端。"),
      h("div", { className: "dsh-ocean-grid" },
        h("fieldset", { className: "dsh-ocean-group" }, h("legend", null, "鱼群 · 海里的邻居"),
          slider("sharkCount", "大鱼数量", 0, 12, 1, `${state.sharkCount} 条`, "六种鲨鱼轮流登场；调到 0，让大家暂时潜水。"),
          h("label", { className: "dsh-ocean-auto" },
            h("input", { type: "checkbox", checked: state.fishCount === null, disabled: off,
              onChange: (e: any) => update("fishCount", e.target.checked ? null : Math.max(85, Math.min(340, Math.round(window.innerWidth * window.innerHeight / 4400)))) }),
            "小鱼数量随窗口自动调整"),
          slider("fishCount", "小鱼数量", 0, 600, 1, state.fishCount === null ? "自动 · 85–340 条" : `${state.fishCount} 条`,
            "取消自动，亲自安排鱼群；鱼越多，绘制也越忙。", off || state.fishCount === null),
          slider("speed", "游动速度", 0.25, 2, 0.25, `${state.speed}×`, "慢悠悠或追着浪跑；1× 原速，与帧率独立。")),
        h("fieldset", { className: "dsh-ocean-group" }, h("legend", null, "海面 · 光影与节奏"),
          slider("clarity", "海洋清晰度", 10, 90, 1, `${state.clarity}%`, "让鱼更近一点；越高越清楚，50% 为默认。"),
          h("div", { className: "dsh-ocean-control" },
            h("label", { htmlFor: "dsh-ocean-maxFps" }, "帧率上限"),
            h("select", { id: "dsh-ocean-maxFps", value: state.maxFps, disabled: off, "aria-describedby": "dsh-ocean-fps-help", onChange: (e: any) => update("maxFps", Number(e.target.value)) },
              !FPS_OPTIONS.includes(state.maxFps) && h("option", { value: state.maxFps }, `${state.maxFps} fps · 当前旧设置`),
              ...FPS_OPTIONS.map((fps, i) => h("option", { key: fps, value: fps }, `${fps} fps · ${currents[i]}`))),
            h("small", { id: "dsh-ocean-fps-help" }, state.maxFps > 60
              ? "已选择高刷上限。更细的游动节奏需要高刷屏；实际帧率受设备负载影响。"
              : "60 fps 是默认帧率。这里设定绘制上限，实际流畅度也取决于屏幕与设备负载。")),
          checkbox("glass", "侧栏玻璃", "透过玻璃舷窗看海，保留折射与朦胧光影。"),
          checkbox("interactive", "鼠标互动", "指针带鱼群转弯，点一下空白海面，溅起水花。"))),
      h("div", { className: "dsh-ocean-footer" },
        h("p", { role: "status", "aria-live": "polite", className: "dsh-ocean-status" },
          !state.saved ? "设置已生效，但本次无法保存；下次打开可能恢复之前的设置。" :
          off ? "已收帆，鱼群配置替你留着。出海时继续。" :
          state.reduced ? "已遵循系统的减少动态效果设置，显示静态画面。" :
          state.mode === "static" ? "海景已停泊；仍可调整鱼群。切回动态，再接着游。" :
          state.fallback ? "正在使用兼容绘制，所选参数保持生效。" : "航海偏好已保存。放心调节，这里不会误触水花。"),
        h("button", { type: "button", onClick: () => ocean.resetPreferences() }, "恢复默认海景")));
  };
}
