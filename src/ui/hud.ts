import type { HudState } from "../game/hud-state";
import type { ObjectiveId } from "../game/session";
import { t, type Lang, type StringKey } from "../i18n/i18n";
import { createMinimap } from "./minimap";
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
  frames: "objectives.phase2.frames",
  coral: "objectives.phase2.coral",
  seagrass: "objectives.phase2.seagrass",
  scan: "objectives.phase3.scan",
};

const PHASE1_GOALS: readonly ObjectiveId[] = ["clean", "free", "deposit"];
// REQ-004: the Phase 2 list appears below the Phase 1 list after the first deposit (D-043).
const PHASE2_GOALS: readonly ObjectiveId[] = ["frames", "coral", "seagrass"];
// REQ-005: after the Bloom the Phase 3 list replaces the Phase 1 and 2 lists (D-049).
const PHASE3_GOALS: readonly ObjectiveId[] = ["scan"];

const TOOL_SLOT: Record<HudState["tool"], string> = { cutter: "1", vacuum: "2", seedLauncher: "3" };

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
  const addGoals = (list: HTMLElement, ids: readonly ObjectiveId[]) => {
    for (const id of ids) {
      const mark = h("span", { class: "goal-mark", "aria-hidden": "true" });
      const text = h("span", { class: "goal-text" });
      const status = h("span", { class: "visually-hidden" });
      const item = h("li", { class: "goal", "data-goal": id }, mark, text, status);
      goalItems.set(id, { item, mark, text });
      list.append(item);
    }
  };
  const goalList = h("ul", { class: "goal-list" });
  addGoals(goalList, PHASE1_GOALS);
  const phase2List = h("ul", { class: "goal-list goal-list-phase2" });
  phase2List.hidden = true;
  const phase3List = h("ul", { class: "goal-list goal-list-phase3" });
  phase3List.hidden = true;

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

  // REQ-010: the minimap in the top-right corner, with the stats panel under it.
  const minimap = createMinimap(lang);
  minimap.element.hidden = true;

  const element = h(
    "div",
    { class: "hud" },
    h("div", { class: "crosshair", "aria-hidden": "true" }),
    cutProgress,
    h("section", { class: "hud-panel hud-goals", "aria-label": t(lang, "objectives.title") }, h("h2", {}, t(lang, "objectives.title")), goalList, phase2List, phase3List),
    minimap.element,
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
      const phase2 = state.reef?.phase2 ?? [];
      // REQ-005: once the Bloom is over (phase3 present) only the Phase 3 list shows.
      const phase3 = state.phase3 ?? [];
      const afterBloom = phase3.length > 0;
      setHidden(goalList, afterBloom);
      setHidden(phase2List, afterBloom || phase2.length === 0);
      setHidden(phase3List, !afterBloom);
      // The rows are built when the list first appears, so before the first deposit only the Phase 1 goals exist.
      if (phase2.length > 0 && phase2List.childElementCount === 0) addGoals(phase2List, PHASE2_GOALS);
      if (afterBloom && phase3List.childElementCount === 0) addGoals(phase3List, PHASE3_GOALS);
      for (const objective of [...state.objectives, ...phase2, ...phase3]) {
        const parts = goalItems.get(objective.id)!;
        const counts = objective.target === null ? "" : objective.id === "clean" ? ` ${objective.current}%/${objective.target}%` : ` ${objective.current}/${objective.target}`;
        setText(parts.text, t(lang, OBJECTIVE_KEYS[objective.id]) + counts);
        setText(parts.mark, objective.done ? "✓" : "○");
        setText(parts.item.lastElementChild!, t(lang, objective.done ? "objectives.done" : "objectives.todo"));
        parts.item.classList.toggle("done", objective.done);
      }

      // REQ-010: a state without a minimap (an old test fixture) shows no map rather than an empty one.
      setHidden(minimap.element, !state.minimap);
      if (state.minimap) minimap.update(state.minimap);

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
      // Depositing wins when both apply; the frame prompt shows near an empty reef site (REQ-004).
      const promptKey = state.inStationZone ? "hud.depositPrompt" : state.reef?.canInstall ? "reef.installPrompt" : null;
      setHidden(prompt, !promptKey);
      setText(prompt, promptKey ? t(lang, promptKey) : "");
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
