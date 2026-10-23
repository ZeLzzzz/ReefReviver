import { describe, expect, it } from "vitest";
import { Input } from "../../src/game/input";
import type { HudState } from "../../src/game/hud-state";
import { Session } from "../../src/game/session";
import { createHud } from "../../src/ui/hud";
import idStrings from "../../src/i18n/id.json";
import enStrings from "../../src/i18n/en.json";

function state(overrides: Partial<HudState> = {}): HudState {
  const session = new Session(40);
  return {
    tool: session.tool,
    tank: session.tank,
    capacity: session.capacity,
    tankFull: session.tankFull,
    score: session.score,
    materials: session.materials,
    cleanliness: session.cleanliness,
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

function fromSession(session: Session, extra: Partial<HudState> = {}): HudState {
  return state({
    tank: session.tank,
    tankFull: session.tankFull,
    score: session.score,
    materials: session.materials,
    cleanliness: session.cleanliness,
    objectives: session.objectives,
    notice: session.currentNotice,
    ...extra,
  });
}

const text = (el: HTMLElement, selector: string) => el.querySelector(selector)?.textContent;
const goals = (el: HTMLElement) => [...el.querySelectorAll(".goal")].map((g) => g.querySelector(".goal-text")!.textContent);

describe("HUD (REQ-002 AC-1, AC-6)", () => {
  it("shows the crosshair, the tank, score, materials, cleanliness and the active tool", () => {
    const hud = createHud("id");
    hud.update(state());
    expect(hud.element.querySelector(".crosshair")).not.toBeNull();
    expect(text(hud.element, ".stat-tank")).toBe("Tangki0/12");
    expect(text(hud.element, ".stat-score")).toBe("Skor0");
    expect(text(hud.element, ".stat-materials")).toBe("Bahan0");
    expect(text(hud.element, ".stat-cleanliness")).toBe("Kebersihan teluk0%");
    expect(text(hud.element, ".tool-name")).toBe("2 Vacuum");
  });

  it("lists the Phase 1 goals when the dive starts", () => {
    const hud = createHud("id");
    hud.update(state());
    expect(goals(hud.element)).toEqual(["Bersihkan teluk 0%/80%", "Bebaskan satwa 0/2", "Setor sampah ke stasiun"]);
    expect(hud.element.querySelectorAll(".goal.done")).toHaveLength(0);
  });

  it("ticks goals as they are met, with a check mark and a word, not colour alone", () => {
    const session = new Session(40);
    session.trashRemoved = 34;
    session.tank = 3;
    session.deposit();
    const hud = createHud("id");
    hud.update(fromSession(session));
    const done = [...hud.element.querySelectorAll(".goal.done")];
    expect(done.map((g) => g.getAttribute("data-goal"))).toEqual(["clean", "deposit"]);
    expect(done[0].querySelector(".goal-mark")!.textContent).toBe("✓");
    expect(done[0].querySelector(".visually-hidden")!.textContent).toBe("Selesai");
    expect(goals(hud.element)[0]).toBe("Bersihkan teluk 80%/80%");
    const open = hud.element.querySelector('[data-goal="free"]')!;
    expect(open.querySelector(".goal-mark")!.textContent).toBe("○");
    expect(open.querySelector(".visually-hidden")!.textContent).toBe("Belum");
  });

  it("updates the numbers as the state changes", () => {
    const session = new Session(40);
    const hud = createHud("id");
    hud.update(fromSession(session));
    for (let i = 0; i < 3; i++) session.collect();
    hud.update(fromSession(session));
    expect(text(hud.element, ".stat-tank")).toBe("Tangki3/12");
    expect(text(hud.element, ".stat-score")).toBe("Skor30");
    expect(text(hud.element, ".stat-cleanliness")).toBe("Kebersihan teluk7%");
  });
});

describe("full tank (REQ-002 AC-2)", () => {
  it("shows 'Tangki penuh, setor ke stasiun' in text and the station marker with its distance", () => {
    const session = new Session(40);
    for (let i = 0; i < 12; i++) session.collect();
    const hud = createHud("id");
    hud.update(fromSession(session));
    const message = hud.element.querySelector<HTMLElement>(".message-full")!;
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe("Tangki penuh, setor ke stasiun");
    expect(text(hud.element, ".stat-tank")).toBe("Tangki12/12");
    expect(hud.element.querySelector(".station-marker")!.classList.contains("urgent")).toBe(true);
    expect(text(hud.element, ".marker-label")).toBe("Stasiun daur ulang · 37 m");
  });

  it("hides the message again after a deposit", () => {
    const session = new Session(40);
    for (let i = 0; i < 12; i++) session.collect();
    const hud = createHud("id");
    hud.update(fromSession(session));
    session.deposit();
    hud.update(fromSession(session));
    expect(hud.element.querySelector<HTMLElement>(".message-full")!.hidden).toBe(true);
  });
});

describe("station marker", () => {
  it("is placed at the given screen position and rotated toward the station", () => {
    const hud = createHud("en");
    hud.update(state({ marker: { left: 744, top: 225, onScreen: false, angle: Math.PI / 2 } }));
    const marker = hud.element.querySelector<HTMLElement>(".station-marker")!;
    expect(marker.style.transform).toContain("744.0px, 225.0px");
    expect(hud.element.querySelector<HTMLElement>(".marker-arrow")!.style.transform).toBe("rotate(1.571rad)");
    expect(marker.classList.contains("on-screen")).toBe(false);
    hud.update(state({ marker: { left: 300, top: 200, onScreen: true, angle: 0 } }));
    expect(marker.classList.contains("on-screen")).toBe(true);
  });
});

describe("messages (REQ-002 AC-3, AC-4)", () => {
  it("shows the deposit hint only inside the station zone", () => {
    const hud = createHud("id");
    const prompt = hud.element.querySelector<HTMLElement>(".message-prompt")!;
    hud.update(state({ inStationZone: false }));
    expect(prompt.hidden).toBe(true);
    hud.update(state({ inStationZone: true }));
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toBe("Tekan E untuk menyetor sampah");
  });

  it("shows 'Tangki kosong' after pressing E with an empty tank", () => {
    const session = new Session(40);
    session.deposit();
    const hud = createHud("id");
    hud.update(fromSession(session));
    expect(text(hud.element, ".message-notice")).toBe("Tangki kosong");
    expect(text(hud.element, ".stat-materials")).toBe("Bahan0");
  });

  it("shows the materials gained after a deposit, then hides the message", () => {
    const session = new Session(40);
    for (let i = 0; i < 5; i++) session.collect();
    session.deposit();
    const hud = createHud("id");
    hud.update(fromSession(session));
    expect(text(hud.element, ".message-notice")).toBe("Disetor, bahan +5");
    expect(text(hud.element, ".stat-materials")).toBe("Bahan5");
    session.tick(10);
    hud.update(fromSession(session));
    expect(hud.element.querySelector<HTMLElement>(".message-notice")!.hidden).toBe(true);
  });
});

describe("languages (G-004)", () => {
  it("shows English text in an English HUD", () => {
    const session = new Session(40);
    for (let i = 0; i < 12; i++) session.collect();
    const hud = createHud("en");
    hud.update(fromSession(session, { inStationZone: true }));
    expect(text(hud.element, ".message-full")).toBe("Tank full, deposit at the station");
    expect(text(hud.element, ".message-prompt")).toBe("Press E to deposit trash");
    expect(goals(hud.element)).toEqual(["Clean the bay 28%/80%", "Free the animals 0/2", "Deposit trash at the station"]);
    expect(text(hud.element, ".stat-score")).toBe("Score120");
  });

  it("never suggests that trash or plastic goes back to the sea (G-003)", () => {
    const station = Object.entries({ ...idStrings, ...enStrings }).filter(([key]) => /^(hud|station|objectives)\./.test(key));
    for (const [, value] of station) expect(value).not.toMatch(/laut|lepas|kembalikan|\bsea\b|release|return/i);
  });
});

describe("input (REQ-002 AC-1: left click, tool keys, E)", () => {
  function setup() {
    const input = new Input(document);
    const lock = (on: boolean) => Object.defineProperty(document, "pointerLockElement", { value: on ? document.body : null, configurable: true });
    return { input, lock };
  }
  const key = (code: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { code, ...extra }));

  it("holds the left button only while the cursor is locked", () => {
    const { input, lock } = setup();
    lock(false);
    document.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    expect(input.primaryHeld()).toBe(false);
    lock(true);
    document.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    expect(input.primaryHeld()).toBe(true);
    document.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
    expect(input.primaryHeld()).toBe(false);
    lock(false);
  });

  it("ignores the right and middle buttons", () => {
    const { input, lock } = setup();
    lock(true);
    document.dispatchEvent(new MouseEvent("mousedown", { button: 2 }));
    document.dispatchEvent(new MouseEvent("mousedown", { button: 1 }));
    expect(input.primaryHeld()).toBe(false);
    lock(false);
  });

  it("reports a key press once, not on key repeat", () => {
    const { input } = setup();
    key("KeyE");
    key("KeyE", { repeat: true });
    key("KeyE");
    expect(input.takePressed()).toEqual(["KeyE"]);
    expect(input.takePressed()).toEqual([]);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE" }));
    key("KeyE");
    expect(input.takePressed()).toEqual(["KeyE"]);
  });

  it("clear() drops a held button and pending presses", () => {
    const { input, lock } = setup();
    lock(true);
    document.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
    key("Digit2");
    input.clear();
    expect(input.primaryHeld()).toBe(false);
    expect(input.takePressed()).toEqual([]);
    lock(false);
  });
});
