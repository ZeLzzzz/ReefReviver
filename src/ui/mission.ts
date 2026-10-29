import { config } from "../config";
import { forTouch, format, t, type Lang, type StringKey } from "../i18n/i18n";
import { LOGBOOK_ENTRIES } from "../logbook/entries";
import { h } from "./screens";

export interface MissionProps {
  lang: Lang;
  /** A message under the button, e.g. when the browser refused the cursor. */
  notice: StringKey | null;
  onStart: () => void;
  /** REQ-030 AC-5: on a phone or tablet the line of controls names the touch controls. */
  touch?: boolean;
}

/** A small number as a capitalised word at the start of a sentence ("Dua", "Two"); digits beyond ten. */
function sentenceNumber(lang: Lang, n: number): string {
  const word = t(lang, "mission.numbers").split(",")[n];
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : String(n);
}

/**
 * REQ-029 AC-2, AC-3: the texts of the mission card. Every number comes from the game's configuration (the trash, the
 * Bloom's threshold, the frames and patches, the nets, the Logbook's entries), so the card always matches the game.
 */
export function missionTexts(lang: Lang, touch = false): { title: string; state: string; list: string; missions: string[]; dumper: string; controls: string; closing: string } {
  const values = {
    trash: config.trash.count,
    nets: sentenceNumber(lang, config.phase1.nets),
    percent: config.phase1.cleanTarget,
    frames: config.reef.frames,
    patches: config.reef.patches,
    entries: LOGBOOK_ENTRIES.length,
  };
  return {
    title: t(lang, "mission.title"),
    state: format(lang, "mission.state", values),
    list: t(lang, "mission.list"),
    missions: (["mission.1", "mission.2", "mission.3", "mission.4"] as const).map((key) => format(lang, key, values)),
    // REQ-037 AC-6: the dumping boat that comes now and then.
    dumper: t(lang, "mission.dumper"),
    controls: t(lang, forTouch("mission.controls", touch)),
    closing: t(lang, "mission.closing"),
  };
}

/**
 * The mission card (REQ-029): after the opening cinematic, the state of the bay, the four missions in order, the main
 * controls and Mulai menyelam. In the end screen's panel style (AC-8); no character (D-114).
 */
export function missionScreen({ lang, notice, onStart, touch = false }: MissionProps): HTMLElement {
  const text = missionTexts(lang, touch);
  const start = h("button", { type: "button", class: "primary", onclick: onStart }, t(lang, "mission.start"));
  return h(
    "div",
    { class: "screen mission-screen" },
    h(
      "section",
      { class: "panel mission", role: "dialog", "aria-label": text.title },
      h("h1", {}, text.title),
      h("p", {}, text.state),
      h("h2", {}, text.list),
      h("ol", { class: "mission-list" }, ...text.missions.map((mission) => h("li", {}, mission))),
      h("p", { class: "mission-dumper" }, text.dumper),
      h("p", { class: "mission-controls" }, text.controls),
      h("p", { class: "mission-closing" }, text.closing),
      start,
      notice && h("p", { class: "notice", role: "alert" }, t(lang, notice)),
    ),
  );
}
