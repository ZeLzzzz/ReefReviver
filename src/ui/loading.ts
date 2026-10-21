import { t, type Lang } from "../i18n/i18n";
import { h } from "./screens";

export interface LoadingView {
  element: HTMLElement;
  /** Shows how far the loading is (0 to 1). Only touches the DOM for what changed. */
  update(fraction: number): void;
}

/** The screen shown while the game's files load (REQ-009 AC-2): a bar and a percentage, never colour alone. */
export function createLoadingScreen(lang: Lang): LoadingView {
  const label = t(lang, "loading.title");
  const text = h("p", { class: "loading-text" });
  const fill = h("div", { class: "loading-fill" });
  const bar = h(
    "div",
    { class: "loading-bar", role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100" },
    fill,
  );
  const element = h(
    "main",
    { class: "screen loading-screen" },
    h("h1", { class: "game-name" }, t(lang, "game.name")),
    bar,
    text,
  );
  let shown = -1;
  const update = (fraction: number) => {
    const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
    if (percent === shown) return;
    shown = percent;
    bar.setAttribute("aria-valuenow", String(percent));
    fill.style.width = `${percent}%`;
    text.textContent = `${label} ${percent}%`;
  };
  update(0);
  return { element, update };
}
