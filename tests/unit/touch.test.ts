import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, type AppDeps } from "../../src/app";
import type { AppAudio, AudioSettings } from "../../src/audio/types";
import { config } from "../../src/config";
import type { CinematicHud } from "../../src/game/cinematic";
import type { HudState } from "../../src/game/hud-state";
import { Input, type TouchInput } from "../../src/game/input";
import { createWalker, stepWalker } from "../../src/game/land";
import { Session } from "../../src/game/session";
import enStrings from "../../src/i18n/en.json";
import { forTouch, strings } from "../../src/i18n/i18n";
import idStrings from "../../src/i18n/id.json";
import { getWebGL2Context, type Orientation } from "../../src/platform";
import { createHud } from "../../src/ui/hud";
import { missionScreen } from "../../src/ui/mission";
import { touchPointerLock } from "../../src/ui/pointer-lock";
import { createTouchControls, type TouchHud } from "../../src/ui/touch";

// REQ-030: playing on a phone or tablet with touch controls.

const { stickRadius, deadZone, lookScale } = config.touch;

function hudState(overrides: Partial<HudState> = {}): HudState {
  const session = new Session(config.trash.count);
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
    stationDistance: 20,
    marker: { left: 100, top: 200, onScreen: false, angle: 1 },
    sucking: false,
    cutProgress: 0,
    ...overrides,
  };
}

/** A touch input that records what the controls send it. */
function recordingInput() {
  const calls: string[] = [];
  const input: TouchInput & { sticks: [number, number][]; looks: [number, number][] } = {
    sticks: [],
    looks: [],
    stick: (x, y) => void input.sticks.push([x, y]),
    hold: (code, down) => void calls.push(`${down ? "down" : "up"} ${code}`),
    tap: (code) => void calls.push(`tap ${code}`),
    primary: (down) => void calls.push(`primary ${down}`),
    look: (dx, dy) => void input.looks.push([dx, dy]),
    click: () => void calls.push("click"),
  };
  return { input, calls };
}

/** jsdom lays nothing out: the controls' picture is given an 800 × 360 box here. */
function controls(hud: Partial<TouchHud> = {}) {
  const { input, calls } = recordingInput();
  const handlers = { onPause: vi.fn(), onLogbook: vi.fn(), onMute: vi.fn() };
  const view = createTouchControls("id", { input, ...handlers, ...hud });
  document.body.replaceChildren(view.element);
  const surface = view.element.querySelector<HTMLElement>(".touch-surface")!;
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 360, width: 800, height: 360, x: 0, y: 0, toJSON() {} });
  return { view, input, calls, surface, handlers, find: (selector: string) => view.element.querySelector<HTMLElement>(selector)! };
}

const pointer = (target: Element, type: string, pointerId: number, clientX = 0, clientY = 0) =>
  target.dispatchEvent(new PointerEvent(type, { pointerId, clientX, clientY, bubbles: true, cancelable: true }));

describe("touch input feeds the same state as the keyboard and mouse (AC-2, AC-3)", () => {
  it("adds the joystick to WASD, limited to full speed", () => {
    const input = new Input(document);
    input.stick(0.4, 0.5);
    expect(input.move()).toEqual({ forward: 0.5, strafe: 0.4, rise: 0 });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(input.move().forward).toBe(1);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
  });

  it("holds ▲/▼ as Space and Shift, taps keys once, and counts PAKAI as the left button", () => {
    const input = new Input(document);
    input.hold("Space", true);
    expect(input.move().rise).toBe(1);
    input.hold("Space", false);
    input.hold("ShiftLeft", true);
    expect(input.move().rise).toBe(-1);
    input.hold("ShiftLeft", false);
    input.tap("KeyE");
    input.tap("Digit3");
    expect(input.takePressed()).toEqual(["Space", "ShiftLeft", "KeyE", "Digit3"]);
    input.primary(true);
    expect(input.primaryHeld()).toBe(true);
    input.primary(false);
    expect(input.primaryHeld()).toBe(false);
    input.click();
    expect(input.takeClicks()).toBe(2);
  });

  it("adds drags to the mouse movement, and forgets everything on clear()", () => {
    const input = new Input(document);
    input.look(10, -4);
    input.look(5, 0);
    expect(input.takeMouse()).toEqual([15, -4]);
    input.stick(1, 0);
    input.primary(true);
    input.clear();
    expect(input.move()).toEqual({ forward: 0, strafe: 0, rise: 0 });
    expect(input.primaryHeld()).toBe(false);
  });

  it("walks slower with the joystick pushed half way, and still at full speed with two keys (AC-2)", () => {
    const walk = (forward: number, strafe: number) => {
      const walker = createWalker(-140, 0, -Math.PI / 2);
      const start = walker.position.clone();
      stepWalker(walker, { forward, strafe, rise: 0 }, 0.1);
      // Along the ground: the height follows the sand, which is not what the speed is about.
      return Math.hypot(walker.position.x - start.x, walker.position.z - start.z);
    };
    const full = walk(1, 0);
    expect(full).toBeGreaterThan(0);
    expect(walk(0.5, 0)).toBeCloseTo(full / 2, 3);
    expect(walk(1, 1)).toBeCloseTo(full, 3);
  });
});

