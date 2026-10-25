import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app";
import type { AppAudio, AudioSettings } from "../../src/audio/types";
import { config } from "../../src/config";
import type { CinematicHud } from "../../src/game/cinematic";
import type { HudState } from "../../src/game/hud-state";
import { Input } from "../../src/game/input";
import { Session } from "../../src/game/session";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";
import { createHud } from "../../src/ui/hud";
import type { PointerLock } from "../../src/ui/pointer-lock";

const { cinematic } = config;

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

const playing = (overrides: Partial<CinematicHud> = {}): CinematicHud => ({ kind: "opening", caption: null, captionOpacity: 0, letterbox: 1, ...overrides });
const overlay = (el: HTMLElement) => el.querySelector<HTMLElement>(".cine")!;

describe("what the HUD shows during a cinematic (REQ-027 AC-3, REQ-028 AC-3)", () => {
  it("shows nothing of the cinematic when none is playing, and has the crosshair", () => {
    const hud = createHud("id");
    hud.update(hudState({ cinematic: null }));
    expect(overlay(hud.element).hidden).toBe(true);
    expect(hud.element.classList.contains("cinematic")).toBe(false);
    expect(hud.element.querySelector(".crosshair")).not.toBeNull();
  });

  it("marks the HUD as in a cinematic (the stylesheet hides its panels and the crosshair), with the bars and the skip hint", () => {
    const hud = createHud("id");
    hud.update(hudState({ cinematic: playing() }));
    expect(hud.element.classList.contains("cinematic")).toBe(true);
    expect(overlay(hud.element).hidden).toBe(false);
    expect(hud.element.querySelector(".cine-bar-top")).not.toBeNull();
    expect(hud.element.querySelector(".cine-bar-bottom")).not.toBeNull();
    expect(hud.element.querySelector(".cine-skip")?.textContent).toBe("Klik atau Spasi untuk melewati");
  });

  it("says the hint in English too", () => {
    const hud = createHud("en");
    hud.update(hudState({ cinematic: playing() }));
    expect(hud.element.querySelector(".cine-skip")?.textContent).toBe("Click or Space to skip");
  });

  it("makes the bars as high as the config says, and slides them with the letterbox", () => {
    const hud = createHud("id");
    hud.update(hudState({ cinematic: playing({ letterbox: 1 }) }));
    const bar = (side: "top" | "bottom") => parseFloat(hud.element.querySelector<HTMLElement>(`.cine-bar-${side}`)!.style.height);
    expect(bar("top")).toBeCloseTo(cinematic.letterbox * 100, 5);
    expect(bar("bottom")).toBeCloseTo(cinematic.letterbox * 100, 5);
    hud.update(hudState({ cinematic: playing({ letterbox: 0.5 }) }));
    expect(bar("top")).toBeCloseTo(cinematic.letterbox * 50, 5);
    hud.update(hudState({ cinematic: playing({ letterbox: 0 }) }));
    expect(bar("top")).toBe(0);
  });

  it("writes the narration in the chosen language and fades it by its opacity", () => {
    for (const [lang, strings] of [["id", idStrings], ["en", enStrings]] as const) {
      const hud = createHud(lang);
      hud.update(hudState({ cinematic: playing({ caption: "cinematic.opening.2", captionOpacity: 0.5 }) }));
      const caption = hud.element.querySelector<HTMLElement>(".cine-caption")!;
      expect(caption.textContent).toBe(strings["cinematic.opening.2"]);
      expect(Number(caption.style.opacity)).toBeCloseTo(0.5, 5);
    }
  });

  it("keeps a line on the screen while it fades out, and empties nothing between lines", () => {
    const hud = createHud("id");
    hud.update(hudState({ cinematic: playing({ caption: "cinematic.opening.3", captionOpacity: 1 }) }));
    hud.update(hudState({ cinematic: playing({ caption: null, captionOpacity: 0 }) }));
    const caption = hud.element.querySelector<HTMLElement>(".cine-caption")!;
    expect(Number(caption.style.opacity)).toBe(0);
    expect(caption.textContent).toBe("Saatnya memulihkannya.");
  });

  it("goes back to the plain HUD when the cinematic is over", () => {
    const hud = createHud("id");
    hud.update(hudState({ cinematic: playing() }));
    hud.update(hudState({ cinematic: null }));
    expect(hud.element.classList.contains("cinematic")).toBe(false);
    expect(overlay(hud.element).hidden).toBe(true);
  });

  it("darkens the screen by the fade (a skip, or the opening coming up from black)", () => {
    const hud = createHud("id");
    hud.update(hudState({ land: { onLand: false, canGoAshore: false, canBoard: false, fade: 0.6 } }));
    expect(Number(hud.element.querySelector<HTMLElement>(".hud-fade")!.style.opacity)).toBeCloseTo(0.6, 5);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const lock: PointerLock & { locked: boolean; set(locked: boolean): void } = (() => {
  const listeners: ((locked: boolean) => void)[] = [];
  const self = {
    locked: false,
    set(locked: boolean) {
      if (self.locked === locked) return;
      self.locked = locked;
      for (const listener of listeners) listener(locked);
    },
    request: async () => {
      self.set(true);
      return true;
    },
    exit: () => self.set(false),
    onChange: (listener: (locked: boolean) => void) => void listeners.push(listener),
  };
  return self;
})();

function setup(cinematicNow: () => CinematicHud | null) {
  document.body.innerHTML = '<div id="ui"></div>';
  const ui = document.querySelector<HTMLElement>("#ui")!;
  lock.locked = false;
  const game = { play: vi.fn(), pause: vi.fn(), resume: vi.fn(), onHud: vi.fn(), onEnd: vi.fn(), cinematic: vi.fn(cinematicNow) };
  const settings: AudioSettings = { music: 0.6, effects: 0.8, muted: false };
  const audio = {
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
  const app = new App({ ui, browserLanguages: ["id-ID"], storage: null, phoneOrTablet: false, getWebGL2: () => ({}) as WebGL2RenderingContext, createGame: () => game, pointerLock: lock, audio });
  void app.boot();
  return { app, ui, game, audio };
}

const click = async (ui: HTMLElement, text: string) => {
  [...ui.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  await Promise.resolve();
  await Promise.resolve();
};
const press = (code: string) => window.dispatchEvent(new KeyboardEvent("keydown", { code }));

describe("the keys during a cinematic (REQ-027 AC-4, AC-7)", () => {
  beforeEach(() => {
    document.documentElement.lang = "";
  });

  it("L does not open the Logbook while one plays, and does once it is over", async () => {
    let now: CinematicHud | null = playing();
    const { app, game } = setup(() => now);
    await click(document.querySelector<HTMLElement>("#ui")!, "Mulai");
    expect(app.screen).toBe("playing");
    press("KeyL");
    expect(app.screen).toBe("playing");
    expect(game.pause).not.toHaveBeenCalled();
    now = null;
    press("KeyL");
    expect(app.screen).toBe("logbook");
  });

  it("M still turns the sound off and on", async () => {
    const { ui, audio } = setup(() => playing());
    await click(ui, "Mulai");
    press("KeyM");
    expect(audio.setMuted).toHaveBeenLastCalledWith(true);
    press("KeyM");
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
  });

  it("builds the HUD with the cinematic already showing when the dive starts, before the game has published a state", async () => {
    const { ui } = setup(() => playing({ caption: "cinematic.opening.1", captionOpacity: 1 }));
    await click(ui, "Mulai");
    expect(ui.querySelector(".hud")?.classList.contains("cinematic")).toBe(true);
    expect(ui.querySelector<HTMLElement>(".cine")!.hidden).toBe(false);
  });

  it("Esc pauses it with the game and shows the pause menu; Lanjut brings the HUD back with the cinematic", async () => {
    const { app, ui, game } = setup(() => playing());
    await click(ui, "Mulai");
    press("Escape");
    expect(game.pause).toHaveBeenCalledOnce();
    expect(app.screen).toBe("paused");
    expect(ui.querySelector(".hud")).toBeNull();
    await click(ui, "Lanjut");
    expect(game.resume).toHaveBeenCalledOnce();
    expect(app.screen).toBe("playing");
    expect(ui.querySelector(".hud")?.classList.contains("cinematic")).toBe(true);
  });

  it("losing the cursor, as leaving the tab does, pauses it too", async () => {
    const { app, ui, game } = setup(() => playing());
    await click(ui, "Mulai");
    lock.set(false);
    expect(game.pause).toHaveBeenCalledOnce();
    expect(app.screen).toBe("paused");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("the clicks and Space that skip (REQ-027 AC-4)", () => {
  function inputWithLock(locked: boolean) {
    Object.defineProperty(document, "pointerLockElement", { value: locked ? document.body : null, configurable: true });
    return new Input(document);
  }
  const mouse = (type: string, button = 0) => document.dispatchEvent(new MouseEvent(type, { button }));
  const key = (type: "keydown" | "keyup", code: string, repeat = false) => window.dispatchEvent(new KeyboardEvent(type, { code, repeat }));

  it("counts a press of the left button while the cursor is locked, once, and not one made without the lock", () => {
    const input = inputWithLock(true);
    mouse("mousedown");
    mouse("mouseup");
    mouse("mousedown");
    mouse("mouseup");
    mouse("mousedown", 2);
    expect(input.takeClicks()).toBe(2);
    expect(input.takeClicks()).toBe(0);
    const unlocked = inputWithLock(false);
    mouse("mousedown");
    expect(unlocked.takeClicks()).toBe(0);
  });

  it("forgets the clicks when it is cleared", () => {
    const input = inputWithLock(true);
    mouse("mousedown");
    input.clear();
    expect(input.takeClicks()).toBe(0);
    mouse("mouseup");
  });

  it("does not count the Space that skipped as a press of the submarine's rise, even as the key repeats, until it is let go", () => {
    const input = inputWithLock(true);
    key("keydown", "Space");
    expect(input.takePressed()).toEqual(["Space"]);
    input.ignoreUntilReleased("Space");
    input.clear();
    key("keydown", "Space", true);
    key("keydown", "Space", true);
    expect(input.move().rise).toBe(0);
    expect(input.takePressed()).toEqual([]);
    key("keyup", "Space");
    key("keydown", "Space");
    expect(input.move().rise).toBe(1);
    expect(input.takePressed()).toEqual(["Space"]);
    key("keyup", "Space");
  });

  it("does not ignore the next Space when the key was already up", () => {
    const input = inputWithLock(true);
    key("keydown", "Space");
    key("keyup", "Space");
    input.ignoreUntilReleased("Space");
    input.clear();
    key("keydown", "Space");
    expect(input.takePressed()).toEqual(["Space"]);
    key("keyup", "Space");
  });
});
