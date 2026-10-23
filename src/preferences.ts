export type OceanMode = "dynamic" | "static" | "off";
export interface OceanPreferences { mode: OceanMode; readable: boolean }
export const PREFERENCES_KEY = "dsh.ascii-ocean.preferences.v1";
export const DEFAULT_PREFERENCES: OceanPreferences = { mode: "dynamic", readable: true };

export function parsePreferences(value: string | null): OceanPreferences {
  try {
    const data = JSON.parse(value ?? "null");
    return {
      mode: ["dynamic", "static", "off"].includes(data?.mode) ? data.mode : "dynamic",
      readable: typeof data?.readable === "boolean" ? data.readable : true,
    };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

export function readPreferences(): OceanPreferences {
  try { return parsePreferences(localStorage.getItem(PREFERENCES_KEY)); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}

export function savePreferences(value: OceanPreferences): boolean {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** Uses the host's React instance, so this tiny form adds no second renderer. */
export function settingsComponent(React: any, ocean: any) {
  return function OceanSettings({ view }: { view: string }) {
    const state = React.useSyncExternalStore(ocean.subscribe, ocean.getSnapshot);
    const h = React.createElement;
    if (view === "summary") return "海洋动画与玻璃侧栏，支持静态画面和阅读底色。";
    const options = [
      ["dynamic", "动态", "保留流动的海洋与玻璃效果"],
      ["static", "静态", "冻结当前画面，保留海洋与玻璃"],
      ["off", "关闭", "恢复 DSH 原有背景"],
    ];
    return h("div", { className: "dsh-ocean-settings", "data-ocean-controls": true },
      h("fieldset", null,
        h("legend", null, "背景模式"),
        h("div", { className: "dsh-ocean-modes" }, ...options.map(([value, label, description]) =>
          h("label", { key: value, className: "dsh-ocean-mode" },
            h("input", { type: "radio", name: "dsh-ocean-mode", value,
              checked: state.mode === value, onChange: () => ocean.setMode(value) }),
            h("span", null, h("strong", null, label), h("small", null, description)))))),
      h("label", { className: "dsh-ocean-reading" },
        h("input", { type: "checkbox", checked: state.readable,
          disabled: state.mode === "off", onChange: (e: any) => ocean.setReadable(e.target.checked) }),
        h("span", null, "阅读底色", h("small", null, "减轻文字后方的动态干扰；设置页使用稳定底色。"))),
      h("p", { role: "status", "aria-live": "polite", className: "dsh-ocean-status" },
        !state.saved ? "设置已生效，但本次无法保存；下次打开可能恢复之前的设置。" :
        state.mode === "off" ? "背景效果已关闭。选择动态或静态可重新开启。" :
        state.reduced ? "已遵循系统的减少动态效果设置，显示静态画面。" :
        state.fallback ? "正在使用兼容绘制，海洋与玻璃效果保持开启。" :
        "选择自动保存在此客户端。点击按钮、链接和输入框不会触发水花。"));
  };
}
