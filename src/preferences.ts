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
    maxFps: [15, 30, 45, 60].includes(data?.maxFps) ? data.maxFps : 60,
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
    if (view === "summary") return "调整鱼的数量、帧率、游动速度、海洋清晰度与玻璃效果。";
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
      ["dynamic", "动态", "海洋持续游动"], ["static", "静态", "冻结当前海洋"], ["off", "关闭", "恢复 DSH 原有背景"],
    ];
    return h("div", { className: "dsh-ocean-settings", "data-ocean-controls": true },
      h("fieldset", { className: "dsh-ocean-mode-group" },
        h("legend", null, "背景模式"),
        h("div", { className: "dsh-ocean-modes" }, ...options.map(([value, label, description]) =>
          h("label", { key: value, className: "dsh-ocean-mode" },
            h("input", { type: "radio", name: "dsh-ocean-mode", value,
              checked: state.mode === value, onChange: () => ocean.setMode(value) }),
            h("span", null, h("strong", null, label), h("small", null, description)))))),
      h("p", { className: "dsh-ocean-preview-note" }, "调整会立即应用到周围的海洋。设置自动保存在此客户端。"),
      h("div", { className: "dsh-ocean-grid" },
        h("fieldset", { className: "dsh-ocean-group" }, h("legend", null, "海洋生物"),
          slider("sharkCount", "大鱼数量", 0, 12, 1, `${state.sharkCount} 条`, "六种鲨鱼循环加入；0 表示隐藏所有大鱼。"),
          h("label", { className: "dsh-ocean-auto" },
            h("input", { type: "checkbox", checked: state.fishCount === null, disabled: off,
              onChange: (e: any) => update("fishCount", e.target.checked ? null : Math.max(85, Math.min(340, Math.round(window.innerWidth * window.innerHeight / 4400)))) }),
            "小鱼数量随窗口自动调整"),
          slider("fishCount", "小鱼数量", 0, 600, 1, state.fishCount === null ? "自动 · 85–340 条" : `${state.fishCount} 条`,
            "取消自动后可手动调节；数量较多时会增加绘制负担。", off || state.fishCount === null),
          slider("speed", "游动速度", 0.25, 2, 0.25, `${state.speed}×`, "1× 为原速；改变帧率不会改变游动速度。")),
        h("fieldset", { className: "dsh-ocean-group" }, h("legend", null, "画面与互动"),
          slider("clarity", "海洋清晰度", 10, 90, 1, `${state.clarity}%`, "越高越清楚；50% 为原来的清透效果。"),
          h("div", { className: "dsh-ocean-control" },
            h("label", { htmlFor: "dsh-ocean-maxFps" }, "动画帧率"),
            h("select", { id: "dsh-ocean-maxFps", value: state.maxFps, disabled: off, onChange: (e: any) => update("maxFps", Number(e.target.value)) },
              ...[15, 30, 45, 60].map(fps => h("option", { key: fps, value: fps }, `${fps} fps${fps === 60 ? " · 默认" : ""}`))),
            h("small", null, "帧率是绘制上限；静态模式和系统减少动态效果会暂停动画。")),
          checkbox("glass", "侧栏玻璃", "保留折射与模糊；关闭后恢复原侧栏底色。"),
          checkbox("interactive", "鼠标互动", "鱼群响应指针，点击空白处产生水花。"))),
      h("div", { className: "dsh-ocean-footer" },
        h("p", { role: "status", "aria-live": "polite", className: "dsh-ocean-status" },
          !state.saved ? "设置已生效，但本次无法保存；下次打开可能恢复之前的设置。" :
          off ? "背景效果已关闭。重新开启后会使用保留的参数。" :
          state.reduced ? "已遵循系统的减少动态效果设置，显示静态画面。" :
          state.mode === "static" ? "当前为静态画面；调整数量仍会更新画面，切回动态后按所选速度与帧率播放。" :
          state.fallback ? "正在使用兼容绘制，所选参数保持生效。" : "已自动保存。控件操作不会触发水花。"),
        h("button", { type: "button", onClick: () => ocean.resetPreferences() }, "恢复默认")));
  };
}