describe("the joystick and the drag (AC-2)", () => {
  beforeEach(() => document.body.replaceChildren());

  it("puts the joystick under a finger on the left half; further is faster, up to full speed", () => {
    const { input, surface, find } = controls();
    pointer(surface, "pointerdown", 1, 100, 250);
    expect(find(".stick").classList.contains("active")).toBe(true);
    pointer(surface, "pointermove", 1, 100, 250 - stickRadius / 2);
    const [x, half] = input.sticks.at(-1)!;
    expect(x).toBeCloseTo(0);
    expect(half).toBeCloseTo((0.5 - deadZone) / (1 - deadZone));
    pointer(surface, "pointermove", 1, 100 + stickRadius * 3, 250);
    expect(input.sticks.at(-1)![0]).toBeCloseTo(1);
    // A little play around the centre does nothing.
    pointer(surface, "pointermove", 1, 100 + stickRadius * deadZone * 0.5, 250);
    expect(input.sticks.at(-1)).toEqual([0, 0]);
    pointer(surface, "pointerup", 1, 100, 250);
    expect(input.sticks.at(-1)).toEqual([0, 0]);
    expect(find(".stick").classList.contains("active")).toBe(false);
  });

  it("steers with a finger on the right half, at the same time as the joystick", () => {
    const { input, surface } = controls();
    pointer(surface, "pointerdown", 1, 100, 250);
    pointer(surface, "pointerdown", 2, 600, 150);
    pointer(surface, "pointermove", 2, 620, 140);
    pointer(surface, "pointermove", 1, 100, 250 - stickRadius);
    expect(input.looks).toEqual([[20 * lookScale, -10 * lookScale]]);
    expect(input.sticks.at(-1)![1]).toBeCloseTo(1);
  });

  it("lets go of the joystick when the browser cancels the touch (AC-6)", () => {
    const { input, surface } = controls();
    pointer(surface, "pointerdown", 1, 100, 250);
    pointer(surface, "pointermove", 1, 100, 150);
    pointer(surface, "pointercancel", 1);
    expect(input.sticks.at(-1)).toEqual([0, 0]);
  });

  it("counts any touch on the picture as a click, which skips a cinematic (AC-4)", () => {
    const { calls, surface } = controls();
    pointer(surface, "pointerdown", 1, 600, 150);
    pointer(surface, "pointerup", 1, 600, 150);
    expect(calls).toEqual(["click"]);
  });
});

