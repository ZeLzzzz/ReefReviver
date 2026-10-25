import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, type AppDeps } from "../../src/app";
import type { AppAudio, AudioSettings, Phase } from "../../src/audio/types";
import { credits } from "../../src/credits";
import { config } from "../../src/config";
import idStrings from "../../src/i18n/id.json";
import enStrings from "../../src/i18n/en.json";
import { createHud } from "../../src/ui/hud";
import type { PointerLock } from "../../src/ui/pointer-lock";

/** An audio double that remembers what the screens asked of it and keeps the settings like the real engine. */
function fakeAudio(available = true) {
  const settings: AudioSettings = { music: config.audio.volume.music, effects: config.audio.volume.effects, muted: false };
  const phases: Phase[] = [];
  const audio = {
    available,
    settings,
    unlock: vi.fn(),
    start: vi.fn(),
    setPhase: vi.fn((phase: Phase) => void phases.push(phase)),
    setInactive: vi.fn(),
    setMuted: vi.fn((muted: boolean) => void (settings.muted = muted)),
    setMusicVolume: vi.fn((v: number) => void (settings.music = v)),
    setEffectsVolume: vi.fn((v: number) => void (settings.effects = v)),
    play: vi.fn(),
  } satisfies AppAudio & Record<string, unknown>;
  return { audio, phases };
}

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

function setup(overrides: Partial<AppDeps> = {}, available = true) {
  document.body.innerHTML = '<div id="ui"></div>';
  const ui = document.querySelector<HTMLElement>("#ui")!;
  lock.locked = false;
  const game = { play: vi.fn(), pause: vi.fn(), resume: vi.fn(), onHud: vi.fn(), onEnd: vi.fn() };
  const { audio, phases } = fakeAudio(available);
  const app = new App({
    ui,
    browserLanguages: ["id-ID"],
    storage: null,
    phoneOrTablet: false,
    getWebGL2: () => ({}) as WebGL2RenderingContext,
    createGame: () => game,
    pointerLock: lock,
    audio,
    ...overrides,
  });
  void app.boot();
  return { app, ui, game, audio, phases };
}

const buttons = (ui: HTMLElement) => [...ui.querySelectorAll("button")].map((b) => b.textContent);
const click = async (ui: HTMLElement, text: string) => {
  const target = [...ui.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!target) throw new Error(`No button "${text}" in: ${buttons(ui).join(", ")}`);
  target.click();
  await Promise.resolve();
  await Promise.resolve();
};
const press = (code: string, repeat = false) => window.dispatchEvent(new KeyboardEvent("keydown", { code, repeat }));

async function startPlaying() {
  const env = setup();
  await click(env.ui, "Mulai");
  return env;
}

beforeEach(() => {
  document.documentElement.lang = "";
});

describe("Mulai (REQ-026 AC-1)", () => {
  it("starts the music and ambience when Mulai is pressed, and not before", async () => {
    const { ui, audio } = setup();
    expect(audio.start).not.toHaveBeenCalled();
    await click(ui, "Mulai");
    expect(audio.start).toHaveBeenCalledOnce();
  });

  it("starts the sound inside the click, before the cursor lock is answered, so the browser counts it as the player's own", async () => {
    const order: string[] = [];
    const { ui, audio } = setup({
      pointerLock: { ...lock, request: async () => (order.push("lock"), true) },
    });
    audio.start.mockImplementation(() => void order.push("sound"));
    await click(ui, "Mulai");
    expect(order).toEqual(["sound", "lock"]);
  });

  it("does not start the sound for the other title buttons, only clicks them", async () => {
    const { ui, audio } = setup();
    await click(ui, "Kredit");
    expect(audio.start).not.toHaveBeenCalled();
    expect(audio.unlock).toHaveBeenCalled();
  });
});

