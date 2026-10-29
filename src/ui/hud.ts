import type { HudState } from "../game/hud-state";
import { avoidRects } from "../game/marker";
import type { ObjectiveId } from "../game/session";
import { forTouch, t, type Lang, type StringKey } from "../i18n/i18n";
import type { CinematicHud } from "../game/cinematic";
import { createCinematicOverlay } from "./cinematic";
import { createHotbar } from "./hotbar";
import { createMinimap } from "./minimap";
import { h } from "./screens";
import { createTouchControls, type TouchHud } from "./touch";

export interface HudView {
  element: HTMLElement;
  /** Shows a new state. Only touches the DOM for what changed, so it is cheap to call every frame. */
  update(state: HudState): void;
  /** REQ-026 AC-5: shows or hides the "Suara mati" tag. */
  setMuted(muted: boolean): void;
  /** REQ-027, REQ-028: shows a cinematic's bars and narration and hides the HUD's own parts (null: back to normal). */
  setCinematic(state: CinematicHud | null): void;
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

/** The message, then the score it earned (`+100`) or the name of the Logbook entry it opened (REQ-006). */
function noticeText(lang: Lang, notice: NonNullable<HudState["notice"]>, touch: boolean): string {
  let text = t(lang, forTouch(notice.key, touch));
  if (notice.amount !== undefined) text += ` +${notice.amount}`;
  if (notice.entry) text += ` ${t(lang, `logbook.${notice.entry}.name`)}`;
  return text;
}

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
 * tank has its own text, done goals a check mark and a word for screen readers. On a phone or tablet (`touch`, REQ-030) the
 * touch controls come with it, and the texts that name a key or the mouse use their touch wording (AC-5).
 */
export function createHud(lang: Lang, touch: TouchHud | null = null): HudView {
  const text = (key: StringKey) => t(lang, forTouch(key, touch !== null));
  const controls = touch && createTouchControls(lang, touch);
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
  // REQ-036 AC-1: while a dumping boat is in the bay, an urgent goal tops the list (marked "!" and said in words).
  // REQ-037 AC-5: under it, how to turn the boat over.
  const dumperGoal = h(
    "ul",
    { class: "goal-alert-list" },
    h(
      "li",
      { class: "goal-alert", "data-goal": "dumper" },
      h("span", { class: "goal-alert-mark", "aria-hidden": "true" }, "!"),
      h(
        "span",
        { class: "goal-alert-body" },
        h("span", { class: "goal-alert-text" }, t(lang, "objectives.dumper")),
        h("span", { class: "goal-alert-hint" }, text("dumper.hint")),
      ),
    ),
  );
  dumperGoal.hidden = true;

  const score = stat(t(lang, "hud.score"), "stat-score");
  const materials = stat(t(lang, "hud.materials"), "stat-materials");
  const tank = stat(t(lang, "hud.tank"), "stat-tank");
  const cleanliness = stat(t(lang, "hud.cleanliness"), "stat-cleanliness");
  const meter = h("div", { class: "tank-meter", "aria-hidden": "true" });
  const meterFill = h("div", { class: "tank-meter-fill" });
  meter.append(meterFill);

  // REQ-033: the tools as a hotbar at the bottom centre, under the messages.
  const hotbar = createHotbar(lang, touch?.input ?? null);

  const fullMessage = h("p", { class: "message message-full", role: "status" });
  const prompt = h("p", { class: "message message-prompt" });
  const notice = h("p", { class: "message message-notice", role: "status" });

  const markerArrow = h("span", { class: "marker-arrow", "aria-hidden": "true" }, "▲");
  const markerLabel = h("span", { class: "marker-label" });
  const marker = h("div", { class: "station-marker" }, markerArrow, markerLabel);

  // REQ-037: the marker to the dumping boat, shaped like the station's (its own classes, so the station's stay its own),
  // with a blinking "!" before the boat's name and distance.
  const dumperArrow = h("span", { class: "dumper-marker-arrow", "aria-hidden": "true" }, "▲");
  const dumperDistance = h("span", {});
  const dumperMarker = h(
    "div",
    { class: "dumper-marker" },
    dumperArrow,
    h("span", { class: "dumper-marker-label" }, h("span", { class: "dumper-marker-mark", "aria-hidden": "true" }, "!"), dumperDistance),
  );
  dumperMarker.hidden = true;

  // REQ-003: a ring around the crosshair that fills while the cutter cuts a net, with the percentage in words.
  // REQ-006: the scanner fills the same ring, with its own word.
  const cutLabel = h("span", { class: "cut-label" });
  const cutRing = h("div", { class: "cut-ring", "aria-hidden": "true" });
  const cutProgress = h(
    "div",
    { class: "cut-progress", role: "progressbar", "aria-label": t(lang, "cutter.progress"), "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" },
    cutRing,
    cutLabel,
  );
  cutProgress.hidden = true;

  const goalsPanel = h("section", { class: "hud-panel hud-goals", "aria-label": t(lang, "objectives.title") }, h("h2", {}, t(lang, "objectives.title")), dumperGoal, goalList, phase2List, phase3List);
  const statsPanel = h("section", { class: "hud-panel hud-stats" }, tank.row, meter, materials.row, score.row, cleanliness.row);

  // REQ-015: the screen fades out and back in while the player gets out of the submarine or back in (no flash).
  const fade = h("div", { class: "hud-fade", "aria-hidden": "true" });

  // REQ-010: the minimap in the top-right corner, with the stats panel under it.
  const minimap = createMinimap(lang);
  minimap.element.hidden = true;

  // REQ-026 AC-5: a small tag in the corner while M has muted the sound.
  const soundOff = h("p", { class: "sound-off", role: "status" });
  soundOff.hidden = true;

  // REQ-027 AC-3, REQ-028 AC-3: the black bars, the skip hint and the narration of a cinematic.
  const cinematic = createCinematicOverlay(lang, touch !== null);

  const element = h(
    "div",
    { class: touch ? "hud touch-hud" : "hud" },
    controls && controls.element,
    h("div", { class: "crosshair", "aria-hidden": "true" }),
    cutProgress,
    goalsPanel,
    minimap.element,
    statsPanel,
    h("div", { class: "hud-bottom" }, h("div", { class: "hud-messages" }, fullMessage, notice, prompt), hotbar.element),
    marker,
    dumperMarker,
    soundOff,
    cinematic.element,
    fade,
  );

  const setCinematic = (state: CinematicHud | null) => {
    element.classList.toggle("cinematic", state !== null);
    cinematic.update(state);
  };

  return {
    element,
    setMuted(muted) {
      setHidden(soundOff, !muted);
      setText(soundOff, muted ? t(lang, "hud.muted") : "");
      controls?.setMuted(muted);
    },
    setCinematic,
    update(state) {
      setCinematic(state.cinematic ?? null);
      const phase2 = state.reef?.phase2 ?? [];
      // REQ-005: once the Bloom is over (phase3 present) only the Phase 3 list shows.
      const phase3 = state.phase3 ?? [];
      const afterBloom = phase3.length > 0;
      setHidden(goalList, afterBloom);
      setHidden(phase2List, afterBloom || phase2.length === 0);
      setHidden(phase3List, !afterBloom);
      setHidden(dumperGoal, !state.dumper?.active);
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

      // REQ-015 AC-2: on the land there are no tools, so the hotbar is hidden; so it is during a cinematic (REQ-033 AC-5).
      const onLand = state.land?.onLand ?? false;
      element.classList.toggle("on-land", onLand);
      controls?.update({ onLand });
      fade.style.opacity = (state.land?.fade ?? 0).toFixed(3);
      hotbar.update(
        {
          tool: state.tool,
          // REQ-006: the Phase 3 list is there once the Bloom is over, and so is the Scanner.
          scannerOpen: (state.phase3 ?? []).length > 0,
          working: state.sucking || state.cutProgress > 0 || (state.scanProgress ?? 0) > 0,
          hidden: onLand || (state.cinematic ?? null) !== null,
          hint: text(`tools.${state.tool}.hint`),
        },
        performance.now() / 1000,
      );
      element.classList.toggle("sucking", state.sucking);

      // REQ-003: shown only while the cutter is cutting; empty again the moment it stops (AC-1, AC-4).
      // REQ-006: the same ring shows the scanner's progress (only one of the two tools is in use at a time).
      const scanning = (state.scanProgress ?? 0) > 0;
      const progress = scanning ? state.scanProgress! : state.cutProgress;
      const percent = Math.floor(progress * 100);
      setHidden(cutProgress, progress <= 0);
      if (progress > 0) {
        const label = t(lang, scanning ? "scanner.progress" : state.dumper?.atBoat ? "dumper.progress" : "cutter.progress");
        cutProgress.setAttribute("aria-label", label);
        cutProgress.setAttribute("aria-valuenow", String(percent));
        cutRing.style.setProperty("--cut", progress.toFixed(3));
        setText(cutLabel, `${label} ${percent}%`);
      }
      element.classList.toggle("cutting", progress > 0);

      setHidden(fullMessage, !state.tankFull);
      setText(fullMessage, state.tankFull ? t(lang, "hud.tankFull") : "");
      // REQ-017: with the crosshair on beach trash in reach, picking it up wins over everything else. Depositing wins
      // when both apply; the frame prompt shows near an empty reef site (REQ-004); near the beach E goes ashore, and on
      // the land next to the submarine it gets back in (REQ-015).
      const promptKey = state.land?.canPickUp
        ? "land.pickupPrompt"
        : state.land?.canBoard
          ? "land.boardPrompt"
          : state.inStationZone
            ? "hud.depositPrompt"
            : state.reef?.canInstall
              ? "reef.installPrompt"
              : state.land?.canGoAshore
                ? "land.ashorePrompt"
                : null;
      setHidden(prompt, !promptKey);
      setText(prompt, promptKey ? text(promptKey) : "");
      setHidden(notice, !state.notice);
      setText(notice, state.notice ? noticeText(lang, state.notice, touch !== null) : "");

      // The marker always points to the station; it is loudest when the tank is full.
      marker.classList.toggle("urgent", state.tankFull);
      marker.classList.toggle("on-screen", state.marker.onScreen);
      const label = `${t(lang, "station.name")} · ${state.stationDistance} m`;
      setText(markerLabel, label);
      // Measured every frame: the full tank makes the marker bigger (bold, with a border).
      const markerWidth = marker.offsetWidth;
      const markerHeight = marker.offsetHeight;
      // Keep the whole label on screen when the marker rides the left or right edge, and off every HUD panel and
      // message (REQ-016 AC-5).
      const half = markerWidth / 2 + 8;
      const edgeLeft = Math.min(Math.max(state.marker.left, half), Math.max(half, window.innerWidth - half));
      const panels = [goalsPanel, minimap.element, statsPanel, hotbar.element, fullMessage, notice, prompt, soundOff].map((panel) => panel.getBoundingClientRect());
      if (controls) panels.push(...controls.rects());
      const placed = avoidRects(edgeLeft, state.marker.top, markerWidth, markerHeight, panels, window.innerWidth, window.innerHeight);
      marker.style.transform = `translate(${placed.x.toFixed(1)}px, ${placed.y.toFixed(1)}px) translate(-50%, -50%)`;
      markerArrow.style.transform = `rotate(${state.marker.angle.toFixed(3)}rad)`;

      // REQ-037: the boat's marker is placed the same way, and off the station's marker too (AC-3).
      const boat = state.dumper?.active ? (state.dumper.marker ?? null) : null;
      setHidden(dumperMarker, !boat);
      if (boat) {
        dumperMarker.classList.toggle("on-screen", boat.onScreen);
        setText(dumperDistance, `${t(lang, "dumper.marker")} · ${state.dumper?.distance ?? 0} m`);
        const boatWidth = dumperMarker.offsetWidth;
        const boatHeight = dumperMarker.offsetHeight;
        const boatHalf = boatWidth / 2 + 8;
        const boatLeft = Math.min(Math.max(boat.left, boatHalf), Math.max(boatHalf, window.innerWidth - boatHalf));
        const around = [...panels, marker.getBoundingClientRect()];
        const spot = avoidRects(boatLeft, boat.top, boatWidth, boatHeight, around, window.innerWidth, window.innerHeight);
        dumperMarker.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px) translate(-50%, -50%)`;
        dumperArrow.style.transform = `rotate(${boat.angle.toFixed(3)}rad)`;
      }
    },
  };
}
