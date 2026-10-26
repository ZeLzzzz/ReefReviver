import { config } from "../config";
import type { TouchInput } from "../game/input";
import type { ToolId } from "../game/tools";
import { t, type Lang } from "../i18n/i18n";
import { svg } from "./minimap";
import { h } from "./screens";

/** REQ-030: what the touch controls drive. The menu buttons do what Esc, L and M do. */
export interface TouchHud {
  input: TouchInput;
  onPause(): void;
  onLogbook(): void;
  onMute(): void;
}

export interface TouchControlsView {
  element: HTMLElement;
  /** On the land there is no ▲/▼, PAKAI or tool bar (AC-3); the slot of the tool in hand is marked. */
  update(state: { onLand: boolean; tool: ToolId }): void;
  setMuted(muted: boolean): void;
  /** Where the controls are, so the station marker keeps off them. */
  rects(): DOMRect[];
}

// The tool bar's slots, the keys they stand for (D-019).
const SLOTS: readonly { tool: ToolId; code: string; label: string }[] = [
  { tool: "cutter", code: "Digit1", label: "1" },
  { tool: "vacuum", code: "Digit2", label: "2" },
  { tool: "seedLauncher", code: "Digit3", label: "3" },
  { tool: "scanner", code: "Digit4", label: "4" },
];

/** A 24 × 24 line icon for the menu buttons. */
function icon(...paths: string[]): SVGSVGElement {
  return svg("svg", { class: "touch-icon", viewBox: "0 0 24 24", "aria-hidden": "true" }, ...paths.map((d) => svg("path", { d })));
}

const PAUSE_ICON = ["M8 5v14", "M16 5v14"];
const BOOK_ICON = ["M3 6.5c3-1.6 6-1.6 9 0V20c-3-1.6-6-1.6-9 0z", "M21 6.5c-3-1.6-6-1.6-9 0V20c3-1.6 6-1.6 9 0z"];
const SOUND_ICON = ["M4 9.5h3.5L12 6v12l-4.5-3.5H4z", "M15.5 9.5a3.5 3.5 0 0 1 0 5", "M18 7a7 7 0 0 1 0 10"];
const MUTED_ICON = ["M4 9.5h3.5L12 6v12l-4.5-3.5H4z", "M15.5 9.5l5 5", "M20.5 9.5l-5 5"];

/**
 * Follows one finger at a time on a control, from the moment it touches until it is lifted, slides off the screen or the
 * browser cancels the touch, so a held control is always let go (AC-6).
 */
function hold(element: HTMLElement, down: (event: PointerEvent) => void, up: () => void, move?: (event: PointerEvent) => void): void {
  let finger: number | null = null;
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (finger !== null) return;
    finger = event.pointerId;
    element.setPointerCapture?.(event.pointerId);
    element.classList.add("held");
    down(event);
  });
  element.addEventListener("pointermove", (event) => {
    if (event.pointerId === finger) move?.(event);
  });
  const end = (event: PointerEvent) => {
    if (event.pointerId !== finger) return;
    finger = null;
    element.classList.remove("held");
    up();
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) element.addEventListener(type, end);
}

/** A game control: a tap on it is not a menu click, so the menu's click sound (REQ-026 AC-3) does not play. */
function control(className: string, label: string, text: string): HTMLButtonElement {
  return h("button", { type: "button", class: `touch-control ${className}`, "aria-label": label, onclick: (event) => event.stopPropagation() }, text);
}

/** Turns a drag into steering, in mouse pixels (AC-2, AC-3). */
function dragLook(input: TouchInput) {
  let x = 0;
  let y = 0;
  return {
    start(event: PointerEvent) {
      x = event.clientX;
      y = event.clientY;
    },
    move(event: PointerEvent) {
      input.look((event.clientX - x) * config.touch.lookScale, (event.clientY - y) * config.touch.lookScale);
      x = event.clientX;
      y = event.clientY;
    },
  };
}

/**
 * REQ-030 (D-117): the touch controls over the game. A finger that lands on the left half of the picture holds the joystick,
 * which jumps under it and goes home when it is lifted; a finger on the right half steers (or looks around on the land);
 * any touch on the picture skips a cinematic. ▲/▼, E and PAKAI sit in the bottom-right corner, the tool bar next to the
 * joystick, and pause, Logbook and sound beside the minimap.
 */