describe("menu clicks (REQ-026 AC-3)", () => {
  it("every button click sounds and unlocks the sound", async () => {
    const { ui, audio } = setup();
    await click(ui, "Kredit");
    await click(ui, "Kembali");
    expect(audio.play.mock.calls.map(([name]) => name)).toEqual(["click", "click"]);
    expect(audio.unlock).toHaveBeenCalledTimes(2);
  });

  it("does not click for something that is not a button", async () => {
    const { ui, audio } = setup();
    ui.querySelector("h1")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("works without any sound at all", async () => {
    const { ui } = setup({ audio: undefined });
    await expect(click(ui, "Kredit")).resolves.toBeUndefined();
  });
});

describe("M (REQ-026 AC-5)", () => {
  it("mutes while playing, shows the tag, and unmutes with a second press", async () => {
    const { ui, audio } = await startPlaying();
    expect(ui.querySelector(".sound-off")!.hasAttribute("hidden")).toBe(true);
    press("KeyM");
    expect(audio.setMuted).toHaveBeenLastCalledWith(true);
    const tag = ui.querySelector<HTMLElement>(".sound-off")!;
    expect(tag.hidden).toBe(false);
    expect(tag.textContent).toBe("Suara mati");
    press("KeyM");
    expect(audio.setMuted).toHaveBeenLastCalledWith(false);
    expect(ui.querySelector<HTMLElement>(".sound-off")!.hidden).toBe(true);
  });

  it("does nothing on the title screen or in the pause menu, and ignores a held key", async () => {
    const { ui, audio } = setup();
    press("KeyM");
    await click(ui, "Mulai");
    press("KeyM", true);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    press("KeyM");
    expect(audio.setMuted).not.toHaveBeenCalled();
  });

  it("keeps the tag when the HUD is drawn again, e.g. after pausing and resuming", async () => {
    const { ui, app } = await startPlaying();
    press("KeyM");
    app.pause();
    await click(ui, "Lanjut");
    expect(ui.querySelector<HTMLElement>(".sound-off")!.hidden).toBe(false);
  });

  it("keeps the mute in the settings the game does not own, so it survives Main lagi (AC-6)", async () => {
    const { ui, audio, app } = await startPlaying();
    press("KeyM");
    app.pause();
    await click(ui, "Lanjut");
    expect(audio.settings.muted).toBe(true);
  });

  it("is in the Controls list in both languages", async () => {
    const { ui } = await startPlaying();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    await click(ui, "Kontrol");
    const rows = [...ui.querySelectorAll("dt")].map((dt) => `${dt.textContent} = ${dt.nextElementSibling?.textContent}`);
    expect(rows).toContain("M = Matikan atau nyalakan suara");
    expect(enStrings["controls.mute.keys"]).toBe("M");
    expect(enStrings["controls.mute.action"]).toBeTruthy();
  });
});

describe("the HUD tag (REQ-026 AC-5, G-004)", () => {
  it.each([
    ["id", idStrings["hud.muted"], "Suara mati"],
    ["en", enStrings["hud.muted"], "Sound off"],
  ] as const)("says %s: %s", (lang, text, expected) => {
    const hud = createHud(lang);
    expect(hud.element.querySelector<HTMLElement>(".sound-off")!.hidden).toBe(true);
    hud.setMuted(true);
    expect(hud.element.querySelector(".sound-off")?.textContent).toBe(expected);
    expect(text).toBe(expected);
    hud.setMuted(false);
    expect(hud.element.querySelector<HTMLElement>(".sound-off")!.hidden).toBe(true);
  });
});

describe("the Sound view (REQ-026 AC-6)", () => {
  async function openSound() {
    const env = await startPlaying();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    await click(env.ui, "Suara");
    return env;
  }
  const slider = (ui: HTMLElement, id: string) => ui.querySelector<HTMLInputElement>(`#${id}`)!;
  const drag = (input: HTMLInputElement, value: number) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("has a music and an effects slider from 0 to 100 %, starting at 60 and 80", async () => {
    const { ui } = await openSound();
    const music = slider(ui, "volume-music");
    const effects = slider(ui, "volume-effects");
    for (const input of [music, effects]) {
      expect(input.type).toBe("range");
      expect(input.min).toBe("0");
      expect(input.max).toBe("100");
    }
    expect(music.value).toBe("60");
    expect(effects.value).toBe("80");
    expect([...ui.querySelectorAll("output")].map((o) => o.textContent)).toEqual(["60%", "80%"]);
    expect([...ui.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["Musik", "Efek suara"]);
  });

  it("applies the volume as the slider moves, and shows the percentage", async () => {
    const { ui, audio } = await openSound();
    drag(slider(ui, "volume-music"), 25);
    expect(audio.setMusicVolume).toHaveBeenLastCalledWith(0.25);
    expect(ui.querySelector("output")!.textContent).toBe("25%");
    drag(slider(ui, "volume-effects"), 100);
    expect(audio.setEffectsVolume).toHaveBeenLastCalledWith(1);
    drag(slider(ui, "volume-music"), 0);
    expect(audio.setMusicVolume).toHaveBeenLastCalledWith(0);
  });

  it("shows the volumes as they are set when the view is opened again", async () => {
    const { ui } = await openSound();
    drag(slider(ui, "volume-music"), 30);
    await click(ui, "Kembali");
    await click(ui, "Suara");
    expect(slider(ui, "volume-music").value).toBe("30");
  });

  it("clicks when the effects slider is let go, so the new level can be heard", async () => {
    const { ui, audio } = await openSound();
    audio.play.mockClear();
    slider(ui, "volume-effects").dispatchEvent(new Event("change", { bubbles: true }));
    expect(audio.play).toHaveBeenCalledWith("click");
  });

  it("goes back to the pause menu with Kembali or Esc", async () => {
    const { ui } = await openSound();
    await click(ui, "Kembali");
    expect(buttons(ui)).toEqual(["Lanjut", "Kontrol", "Suara", "Bahasa"]);
    await click(ui, "Suara");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(buttons(ui)).toEqual(["Lanjut", "Kontrol", "Suara", "Bahasa"]);
  });

  it("is in English too, with the same keys in both languages", async () => {
    const { ui } = await openSound();
    await click(ui, "Kembali");
    await click(ui, "Bahasa");
    await click(ui, "English");
    await click(ui, "Back");
    await click(ui, "Sound");
    expect([...ui.querySelectorAll("label")].map((l) => l.textContent)).toEqual(["Music", "Sound effects"]);
    for (const key of ["pause.sound", "sound.music", "sound.effects", "sound.unavailable", "hud.muted", "controls.mute.keys", "controls.mute.action"]) {
      expect(idStrings).toHaveProperty(key);
      expect(enStrings).toHaveProperty(key);
    }
  });

  it("says so when the browser cannot make sound, and the sliders still work (AC-8)", async () => {
    const env = setup({}, false);
    await click(env.ui, "Mulai");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    await click(env.ui, "Suara");
    expect(env.ui.querySelector(".notice")?.textContent).toContain("tidak bisa memutar suara");
    drag(slider(env.ui, "volume-music"), 10);
    expect(env.audio.settings.music).toBe(0.1);
  });

  it("does not show the note when sound works", async () => {
    const { ui } = await openSound();
    expect(ui.querySelector(".notice")).toBeNull();
  });
});

describe("pause, Logbook, end screen and other tabs (REQ-026 AC-7)", () => {
  it("is quiet in the pause menu and playing again after Lanjut", async () => {
    const { ui, phases, app } = await startPlaying();
    expect(phases.at(-1)).toBe("playing");
    app.pause();
    expect(phases.at(-1)).toBe("quiet");
    await click(ui, "Lanjut");
    expect(phases.at(-1)).toBe("playing");
  });

  it("stays quiet while the Logbook is open and in the pause menu's other views", async () => {
    const { phases } = await startPlaying();
    press("KeyL");
    expect(phases.at(-1)).toBe("quiet");
  });

  it("is quiet on the end screen", async () => {
    const { phases, game } = await startPlaying();
    const summary = { trashRemoved: 1, trashTotal: 1, animalsFreed: 0, animalsTotal: 2, framesPlanted: 0, framesTotal: 3, patchesPlanted: 0, patchesTotal: 2, seconds: 5, score: 0 };
    game.onEnd.mock.calls[0][0](summary);
    expect(phases.at(-1)).toBe("quiet");
  });

  it("is not quiet on the title screen or in the credits", async () => {
    const { ui, phases } = setup();
    await click(ui, "Kredit");
    expect(new Set(phases)).toEqual(new Set(["playing"]));
  });

  it("stops all sound when the window loses focus and resumes it when it is back", async () => {
    const { audio } = await startPlaying();
    window.dispatchEvent(new Event("blur"));
    expect(audio.setInactive).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new Event("focus"));
    expect(audio.setInactive).toHaveBeenLastCalledWith(false);
  });

  it("stops all sound when the tab is hidden and resumes it when it is shown", async () => {
    const { audio } = await startPlaying();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(audio.setInactive).toHaveBeenLastCalledWith(true);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(audio.setInactive).toHaveBeenLastCalledWith(false);
    hidden.mockRestore();
  });

  it("stays silent when the tab is shown again while the window is still out of focus", async () => {
    const { audio } = await startPlaying();
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(audio.setInactive).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new Event("focus"));
  });
});

describe("the credits (REQ-026 AC-4, G-005)", () => {
  it("name the music, its maker, its licence and where it came from", () => {
    const music = credits.assets.rows.find((row) => row[0].startsWith("Underwater Ambient Pad"));
    expect(music).toEqual(["Underwater Ambient Pad (musik latar)", "isaiah658", "CC0 1.0", "https://opengameart.org/content/underwater-ambient-pad"]);
  });
});
