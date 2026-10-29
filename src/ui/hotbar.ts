import { config } from "../config";
import type { TouchInput } from "../game/input";
import type { ToolId } from "../game/tools";
import { t, type Lang } from "../i18n/i18n";
import { svg } from "./minimap";
import { h } from "./screens";

export interface HotbarState {
  tool: ToolId;
  /** The Scanner can be picked once the Bloom is over (REQ-006); until then its slot is locked. */
  scannerOpen: boolean;
  /** The tool in hand is at work: the Vacuum pulling, the Cutter cutting, the Scanner scanning. */
  working: boolean;
  /** On the land and during a cinematic there is no hotbar. */
  hidden: boolean;
  /** The tool's hint, in the wording for this device (REQ-030 AC-5). */
  hint: string;
}

export interface HotbarView {
  element: HTMLElement;
  /** `now` is in seconds; the name and hint fade this long after the tool changed or the hotbar came back. */
  update(state: HotbarState, now: number): void;
}

// The slots follow the number keys (D-019). Each icon is a few 24 × 24 strokes, drawn like the touch menu's icons.
const SLOTS: readonly { tool: ToolId; key: string; code: string; icon: readonly string[] }[] = [
  // Cutter: a pair of scissors.
  { tool: "cutter", key: "1", code: "Digit1", icon: ["M3 6a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0", "M8.5 8l11.5 10", "M8.5 16l11.5-10"] },
  // Vacuum: a nozzle drawing bits of trash into it.
  { tool: "vacuum", key: "2", code: "Digit2", icon: ["M9 4l6 5h6", "M9 20l6-5h6", "M2 8.5h3", "M3.5 12h3", "M2 15.5h3"] },
  // Seed launcher: a sprout.
  { tool: "seedLauncher", key: "3", code: "Digit3", icon: ["M12 21v-9", "M12 12c-5 0-8-2.5-8-7 4.5 0 8 2.5 8 7z", "M12 14.5c0-4 3-6.5 8-6.5 0 4-3 6.5-8 6.5z"] },
  // Scanner: a magnifying glass.
  { tool: "scanner", key: "4", code: "Digit4", icon: ["M4 10.5a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0", "M15.5 15.5l5 5"] },
];
const LOCK_ICON = ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"];

function icon(className: string, paths: readonly string[]): SVGSVGElement {
  return svg("svg", { class: className, viewBox: "0 0 24 24", "aria-hidden": "true" }, ...paths.map((d) => svg("path", { d })));
}

/**
 * REQ-033 (D-126): the tools of the submarine as a hotbar at the bottom centre: an icon and the number key in each slot, a
 * thick accent frame round the tool in hand, which fills while the tool works, and a dim, locked Scanner until the Bloom.
 * The tool's name and hint show above it when the tool changes or the hotbar comes back, then fade. On a computer the slots
 * only show (the cursor is locked to the game); on a phone or tablet they are buttons, and a tap is the number key
 * (REQ-030 AC-3). Each slot says in words which tool it is and whether it is in hand or locked (AC-6).
 */
export function createHotbar(lang: Lang, touch: TouchInput | null): HotbarView {
  const name = h("strong", { class: "tool-name" });
  const hint = h("span", { class: "tool-hint" });
  const caption = h("div", { class: "hotbar-caption", role: "status" }, name, hint);
  const slots = SLOTS.map(({ tool, key, code, icon: paths }) => {
    const label = h("span", { class: "visually-hidden" });
    const parts = [
      icon("hotbar-icon", paths),
      h("span", { class: "hotbar-key", "aria-hidden": "true" }, key),
      // Shown by the slot's `locked` class.
      icon("hotbar-lock", LOCK_ICON),
      label,
    ];
    const slot = touch
      ? h("button", { type: "button", class: "hotbar-slot", "data-tool": tool }, ...parts)
      : h("div", { class: "hotbar-slot", "data-tool": tool }, ...parts);
    if (touch) {
      slot.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        touch.tap(code);
      });
      // A tap on a slot is not a menu click, so the menu's click sound (REQ-026 AC-3) does not play.
      slot.addEventListener("click", (event) => event.stopPropagation());
    }
    return { tool, key, slot, label };
  });
  const row = h("div", { class: "hotbar-slots" }, ...slots.map(({ slot }) => slot));
  const element = h("section", { class: "hud-tool hotbar", "aria-label": t(lang, "hud.tool") }, caption, row);

  let shown: { tool: ToolId; scannerOpen: boolean; working: boolean } | null = null;
  let lastTool: ToolId | null = null;
  let wasHidden = true;
  let last: number | null = null;
  let captionLeft = 0;
  return {
    element,
    update(state, now) {
      if (element.hidden !== state.hidden) element.hidden = state.hidden;
      // Paused frames do not count: the clock moves at most a frame's worth between two updates.
      const dt = last === null ? 0 : Math.min(0.1, Math.max(0, now - last));
      last = now;
      if (!state.hidden) {
        captionLeft -= dt;
        if (state.tool !== lastTool || wasHidden) captionLeft = config.hud.toolCaptionSeconds;
        lastTool = state.tool;
      }
      wasHidden = state.hidden;
      caption.classList.toggle("shown", captionLeft > 0);
      if (name.textContent !== t(lang, `tools.${state.tool}`)) name.textContent = t(lang, `tools.${state.tool}`);
      if (hint.textContent !== state.hint) hint.textContent = state.hint;

      if (shown?.tool === state.tool && shown.scannerOpen === state.scannerOpen && shown.working === state.working) return;
      shown = { tool: state.tool, scannerOpen: state.scannerOpen, working: state.working };
      for (const { tool, key, slot, label } of slots) {
        const held = tool === state.tool;
        const locked = tool === "scanner" && !state.scannerOpen;
        if (touch) slot.setAttribute("aria-pressed", String(held));
        slot.classList.toggle("held", held);
        slot.classList.toggle("locked", locked);
        slot.classList.toggle("working", held && state.working);
        const status = held ? `, ${t(lang, "hotbar.inHand")}` : locked ? `, ${t(lang, "hotbar.locked")}` : "";
        label.textContent = `${key} ${t(lang, `tools.${tool}`)}${status}`;
      }
    },
  };
}