describe("the buttons (AC-3, AC-4)", () => {
  beforeEach(() => document.body.replaceChildren());

  it("holds PAKAI as the left button, and steers with the finger on it", () => {
    const { input, calls, find } = controls();
    const use = find(".touch-use");
    expect(use.textContent).toBe("PAKAI");
    pointer(use, "pointerdown", 3, 700, 300);
    pointer(use, "pointermove", 3, 690, 300);
    pointer(use, "pointercancel", 3);
    expect(calls).toEqual(["primary true", "primary false"]);
    expect(input.looks).toEqual([[-10 * lookScale, 0]]);
  });

  it("holds ▲ and ▼ as Space and Shift and taps E as its key (the tool slots are the HUD's hotbar, REQ-033)", () => {
    const { calls, find } = controls();
    for (const selector of [".touch-rise", ".touch-dive"]) {
      pointer(find(selector), "pointerdown", 4);
      pointer(find(selector), "pointerup", 4);
    }
    pointer(find(".touch-interact"), "pointerdown", 5);
    pointer(find(".touch-interact"), "pointerup", 5);
    expect(calls).toEqual(["down Space", "up Space", "down ShiftLeft", "up ShiftLeft", "tap KeyE"]);
  });

  it("on the land hides ▲/▼ and PAKAI but keeps E", () => {
    const { view, find } = controls();
    view.update({ onLand: true });
    for (const selector of [".touch-rise", ".touch-dive", ".touch-use"]) expect(find(selector).hidden).toBe(true);
    expect(find(".touch-interact").hidden).toBe(false);
    view.update({ onLand: false });
    expect(find(".touch-use").hidden).toBe(false);
  });

  it("does not let a game control's tap reach the menu's click sound", () => {
    const { view } = controls();
    const heard = vi.fn();
    view.element.addEventListener("click", heard);
    for (const control of view.element.querySelectorAll<HTMLElement>(".touch-control")) control.click();
    expect(heard).not.toHaveBeenCalled();
    view.element.querySelector<HTMLElement>(".touch-menu-button")!.click();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("pauses, opens the Logbook and mutes from the buttons beside the minimap, with labels for screen readers", () => {
    const { view, handlers } = controls();
    const [pause, logbook, sound] = view.element.querySelectorAll<HTMLButtonElement>(".touch-menu-button");
    expect([pause, logbook, sound].map((b) => b.getAttribute("aria-label"))).toEqual(["Jeda", "Marine Logbook", "Matikan suara"]);
    pause.click();
    logbook.click();
    sound.click();
    expect(handlers.onPause).toHaveBeenCalledTimes(1);
    expect(handlers.onLogbook).toHaveBeenCalledTimes(1);
    expect(handlers.onMute).toHaveBeenCalledTimes(1);
    view.setMuted(true);
    expect(sound.getAttribute("aria-label")).toBe("Nyalakan suara");
    expect(sound.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("touch wording (AC-5)", () => {
  it("reads a text's touch wording on a phone, the keyboard wording on a computer", () => {
    expect(forTouch("hud.depositPrompt", true)).toBe("hud.depositPrompt.touch");
    expect(forTouch("hud.depositPrompt", false)).toBe("hud.depositPrompt");
    // A text with no keys in it has no touch wording.
    expect(forTouch("hud.tankFull", true)).toBe("hud.tankFull");
  });

  it("has a touch wording, in both languages, for every text that names a key or the mouse", () => {
    const keyboardWords = /\b(Tekan|Press|klik|click|Klik|Click|Spasi|Space|Esc|Mouse|WASD|tombol 4|key 4)\b/;
    for (const lang of ["id", "en"] as const) {
      for (const [key, text] of Object.entries(strings[lang])) {
        if (key.endsWith(".touch") || key.endsWith("lockFailed") || !keyboardWords.test(text)) continue;
        expect(`${key}.touch` in idStrings, `${lang} ${key}`).toBe(true);
        expect(`${key}.touch` in enStrings, `${lang} ${key}`).toBe(true);
      }
    }
  });

  it("shows the touch hints in the HUD: tool hints, prompts and the cinematic's skip hint", () => {
    const { input } = recordingInput();
    const hud = createHud("id", { input, onPause() {}, onLogbook() {}, onMute() {} });
    hud.update(hudState({ inStationZone: true }));
    expect(hud.element.querySelector(".tool-hint")?.textContent).toBe("Tahan PAKAI untuk menyedot sampah");
    expect(hud.element.querySelector(".message-prompt")?.textContent).toBe("Ketuk E untuk menyetor sampah");
    expect(hud.element.querySelector(".cine-skip")?.textContent).toBe("Ketuk untuk melewati");
    expect(hud.element.querySelector(".touch")).not.toBeNull();
    const en = createHud("en", { input, onPause() {}, onLogbook() {}, onMute() {} });
    en.update(hudState({ land: { onLand: true, canGoAshore: false, canBoard: true, fade: 0 } }));
    expect(en.element.querySelector(".message-prompt")?.textContent).toBe("Tap E to board the mini submarine");
  });

  it("keeps the keyboard texts and no touch controls on a computer (AC-8)", () => {
    const hud = createHud("id");
    hud.update(hudState({ inStationZone: true }));
    expect(hud.element.querySelector(".tool-hint")?.textContent).toBe("Tahan klik kiri untuk menyedot sampah");
    expect(hud.element.querySelector(".message-prompt")?.textContent).toBe("Tekan E untuk menyetor sampah");
    expect(hud.element.querySelector(".touch")).toBeNull();
  });

  it("names the touch controls on the mission card", () => {
    const card = missionScreen({ lang: "en", notice: null, onStart() {}, touch: true });
    expect(card.querySelector(".mission-controls")?.textContent).toBe(enStrings["mission.controls.touch"]);
  });
});

describe("no cursor to lock on a phone (AC-1)", () => {
  it("counts as locked at once and asks for the full screen; leaving tells the app", async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    document.documentElement.requestFullscreen = requestFullscreen;
    const lock = touchPointerLock(document);
    const changes: boolean[] = [];
    lock.onChange((locked) => changes.push(locked));
    expect(await lock.request()).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    lock.exit();
    expect(changes).toEqual([true, false]);
  });

  it("goes on when the browser refuses the full screen, or has none", async () => {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.reject(new Error("denied")));
    expect(await touchPointerLock(document).request()).toBe(true);
    document.documentElement.requestFullscreen = vi.fn(() => {
      throw new Error("not allowed");
    });
    expect(await touchPointerLock(document).request()).toBe(true);
    (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen = undefined;
    expect(await touchPointerLock(document).request()).toBe(true);
  });
});

describe("a lighter picture on a phone (AC-7)", () => {
  it("asks for a context without antialiasing", () => {
    const canvas = document.createElement("canvas");
    const getContext = vi.fn(() => null);
    canvas.getContext = getContext as unknown as HTMLCanvasElement["getContext"];
    getWebGL2Context(canvas, false);
    getWebGL2Context(canvas);
    expect(getContext.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
      { antialias: false, powerPreference: "high-performance" },
      { antialias: true, powerPreference: "high-performance" },
    ]);
    expect(config.touch.antialias).toBe(false);
    expect(config.touch.pixelRatio).toBeLessThanOrEqual(1);
  });
});

describe("the app on a phone or tablet (AC-1, AC-4, AC-6)", () => {
  function fakeAudio() {
    const settings: AudioSettings = { music: 0.6, effects: 0.8, muted: false };
    return {
      available: true,
      settings,
      unlock: vi.fn(),
      start: vi.fn(),
      setPhase: vi.fn(),
      setInactive: vi.fn(),
      setMuted: vi.fn((muted: boolean) => void (settings.muted = muted)),
      setMusicVolume: vi.fn(),
      setEffectsVolume: vi.fn(),
      play: vi.fn(),
    } satisfies AppAudio & Record<string, unknown>;
  }

  function fakeOrientation(portrait = false) {
    const listeners: (() => void)[] = [];
    const orientation: Orientation & { turn(portrait: boolean): void } = {
      portrait: () => portrait,
      onChange: (listener) => void listeners.push(listener),
      turn(next) {
        portrait = next;
        for (const listener of listeners) listener();
      },
    };
    return orientation;
  }

  function setup(overrides: Partial<AppDeps> = {}) {
    document.body.innerHTML = '<div id="ui"></div>';
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
    const ui = document.querySelector<HTMLElement>("#ui")!;
    const input = new Input(document);
    let cinematic: CinematicHud | null = null;
    const game = {
      play: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      onHud: vi.fn(),
      onEnd: vi.fn(),
      onOpeningEnd: vi.fn(),
      cinematic: () => cinematic,
      touchInput: () => input,
    };
    const audio = fakeAudio();
    const orientation = fakeOrientation();
    const app = new App({
      ui,
      browserLanguages: ["id-ID"],
      storage: null,
      phoneOrTablet: true,
      orientation,
      getWebGL2: () => ({}) as WebGL2RenderingContext,
      createGame: () => game,
      pointerLock: touchPointerLock(document),
      audio,
      ...overrides,
    });
    app.boot();
    const tap = async (name: string) => {
      const button = [...ui.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
      if (!button) throw new Error(`No button "${name}"`);
      button.click();
      await Promise.resolve();
    };
    return { app, ui, game, audio, orientation, tap, setCinematic: (state: CinematicHud | null) => (cinematic = state) };
  }

  it("opens on the title screen instead of 'Mainkan di komputer', and Mulai starts the dive with the touch controls", async () => {
    const { app, ui, game, tap } = setup();
    expect(app.screen).toBe("title");
    expect(document.documentElement.classList.contains("touch")).toBe(true);
    await tap("Mulai");
    expect(game.play).toHaveBeenCalledTimes(1);
    expect(app.screen).toBe("playing");
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    expect(ui.querySelector(".hud .touch")).not.toBeNull();
  });

  it("pauses from the pause button, and Lanjut resumes without a cursor to lock", async () => {
    const { app, game, tap } = setup();
    await tap("Mulai");
    await tap("Jeda");
    expect(app.screen).toBe("paused");
    expect(game.pause).toHaveBeenCalled();
    await tap("Lanjut");
    expect(app.screen).toBe("playing");
    expect(game.resume).toHaveBeenCalled();
  });

  it("names the touch controls in the pause menu's Controls list", async () => {
    const { ui, tap } = setup();
    await tap("Mulai");
    await tap("Jeda");
    await tap("Kontrol");
    const keys = [...ui.querySelectorAll(".controls kbd")].map((k) => k.textContent);
    expect(keys).toEqual(["Joystick", "▲", "▼", "Geser layar", "PAKAI", "1", "2", "3", "4", "E", "Tombol buku", "Tombol suara", "Tombol jeda"]);
  });

  it("opens the Logbook from its button (not during a cinematic) and closes it with Tutup", async () => {
    const { app, ui, tap, setCinematic } = setup();
    await tap("Mulai");
    setCinematic({ kind: "opening", caption: null, captionOpacity: 0, letterbox: 1 });
    await tap("Marine Logbook");
    expect(app.screen).toBe("playing");
    setCinematic(null);
    await tap("Marine Logbook");
    expect(app.screen).toBe("logbook");
    expect(ui.querySelector(".logbook-hint")?.textContent).toBe("Ketuk Tutup untuk kembali bermain");
    await tap("Tutup");
    expect(app.screen).toBe("playing");
  });

  it("mutes and unmutes from the sound button, as M does", async () => {
    const { ui, audio, tap } = setup();
    await tap("Mulai");
    await tap("Matikan suara");
    expect(audio.settings.muted).toBe(true);
    expect(ui.querySelector<HTMLElement>(".sound-off")!.hidden).toBe(false);
    await tap("Nyalakan suara");
    expect(audio.settings.muted).toBe(false);
  });

  it("held upright, covers the game with the rotate message and pauses; turned back, the pause menu is there (AC-6)", async () => {
    const { app, ui, game, orientation, tap } = setup();
    await tap("Mulai");
    orientation.turn(true);
    expect(app.screen).toBe("paused");
    expect(game.pause).toHaveBeenCalled();
    expect(ui.querySelector(".rotate-screen h1")?.textContent).toBe("Putar perangkat ke posisi mendatar");
    orientation.turn(false);
    expect(ui.querySelector(".rotate-screen")).toBeNull();
    expect(ui.querySelector(".pause-screen")).not.toBeNull();
    expect(app.screen).toBe("paused");
  });

  it("shows the rotate message over the title screen when opened upright, in the chosen language", () => {
    const orientation = fakeOrientation(true);
    const { ui } = setup({ orientation, browserLanguages: ["en-US"] });
    expect(ui.querySelector(".title-screen")).not.toBeNull();
    expect(ui.querySelector(".rotate-screen h1")?.textContent).toBe("Turn your device sideways");
  });

  it("still explains a browser without WebGL 2 (AC-8)", () => {
    const { app } = setup({ getWebGL2: () => null });
    expect(app.screen).toBe("noWebgl");
  });
});
