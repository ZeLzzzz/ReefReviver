import { config } from "../config";
import type { CinematicHud } from "../game/cinematic";
import { t, type Lang } from "../i18n/i18n";
import { h } from "./screens";

export interface CinematicView {
  element: HTMLElement;
  /** Shows a cinematic's bars and narration, or hides them all (null). Only touches the DOM for what changed. */
  update(state: CinematicHud | null): void;
}

/**
 * REQ-027 AC-3, REQ-028 AC-3: what a cinematic shows over the picture. Black bars at the top and bottom that slide in, the hint
 * "Klik atau Spasi untuk melewati" in the top one, and the narration in the bottom one. The HUD's own panels and the crosshair
 * are hidden by the `cinematic` class its element gets (see style.css).
 */
export function createCinematicOverlay(lang: Lang): CinematicView {
  const hint = h("p", { class: "cine-skip" }, t(lang, "cinematic.skip"));
  const caption = h("p", { class: "cine-caption", role: "status" });
  const top = h("div", { class: "cine-bar cine-bar-top" }, hint);
  const bottom = h("div", { class: "cine-bar cine-bar-bottom" }, caption);
  const element = h("div", { class: "cine" }, top, bottom);
  element.hidden = true;
  let text = "";
  const bar = (letterbox: number) => `${(config.cinematic.letterbox * 100 * letterbox).toFixed(2)}vh`;

  return {
    element,
    update(state) {
      if (element.hidden !== !state) element.hidden = !state;
      if (!state) return;
      const height = bar(state.letterbox);
      if (top.style.height !== height) {
        top.style.height = height;
        bottom.style.height = height;
      }
      const line = state.caption ? t(lang, state.caption) : text;
      if (line !== text) {
        text = line;
        caption.textContent = line;
      }
      const opacity = state.captionOpacity.toFixed(3);
      if (caption.style.opacity !== opacity) caption.style.opacity = opacity;
    },
  };
}