export function createTouchControls(lang: Lang, hud: TouchHud): TouchControlsView {
  const { input } = hud;
  const { stickRadius, deadZone } = config.touch;

  const knob = h("div", { class: "stick-knob" });
  const stick = h("div", { class: "stick", "aria-hidden": "true" }, knob);
  const surface = h("div", { class: "touch-surface" });

  // The joystick: `x`/`y` its centre while a finger holds it.
  let centre: { x: number; y: number } | null = null;
  const moveStick = (event: PointerEvent) => {
    if (!centre) return;
    const dx = event.clientX - centre.x;
    const dy = event.clientY - centre.y;
    const length = Math.hypot(dx, dy);
    const reach = Math.min(length, stickRadius);
    const scale = length > 0 ? reach / length : 0;
    knob.style.transform = `translate(${(dx * scale).toFixed(1)}px, ${(dy * scale).toFixed(1)}px)`;
    // AC-2 (D-118): the further the knob goes, the faster; a little play around the centre does nothing.
    const amount = Math.max(0, (reach / stickRadius - deadZone) / (1 - deadZone));
    if (amount > 0) input.stick((dx / length) * amount, (-dy / length) * amount);
    else input.stick(0, 0);
  };
  const startStick = (event: PointerEvent) => {
    const bounds = surface.getBoundingClientRect();
    const margin = stick.offsetWidth / 2;
    const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
    centre = {
      x: clamp(event.clientX, bounds.left + margin, bounds.left + bounds.width / 2 - margin),
      y: clamp(event.clientY, bounds.top + margin, bounds.bottom - margin),
    };
    stick.style.left = `${centre.x - bounds.left}px`;
    stick.style.top = `${centre.y - bounds.top}px`;
    stick.classList.add("active");
    moveStick(event);
  };
  const endStick = () => {
    centre = null;
    input.stick(0, 0);
    stick.classList.remove("active");
    stick.style.left = stick.style.top = knob.style.transform = "";
  };

  // The picture: one finger for the joystick (left half), one for steering (right half).
  const fingers = new Map<number, "stick" | "look">();
  const look = dragLook(input);
  surface.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    input.click(); // REQ-027 AC-4: a tap skips a cinematic
    const bounds = surface.getBoundingClientRect();
    const role = event.clientX < bounds.left + bounds.width / 2 ? "stick" : "look";
    if ([...fingers.values()].includes(role)) return;
    fingers.set(event.pointerId, role);
    surface.setPointerCapture?.(event.pointerId);
    if (role === "stick") startStick(event);
    else look.start(event);
  });
  surface.addEventListener("pointermove", (event) => {
    const role = fingers.get(event.pointerId);
    if (role === "stick") moveStick(event);
    else if (role === "look") look.move(event);
  });
  const lift = (event: PointerEvent) => {
    const role = fingers.get(event.pointerId);
    fingers.delete(event.pointerId);
    if (role === "stick") endStick();
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) surface.addEventListener(type, lift);

  // The bottom-right buttons. PAKAI is the left mouse button, and the finger on it also steers (AC-3, D-118).
  const use = control("touch-use", t(lang, "touch.use"), t(lang, "touch.use"));
  const useLook = dragLook(input);
  hold(
    use,
    (event) => {
      useLook.start(event);
      input.primary(true);
    },
    () => input.primary(false),
    (event) => useLook.move(event),
  );
  const rise = control("touch-rise", t(lang, "controls.rise.action"), "▲");
  hold(rise, () => input.hold("Space", true), () => input.hold("Space", false));
  const dive = control("touch-dive", t(lang, "controls.dive.action"), "▼");
  hold(dive, () => input.hold("ShiftLeft", true), () => input.hold("ShiftLeft", false));
  const interact = control("touch-interact", t(lang, "touch.interact"), t(lang, "touch.interact"));
  hold(interact, () => input.tap("KeyE"), () => {});
  const actions = h("div", { class: "touch-actions" }, rise, dive, interact, use);

  // The tool bar: a tap on a slot picks its tool, as its number key does.
  const slots = SLOTS.map(({ tool, code, label }) => {
    const slot = control("touch-slot", `${label} ${t(lang, `tools.${tool}`)}`, label);
    hold(slot, () => input.tap(code), () => {});
    return { tool, slot };
  });
  const tools = h("div", { class: "touch-tools", role: "group", "aria-label": t(lang, "hud.tool") }, ...slots.map(({ slot }) => slot));

  // The menu buttons are ordinary buttons: they open a menu, with its click sound.
  const pause = h("button", { type: "button", class: "touch-menu-button", "aria-label": t(lang, "touch.pause"), onclick: () => hud.onPause() }, icon(...PAUSE_ICON));
  const logbook = h("button", { type: "button", class: "touch-menu-button", "aria-label": t(lang, "logbook.title"), onclick: () => hud.onLogbook() }, icon(...BOOK_ICON));
  const sound = h("button", { type: "button", class: "touch-menu-button", onclick: () => hud.onMute() });
  const menu = h("div", { class: "touch-menu" }, pause, logbook, sound);

  const element = h("div", { class: "touch" }, surface, stick, tools, actions, menu);
  // A long press must not open the browser's menu over a held button.
  element.addEventListener("contextmenu", (event) => event.preventDefault());

  const setMuted = (muted: boolean) => {
    sound.replaceChildren(icon(...(muted ? MUTED_ICON : SOUND_ICON)));
    sound.setAttribute("aria-label", t(lang, muted ? "touch.unmute" : "touch.mute"));
    sound.setAttribute("aria-pressed", String(muted));
  };
  setMuted(false);

  let onLand: boolean | null = null;
  let current: ToolId | null = null;
  return {
    element,
    setMuted,
    update(state) {
      if (state.onLand !== onLand) {
        onLand = state.onLand;
        for (const part of [tools, rise, dive, use]) part.hidden = onLand;
      }
      if (state.tool !== current) {
        current = state.tool;
        for (const { tool, slot } of slots) slot.setAttribute("aria-pressed", String(tool === current));
      }
    },
    rects() {
      return [menu, tools, rise, dive, interact, use, stick].filter((part) => !part.hidden).map((part) => part.getBoundingClientRect());
    },
  };
}
