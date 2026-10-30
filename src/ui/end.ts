import type { SessionSummary } from "../game/session";
import { t, type Lang, type StringKey } from "../i18n/i18n";
import { UN_SDG14_URL } from "../logbook/entries";
import { h } from "./screens";

export interface EndProps {
  lang: Lang;
  summary: SessionSummary;
  /** A message under the buttons, e.g. when the browser refused the cursor. */
  notice: StringKey | null;
  onReplay: () => void;
  onExplore: () => void;
}

/** Minutes and seconds, e.g. 487.6 s is "8:07"; the minutes go past 59 rather than adding hours. */
export function formatPlayTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The end screen (REQ-008 AC-2): the session in numbers, then Main lagi (AC-3) or Lanjut menjelajah (AC-5). REQ-039 AC-2,
 * AC-3: between them, what restoring a bay takes in real life, what the player can do, and SDG 14 on the UN's site.
 */
export function endScreen({ lang, summary: s, notice, onReplay, onExplore }: EndProps): HTMLElement {
  const rows: [StringKey, string][] = [
    ["end.trash", `${s.trashRemoved}/${s.trashTotal}`],
    ["end.animals", `${s.animalsFreed}/${s.animalsTotal}`],
    ["end.frames", `${s.framesPlanted}/${s.framesTotal}`],
    ["end.patches", `${s.patchesPlanted}/${s.patchesTotal}`],
    ["end.time", formatPlayTime(s.seconds)],
    ["end.score", String(s.score)],
  ];
  return h(
    "div",
    { class: "screen end-screen" },
    h(
      "section",
      { class: "panel end", role: "dialog", "aria-label": t(lang, "end.title") },
      h("h1", {}, t(lang, "end.title")),
      h("p", {}, t(lang, "end.body")),
      h("dl", { class: "end-stats" }, ...rows.map(([key, value]) => h("div", {}, h("dt", {}, t(lang, key)), h("dd", {}, value)))),
      h(
        "section",
        { class: "end-real" },
        h("h2", {}, t(lang, "end.realTitle")),
        h("p", {}, t(lang, "end.realBody")),
        h("ul", {}, ...(["end.action1", "end.action2", "end.action3"] as const).map((key) => h("li", {}, t(lang, key)))),
        h("a", { href: UN_SDG14_URL, target: "_blank", rel: "noopener noreferrer" }, t(lang, "end.sdgLink")),
      ),
      h(
        "div",
        { class: "end-actions" },
        h("button", { type: "button", class: "primary", onclick: onReplay }, t(lang, "end.replay")),
        h("button", { type: "button", onclick: onExplore }, t(lang, "end.explore")),
      ),
      notice && h("p", { class: "notice", role: "alert" }, t(lang, notice)),
    ),
  );
}
