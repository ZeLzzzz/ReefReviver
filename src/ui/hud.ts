import type { HudState } from "../game/hud-state";
import type { ObjectiveId } from "../game/session";
import { t, type Lang, type StringKey } from "../i18n/i18n";
import { h } from "./screens";

export interface HudView {
  element: HTMLElement;
  /** Shows a new state. Only touches the DOM for what changed, so it is cheap to call every frame. */
  update(state: HudState): void;
}

const OBJECTIVE_KEYS: Record<ObjectiveId, StringKey> = {
  clean: "objectives.clean",
  free: "objectives.free",
  deposit: "objectives.deposit",
};

const TOOL_SLOT: Record<HudState["tool"], string> = { vacuum: "2", cutter: "1" };

function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) element.hidden = hidden;
}

/** Row "label  value" in the stats panel. */
function stat(label: string, className: string): { row: HTMLElement; value: HTMLElement } {
  const value = h("strong", { class: "stat-value" });
  return { row: h("div", { class: `stat ${className}` }, h("span", { class: "stat-label" }, label), value), value };
}

/**
 * The in-game overlay for one language: crosshair, goals, tank / score / materials / cleanliness, the active
 * tool, messages and the direction marker to the recycling station. Status is never colour alone: the full
 * tank has its own text, done goals a check mark and a word for screen readers.
 */
export function createHud(lang: Lang): HudView {
  const goalItems = new Map<ObjectiveId, { item: HTMLElement; mark: HTMLElement; text: HTMLElement }>();
  const goalList = h("ul", { class: "goal-list" });
  for (const id of Object.keys(OBJECTIVE_KEYS) as ObjectiveId[]) {
    const mark = h("span", { class: "goal-mark", "aria-hidden": "true" });
    const text = h("span", { class: "goal-text" });
    const status = h("span", { class: "visually-hidden" });
    const item = h("li", { class: "goal", "data-goal": id }, mark, text, status);
    goalItems.set(id, { item, mark, text });
    goalList.append(item);
  }

  const score = stat(t(lang, "hud.score"), "stat-score");
  const materials = stat(t(lang, "hud.materials"), "stat-materials");
  const tank = stat(t(lang, "hud.tank"), "stat-tank");
  const cleanliness = stat(t(lang, "hud.cleanliness"), "stat-cleanliness");
  const meter = h("div", { class: "tank-meter", "aria-hidden": "true" });
  const meterFill = h("div", { class: "tank-meter-fill" });
  meter.append(meterFill);

  const toolName = h("strong", { class: "tool-name" });
  const toolHint = h("span", { class: "tool-hint" });

  const fullMessage = h("p", { class: "message message-full", role: "status" });
  const prompt = h("p", { class: "message message-prompt" });
  const notice = h("p", { class: "message message-notice", role: "status" });

  const markerArrow = h("span", { class: "marker-arrow", "aria-hidden": "true" }, "▲");
  const markerLabel = h("span", { class: "marker-label" });
  const marker = h("div", { class: "station-marker" }, markerArrow, markerLabel);

  // REQ-003: a ring around the crosshair that fills while the cutter cuts a net, with the percentage in words.
  const cutLabel = h("span", { class: "cut-label" });
  const cutRing = h("div", { class: "cut-ring", "aria-hidden": "true" });
  const cutProgress = h(
    "div",
    { class: "cut-progress", role: "progressbar", "aria-label": t(lang, "cutter.progress"), "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" },
    cutRing,
    cutLabel,
  );
  cutProgress.hidden = true;

  const element = h(
    "div",
    { class: "hud" },
    h("div", { class: "crosshair", "aria-hidden": "true" }),
    cutProgress,
    h("section", { class: "hud-panel hud-goals", "aria-label": t(lang, "objectives.title") }, h("h2", {}, t(lang, "objectives.title")), goalList),
    h("section", { class: "hud-panel hud-stats" }, tank.row, meter, materials.row, score.row, cleanliness.row),
    h(
      "section",
      { class: "hud-panel hud-tool" },
      h("span", { class: "tool-label" }, t(lang, "hud.tool")),
      toolName,
      toolHint,
    ),
    h("div", { class: "hud-messages" }, fullMessage, notice, prompt),
    marker,
  );

  let markerWidth = 0;
  return {
    element,
    update(state) {
      for (const objective of state.objectives) {
        const parts = goalItems.get(objective.id)!;
        const counts = objective.target === null ? "" : objective.id === "clean" ? ` ${objective.current}%/${objective.target}%` : ` ${objective.current}/${objective.target}`;
        setText(parts.text, t(lang, OBJECTIVE_KEYS[objective.id]) + counts);
        setText(parts.mark, objective.done ? "✓" : "○");
        setText(parts.item.lastElementChild!, t(lang, objective.done ? "objectives.done" : "objectives.todo"));
        parts.item.classList.toggle("done", objective.done);
      }

      setText(tank.value, `${state.tank}/${state.capacity}`);
      tank.row.classList.toggle("full", state.tankFull);
      meterFill.style.width = `${(state.tank / state.capacity) * 100}%`;
      setText(materials.value, String(state.materials));
      setText(score.value, String(state.score));
      setText(cleanliness.value, `${state.cleanliness}%`);

      setText(toolName, `${TOOL_SLOT[state.tool]} ${t(lang, `tools.${state.tool}`)}`);
      setText(toolHint, t(lang, `tools.${state.tool}.hint`));
      element.classList.toggle("sucking", state.sucking);

      // REQ-003: shown only while the cutter is cutting; empty again the moment it stops (AC-1, AC-4).
      const percent = Math.floor(state.cutProgress * 100);
      setHidden(cutProgress, state.cutProgress <= 0);
      if (state.cutProgress > 0) {
        cutProgress.setAttribute("aria-valuenow", String(percent));
        cutRing.style.setProperty("--cut", state.cutProgress.toFixed(3));
        setText(cutLabel, `${t(lang, "cutter.progress")} ${percent}%`);
      }
      element.classList.toggle("cutting", state.cutProgress > 0);

      setHidden(fullMessage, !state.tankFull);
      setText(fullMessage, state.tankFull ? t(lang, "hud.tankFull") : "");
      setHidden(prompt, !state.inStationZone);
      setText(prompt, state.inStationZone ? t(lang, "hud.depositPrompt") : "");
      setHidden(notice, !state.notice);
      setText(notice, state.notice ? t(lang, state.notice.key) + (state.notice.amount === undefined ? "" : ` +${state.notice.amount}`) : "");

      // The marker always points to the station; it is loudest when the tank is full.
      marker.classList.toggle("urgent", state.tankFull);
      marker.classList.toggle("on-screen", state.marker.onScreen);
      // Keep the whole label on screen when the marker rides the left or right edge.
      const half = markerWidth / 2 + 8;
      const left = Math.min(Math.max(state.marker.left, half), Math.max(half, window.innerWidth - half));
      marker.style.transform = `translate(${left.toFixed(1)}px, ${state.marker.top.toFixed(1)}px) translate(-50%, -50%)`;
      markerArrow.style.transform = `rotate(${state.marker.angle.toFixed(3)}rad)`;
      const label = `${t(lang, "station.name")} · ${state.stationDistance} m`;
      if (markerLabel.textContent !== label) {
        markerLabel.textContent = label;
        markerWidth = marker.offsetWidth;
      }
    },
  };
}
