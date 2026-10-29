import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import type { TouchInput } from "../../src/game/input";
import type { HudState } from "../../src/game/hud-state";
import { Session } from "../../src/game/session";
import { createHud, type HudView } from "../../src/ui/hud";

function state(overrides: Partial<HudState> = {}): HudState {
  const session = new Session(40);
  return {
    tool: session.tool,
    tank: 0,
    capacity: session.capacity,
    tankFull: false,
    score: 0,
    materials: 0,
    cleanliness: 0,
    objectives: session.objectives,
    notice: null,
    inStationZone: false,
    stationDistance: 37,
    marker: { left: 100, top: 200, onScreen: false, angle: 1 },
    sucking: false,
    cutProgress: 0,
    ...overrides,
  };
}

const AFTER_BLOOM: Partial<HudState> = { phase3: [{ id: "scan", current: 0, target: 7, done: false }] };
const ON_LAND: Partial<HudState> = { land: { onLand: true, canGoAshore: false, canBoard: false, fade: 0 } };

let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock * 1000);
});
afterEach(() => vi.restoreAllMocks());

/** Frames of 50 ms for `seconds`, all with the same state. */
function play(hud: HudView, frame: HudState, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) {
    clock += 0.05;
    hud.update(frame);
  }
}

const slots = (hud: HudView) => [...hud.element.querySelectorAll<HTMLElement>(".hotbar-slot")];
const held = (hud: HudView) => slots(hud).filter((slot) => slot.classList.contains("held")).map((slot) => slot.dataset.tool);
const label = (slot: HTMLElement) => slot.querySelector(".visually-hidden")!.textContent;
const captionShown = (hud: HudView) => hud.element.querySelector(".hotbar-caption")!.classList.contains("shown");

