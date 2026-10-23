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
    if (view === "summary") return "让 ASCII 鱼群游过工作台，隔着玻璃看海。";
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
        h("span", null, h("strong", null, label), h("small", null, help)),
        h("input", { type: "checkbox", role: "switch", "aria-label": label, checked: state[key], disabled: off, onChange: (e: any) => update(key, e.target.checked) }));
    const options = [
      ["dynamic", "动态", "巡游"], ["static", "静态", "定格"], ["off", "关闭", "收海"],
    ];
    const currents = ["轻浪", "顺流", "飞鱼"];
    const modeHelp = off ? "海洋已关闭，鱼群和海景设置会保留。" : state.reduced
      ? "系统已开启减少动态效果，鱼群暂时定格。" : state.mode === "static"
      ? "留住这一刻的海景。鱼群数量和清晰度仍可调整。" : "鱼群自在巡游，离开窗口时会自动休息。";
    return h("div", { className: "dsh-ocean-settings", "data-ocean-controls": true },
      h("div", { className: "dsh-ocean-heading" },
        h("span", { className: "dsh-ocean-ascii", "aria-hidden": true }, "><>  ~  ><(((o>") ,
        h("span", null, "留一片海，陪你工作")),
      h("fieldset", { className: "dsh-ocean-mode-group" },
        h("legend", null, "背景模式"),
        h("div", { className: "dsh-ocean-modes" }, ...options.map(([value, label, description]) =>
          h("label", { key: value, className: "dsh-ocean-mode" },
            h("input", { type: "radio", name: "dsh-ocean-mode", value,
              checked: state.mode === value, onChange: () => ocean.setMode(value) }),
            h("strong", null, label), h("span", { className: "dsh-ocean-mode-detail" }, description))))),
      h("p", { className: "dsh-ocean-preview-note", role: "status" }, modeHelp),
      h("div", { className: "dsh-ocean-grid" },
        h("fieldset", { className: "dsh-ocean-group" }, h("legend", null, "鱼群 · 海里的邻居"),
          slider("sharkCount", "鲨鱼数量", 0, 12, 1, `${state.sharkCount} 条`, "六种鲨鱼搭配登场，0 条时全部隐藏。"),
          h("div", { className: "dsh-ocean-control dsh-ocean-fish" },
            h("div", { className: "dsh-ocean-label" },
              h("span", { id: "dsh-ocean-fish-label" }, "小鱼数量"),
              h("label", { className: "dsh-ocean-auto" },
                h("input", { type: "checkbox", "aria-label": "小鱼数量随窗口自动调整", checked: state.fishCount === null, disabled: off,
                  onChange: (e: any) => update("fishCount", e.target.checked ? null : Math.max(85, Math.min(340, Math.round(window.innerWidth * window.innerHeight / 4400)))) }), "自动")),
            state.fishCount === null
              ? h("div", { className: "dsh-ocean-auto-info" },
                  h("span", { className: "dsh-ocean-school", "aria-hidden": true }, "><>  ><>  ><>") ,
                  h("small", null, "随窗口大小安排，85–340 条。"))
              : h("div", null,
                  h("div", { className: "dsh-ocean-manual-value" }, h("output", { htmlFor: "dsh-ocean-fishCount" }, `${state.fishCount} 条`)),
                  h("input", { id: "dsh-ocean-fishCount", type: "range", min: 0, max: 600, step: 1, value: state.fishCount, disabled: off,
                    "aria-labelledby": "dsh-ocean-fish-label", "aria-valuetext": `${state.fishCount} 条`, onChange: (e: any) => update("fishCount", Number(e.target.value)) }))),
          slider("speed", "游动速度", 0.25, 2, 0.25, `${state.speed}×`, state.mode === "static" || state.reduced ? "已保存速度，恢复动态后生效。" : "慢慢游，或追着浪跑。1× 为原速。")),
        h("fieldset", { className: "dsh-ocean-group" }, h("legend", null, "海景 · 光影与节奏"),
          slider("clarity", "海洋清晰度", 10, 90, 1, `${state.clarity}%`, "低一些衬托文字，高一些看清鱼群。"),
          h("fieldset", { className: "dsh-ocean-control dsh-ocean-fps", "aria-describedby": "dsh-ocean-fps-help", disabled: off },
            h("legend", null, "帧率上限"),
            !FPS_OPTIONS.includes(state.maxFps) && h("p", { className: "dsh-ocean-legacy" }, `当前沿用 ${state.maxFps} fps，可选择下方档位切换。`),
            h("div", { className: "dsh-ocean-fps-options" }, ...FPS_OPTIONS.map((fps, i) => h("label", { key: fps, className: "dsh-ocean-fps-option" },
              h("input", { type: "radio", name: "dsh-ocean-fps", value: fps, checked: state.maxFps === fps, onChange: () => update("maxFps", fps) }),
              h("span", null, h("strong", null, `${fps}`, h("span", { className: "dsh-ocean-unit" }, " fps")),
                h("small", null, currents[i], fps === 60 ? " · 默认" : ""))))),
            h("small", { id: "dsh-ocean-fps-help" }, state.mode === "static" || state.reduced
              ? "已保存帧率上限，恢复动态后生效。" : state.maxFps > 60
              ? "高刷需屏幕支持，实际帧率受设备负载影响。"
              : "只调流畅度，不改变鱼的游动速度。")),
          checkbox("glass", "侧栏玻璃", "把侧栏变成透着海景的玻璃舷窗。"),
          checkbox("interactive", "鼠标互动", state.mode === "static" || state.reduced ? "恢复动态后，可拨动鱼群、点起水花。" : "指针靠近，小鱼避让；点击空白处泛起水花。"))),
      h("div", { className: "dsh-ocean-footer" },
        h("p", { role: "status", "aria-live": "polite", className: "dsh-ocean-status" },
          !state.saved ? "设置已生效，但本次无法保存；下次打开可能恢复之前的设置。" :
          state.fallback ? "设置已保存 · 正在使用兼容绘制" : "更改会自动保存在此设备"),
        h("button", { type: "button", title: "恢复动态模式及所有默认参数", onClick: () => ocean.resetPreferences() }, "恢复默认海景")));
  };
}