describe("the hotbar (REQ-033)", () => {
  it("shows the four tools in key order, each with its icon and number, in place of the old tool panel (AC-1)", () => {
    const hud = createHud("id");
    hud.update(state());
    expect(slots(hud).map((slot) => slot.dataset.tool)).toEqual(["cutter", "vacuum", "seedLauncher", "scanner"]);
    expect(slots(hud).map((slot) => slot.querySelector(".hotbar-key")!.textContent)).toEqual(["1", "2", "3", "4"]);
    for (const slot of slots(hud)) expect(slot.querySelector("svg.hotbar-icon path")).not.toBeNull();
    expect(hud.element.querySelectorAll(".hud-tool")).toHaveLength(1);
    expect(hud.element.querySelector(".hud-tool")!.classList.contains("hotbar")).toBe(true);
    expect(hud.element.querySelector(".tool-label")).toBeNull();
    // On a computer the cursor is locked to the game, so the slots are not buttons.
    expect(hud.element.querySelector("button")).toBeNull();
  });

  it("frames the tool in hand, moves the frame with the tool, and fills the slot while the tool works (AC-2)", () => {
    const hud = createHud("id");
    hud.update(state());
    expect(held(hud)).toEqual(["vacuum"]);
    hud.update(state({ tool: "cutter" }));
    expect(held(hud)).toEqual(["cutter"]);
    expect(hud.element.querySelector(".hotbar-slot.working")).toBeNull();
    hud.update(state({ tool: "cutter", cutProgress: 0.3 }));
    expect(hud.element.querySelector<HTMLElement>(".hotbar-slot.working")?.dataset.tool).toBe("cutter");
    hud.update(state({ tool: "vacuum", sucking: true }));
    expect(hud.element.querySelector<HTMLElement>(".hotbar-slot.working")?.dataset.tool).toBe("vacuum");
    hud.update(state({ ...AFTER_BLOOM, tool: "scanner", scanProgress: 0.5 }));
    expect(hud.element.querySelector<HTMLElement>(".hotbar-slot.working")?.dataset.tool).toBe("scanner");
    hud.update(state({ ...AFTER_BLOOM, tool: "scanner" }));
    expect(hud.element.querySelector(".hotbar-slot.working")).toBeNull();
  });

  it("shows the name and hint when the dive starts and when the tool changes, then fades them after the set time (AC-3)", () => {
    const hud = createHud("id");
    hud.update(state());
    expect(captionShown(hud)).toBe(true);
    expect(hud.element.querySelector(".tool-name")!.textContent).toBe("Vacuum");
    expect(hud.element.querySelector(".tool-hint")!.textContent).toBe("Tahan klik kiri untuk menyedot sampah");
    play(hud, state(), config.hud.toolCaptionSeconds - 0.2);
    expect(captionShown(hud)).toBe(true);
    play(hud, state(), 0.3);
    expect(captionShown(hud)).toBe(false);

    hud.update(state({ tool: "seedLauncher" }));
    expect(captionShown(hud)).toBe(true);
    expect(hud.element.querySelector(".tool-name")!.textContent).toBe("Seed launcher");
    // A long pause (no frames) does not use up the time: only a frame's worth counts.
    clock += 60;
    hud.update(state({ tool: "seedLauncher" }));
    expect(captionShown(hud)).toBe(true);
    play(hud, state({ tool: "seedLauncher" }), config.hud.toolCaptionSeconds);
    expect(captionShown(hud)).toBe(false);
  });

  it("shows the name and hint again when the player gets back into the submarine, and hides the hotbar on the land (AC-3, AC-5)", () => {
    const hud = createHud("en");
    hud.update(state());
    play(hud, state(), config.hud.toolCaptionSeconds + 0.5);
    expect(captionShown(hud)).toBe(false);
    hud.update(state(ON_LAND));
    expect(hud.element.querySelector<HTMLElement>(".hotbar")!.hidden).toBe(true);
    play(hud, state(ON_LAND), 10);
    hud.update(state());
    expect(hud.element.querySelector<HTMLElement>(".hotbar")!.hidden).toBe(false);
    expect(captionShown(hud)).toBe(true);
    expect(hud.element.querySelector(".tool-hint")!.textContent).toBe("Hold left click to suck up trash");
  });

  it("locks the Scanner until the Bloom, with a lock and words, not colour alone (AC-4, AC-6)", () => {
    const hud = createHud("id");
    hud.update(state());
    const scanner = slots(hud)[3];
    expect(scanner.classList.contains("locked")).toBe(true);
    expect(scanner.querySelector(".hotbar-lock")).not.toBeNull();
    expect(label(scanner)).toBe("4 Scanner, terkunci");
    expect(label(slots(hud)[1])).toBe("2 Vacuum, dipegang");
    expect(label(slots(hud)[0])).toBe("1 Cutter");
    hud.update(state(AFTER_BLOOM));
    expect(scanner.classList.contains("locked")).toBe(false);
    expect(label(scanner)).toBe("4 Scanner");

    const en = createHud("en");
    en.update(state());
    expect(slots(en).map(label)).toEqual(["1 Cutter", "2 Vacuum, in hand", "3 Seed launcher", "4 Scanner, locked"]);
  });

  it("on a phone or tablet a tap on a slot is its number key, the locked Scanner's too, with the touch hint (AC-1, AC-3, AC-4)", () => {
    const taps: string[] = [];
    const input: TouchInput = { stick() {}, hold() {}, tap: (code) => void taps.push(code), primary() {}, look() {}, click() {} };
    const hud = createHud("id", { input, onPause() {}, onLogbook() {}, onMute() {} });
    hud.update(state());
    expect(hud.element.querySelector(".touch-tools")).toBeNull();
    // Buttons here, saying which one is in hand.
    expect(slots(hud).map((slot) => slot.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON"]);
    expect(slots(hud)[1].getAttribute("aria-pressed")).toBe("true");
    for (const index of [2, 3]) {
      slots(hud)[index].dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true, cancelable: true }));
    }
    expect(taps).toEqual(["Digit3", "Digit4"]);
    // The tap is not a menu click.
    const clicks = vi.fn();
    hud.element.addEventListener("click", clicks);
    slots(hud)[0].click();
    expect(clicks).not.toHaveBeenCalled();
    expect(hud.element.querySelector(".tool-hint")!.textContent).toBe("Tahan PAKAI untuk menyedot sampah");
  });
});
