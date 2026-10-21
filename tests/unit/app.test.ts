import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, type AppDeps } from "../../src/app";
import type { HudState } from "../../src/game/hud-state";
import { buildMinimap } from "../../src/game/minimap";
import { NetField } from "../../src/game/nets";
import { ReefField } from "../../src/game/reef-sites";
import { Session, type SessionSummary } from "../../src/game/session";
import { TrashField } from "../../src/game/trash";
import type { StorageLike } from "../../src/i18n/i18n";
import type { PointerLock } from "../../src/ui/pointer-lock";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

interface FakePointerLock extends PointerLock {
  locked: boolean;
  grant: boolean;
  requests: number;
  set(locked: boolean): void;
}

/** Stands in for the browser's pointer lock; `grant` decides whether the next request succeeds. */
function fakePointerLock(): FakePointerLock {
  const listeners: ((locked: boolean) => void)[] = [];
  const lock: FakePointerLock = {
    locked: false,
    grant: true,
    requests: 0,
    set(locked: boolean) {
      if (lock.locked === locked) return;
      lock.locked = locked;
      for (const listener of listeners) listener(locked);
    },
    request: async () => {
      lock.requests++;
      if (lock.grant) lock.set(true);
      return lock.grant;
    },
    exit: () => lock.set(false),
    onChange: (listener) => void listeners.push(listener),
  };
  return lock;
}

function setup(overrides: Partial<AppDeps> = {}) {
  document.body.innerHTML = '<div id="ui"></div>';
  const ui = document.querySelector<HTMLElement>("#ui")!;
  const game = { play: vi.fn(), pause: vi.fn(), resume: vi.fn(), onHud: vi.fn(), onEnd: vi.fn() };
  const lock = fakePointerLock();
  const deps: AppDeps = {
    ui,
    browserLanguages: ["id-ID"],
    storage: memoryStorage(),
    phoneOrTablet: false,
    getWebGL2: () => ({}) as WebGL2RenderingContext,
    createGame: vi.fn(() => game),
    pointerLock: lock,
    ...overrides,
  };
  const app = new App(deps);
  app.boot();
  return { app, ui, game, lock, deps };
}

const buttons = (ui: HTMLElement) => [...ui.querySelectorAll("button")].map((b) => b.textContent);
const clickButton = async (ui: HTMLElement, text: string) => {
  const target = [...ui.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!target) throw new Error(`No button "${text}" in: ${buttons(ui).join(", ")}`);
  target.click();
  await Promise.resolve();
};
const pressEscape = () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

async function startPlaying() {
  const env = setup();
  await clickButton(env.ui, "Mulai");
  return env;
}

beforeEach(() => {
  document.documentElement.lang = "";
});

describe("title screen (REQ-001 AC-1)", () => {
  it("shows the game name, Mulai, the language choice and Kredit", () => {
    const { ui, app } = setup();
    expect(app.screen).toBe("title");
    expect(ui.querySelector("h1")?.textContent).toBe("ReefReviver");
    expect(buttons(ui)).toEqual(["Mulai", "Indonesia", "English", "Kredit"]);
    expect(ui.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Bahasa");
  });
});

describe("language (REQ-001 AC-2)", () => {
  it("follows the browser language the first time", () => {
    expect(buttons(setup({ browserLanguages: ["id-ID"] }).ui)).toContain("Mulai");
    expect(buttons(setup({ browserLanguages: ["en-US"] }).ui)).toContain("Start");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches language from the title screen and remembers it", async () => {
    const storage = memoryStorage();
    const { ui } = setup({ storage });
    await clickButton(ui, "English");
    expect(buttons(ui)).toContain("Start");
    expect(ui.querySelector('[aria-pressed="true"]')?.textContent).toBe("English");
    expect(document.documentElement.lang).toBe("en");

    // Opening the page again, with an Indonesian browser.
    expect(buttons(setup({ storage, browserLanguages: ["id"] }).ui)).toContain("Start");
  });

  it("still works when browser storage is blocked", async () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    const { ui } = setup({ storage: blocked, browserLanguages: ["id"] });
    expect(buttons(ui)).toContain("Mulai");
    await clickButton(ui, "English");
    expect(buttons(ui)).toContain("Start");
  });
});

describe("starting the dive (REQ-001 AC-3)", () => {
  it("Mulai locks the cursor, starts the game and shows the crosshair", async () => {
    const { ui, app, game, lock } = await startPlaying();
    expect(lock.requests).toBe(1);
    expect(game.play).toHaveBeenCalledOnce();
    expect(app.screen).toBe("playing");
    expect(ui.querySelector(".crosshair")).not.toBeNull();
    expect(buttons(ui)).toEqual([]);
  });

  it("stays on the title screen with a hint when the browser refuses the cursor lock", async () => {
    const env = setup();
    env.lock.grant = false;
    await clickButton(env.ui, "Mulai");
    await Promise.resolve();
    expect(env.app.screen).toBe("title");
    expect(env.game.play).not.toHaveBeenCalled();
    expect(env.ui.querySelector('[role="alert"]')?.textContent).toBe("Kursor belum terkunci ke game. Klik Mulai lagi.");
  });
});

describe("HUD (REQ-002)", () => {
  const hudState = (tank: number): HudState => ({
    tool: "vacuum",
    tank,
    capacity: 8,
    tankFull: tank >= 8,
    score: tank * 10,
    materials: 0,
    cleanliness: 0,
    objectives: new Session(40).objectives,
    notice: null,
    inStationZone: false,
    stationDistance: 30,
    marker: { left: 10, top: 10, onScreen: false, angle: 0 },
    sucking: false,
    cutProgress: 0,
  });
  const emit = (game: { onHud: ReturnType<typeof vi.fn> }, state: HudState) => game.onHud.mock.calls[0][0](state);

  it("shows the game's state while playing, and the goals from the first frame", async () => {
    const { ui, game } = await startPlaying();
    emit(game, hudState(3));
    expect(ui.querySelector(".stat-tank")?.textContent).toBe("Tangki3/8");
    expect(ui.querySelector(".stat-score")?.textContent).toBe("Skor30");
    expect(ui.querySelectorAll(".goal")).toHaveLength(3);
  });

  it("is hidden while paused and comes back in the new language, with the same numbers", async () => {
    const { ui, game } = await startPlaying();
    emit(game, hudState(8));
    pressEscape();
    expect(ui.querySelector(".hud")).toBeNull();
    emit(game, hudState(8)); // a late frame while paused must not draw anything
    expect(ui.querySelector(".hud")).toBeNull();
    await clickButton(ui, "Bahasa");
    await clickButton(ui, "English");
    await clickButton(ui, "Back");
    await clickButton(ui, "Resume");
    expect(ui.querySelector(".message-full")?.textContent).toBe("Tank full, deposit at the station");
    expect(ui.querySelector(".stat-tank")?.textContent).toBe("Tank8/8");
  });
});

describe("pause (REQ-001 AC-5)", () => {
  it("Esc pauses and shows Lanjut, Kontrol and Bahasa", async () => {
    const { ui, app, game, lock } = await startPlaying();
    pressEscape();
    expect(app.screen).toBe("paused");
    expect(game.pause).toHaveBeenCalledOnce();
    expect(lock.locked).toBe(false);
    expect(ui.querySelector("h2")?.textContent).toBe("Jeda");
    expect(buttons(ui)).toEqual(["Lanjut", "Kontrol", "Bahasa"]);
  });

  it("pauses when the browser releases the cursor on Esc", async () => {
    const { app, game, lock } = await startPlaying();
    lock.set(false);
    expect(app.screen).toBe("paused");
    expect(game.pause).toHaveBeenCalledOnce();
  });

  it("Lanjut resumes the same dive instead of starting a new one", async () => {
    const { ui, app, game } = await startPlaying();
    pressEscape();
    await clickButton(ui, "Lanjut");
    expect(app.screen).toBe("playing");
    expect(game.resume).toHaveBeenCalledOnce();
    expect(game.play).toHaveBeenCalledOnce();
  });

  it("stays paused with a hint when the cursor cannot be locked again", async () => {
    const { ui, app, game, lock } = await startPlaying();
    pressEscape();
    lock.grant = false;
    await clickButton(ui, "Lanjut");
    await Promise.resolve();
    expect(app.screen).toBe("paused");
    expect(game.resume).not.toHaveBeenCalled();
    expect(ui.querySelector('[role="alert"]')?.textContent).toBe("Kursor belum terkunci ke game. Klik Lanjut lagi.");
  });

  it("Kontrol lists the controls and Kembali (or Esc) goes back", async () => {
    const { ui } = await startPlaying();
    pressEscape();
    await clickButton(ui, "Kontrol");
    const rows = [...ui.querySelectorAll("dt")].map((dt) => `${dt.textContent} = ${dt.nextElementSibling?.textContent}`);
    expect(rows).toEqual([
      "W A S D = Maju, mundur, geser ke samping",
      "Spasi = Naik",
      "Shift = Turun",
      "Mouse = Mengarahkan ROV",
      "Klik kiri = Pakai alat (tahan)",
      "1 = Pilih Cutter",
      "2 = Pilih Vacuum",
      "3 = Pilih Seed launcher",
      "4 = Pilih Scanner",
      "E = Setor sampah atau pasang rangka",
      "L = Buka atau tutup Marine Logbook",
      "Esc = Jeda",
    ]);
    await clickButton(ui, "Kembali");
    expect(buttons(ui)).toEqual(["Lanjut", "Kontrol", "Bahasa"]);
    await clickButton(ui, "Kontrol");
    pressEscape();
    expect(buttons(ui)).toEqual(["Lanjut", "Kontrol", "Bahasa"]);
  });

  it("Bahasa switches the language while paused", async () => {
    const { ui } = await startPlaying();
    pressEscape();
    await clickButton(ui, "Bahasa");
    await clickButton(ui, "English");
    expect(ui.querySelector("h2")?.textContent).toBe("Paused");
    await clickButton(ui, "Back");
    expect(buttons(ui)).toEqual(["Resume", "Controls", "Language"]);
  });
});

describe("losing the cursor (REQ-001 AC-6)", () => {
  it("pauses when the window loses focus", async () => {
    const { app, game } = await startPlaying();
    window.dispatchEvent(new Event("blur"));
    expect(app.screen).toBe("paused");
    expect(game.pause).toHaveBeenCalledOnce();
  });

  it("pauses when the tab is hidden", async () => {
    const { app } = await startPlaying();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    hidden.mockRestore();
    expect(app.screen).toBe("paused");
  });

  it("does nothing on the title screen", () => {
    const { app, game } = setup();
    window.dispatchEvent(new Event("blur"));
    expect(app.screen).toBe("title");
    expect(game.pause).not.toHaveBeenCalled();
  });
});

describe("phones and tablets (REQ-001 AC-7)", () => {
  it("shows 'Mainkan di komputer' and does not start the game", () => {
    const { ui, app, deps } = setup({ phoneOrTablet: true });
    expect(app.screen).toBe("unsupported");
    expect(ui.querySelector("h1")?.textContent).toBe("Mainkan di komputer");
    expect(deps.createGame).not.toHaveBeenCalled();
    expect(buttons(ui)).toEqual([]);
  });

  it("uses the chosen language", () => {
    expect(setup({ phoneOrTablet: true, browserLanguages: ["en-US"] }).ui.querySelector("h1")?.textContent).toBe(
      "Play on a computer",
    );
  });
});

describe("no WebGL 2 (REQ-001 AC-8)", () => {
  it("explains the problem instead of a black screen", () => {
    const { ui, app, deps } = setup({ getWebGL2: () => null });
    expect(app.screen).toBe("noWebgl");
    expect(ui.querySelector("h1")?.textContent).toBe("Browser ini tidak bisa menjalankan ReefReviver");
    expect(ui.querySelector("p")?.textContent).toContain("WebGL 2");
    expect(buttons(ui)).toEqual(["Muat ulang"]);
    expect(deps.createGame).not.toHaveBeenCalled();
  });
});

describe("minimap and pause (REQ-010 AC-6)", () => {
  it("is hidden with the HUD while paused and comes back showing the same ROV position and landmarks", async () => {
    const { ui, game } = await startPlaying();
    const reef = new ReefField();
    reef.install(2);
    const minimap = buildMinimap({
      rov: { x: 14, z: -9, yaw: 1 },
      frames: reef.frames,
      patches: reef.patches,
      nets: new NetField().nets,
      trash: new TrashField().items,
      cleanliness: 0,
    });
    const state: HudState = {
      tool: "vacuum", tank: 0, capacity: 8, tankFull: false, score: 0, materials: 0, cleanliness: 0,
      objectives: new Session(40).objectives, notice: null, inStationZone: false, stationDistance: 30,
      marker: { left: 10, top: 10, onScreen: false, angle: 0 }, sucking: false, cutProgress: 0, minimap,
    };
    game.onHud.mock.calls[0][0](state);
    const before = ui.querySelector(".hud-minimap")!.outerHTML;
    expect(before).toContain('data-kind="rov"');
    pressEscape();
    expect(ui.querySelector(".hud-minimap")).toBeNull();
    await clickButton(ui, "Lanjut");
    expect(ui.querySelector(".hud-minimap")!.outerHTML).toBe(before);
    expect(ui.querySelector('[data-kind="frame"][data-status="started"]')).not.toBeNull();
  });
});

describe("Marine Logbook (REQ-006 AC-2)", () => {
  const pressKey = (code: string) => window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code }));
  const hudWith = (unlocked: HudState["unlocked"], extra: Partial<HudState> = {}): HudState => ({
    tool: "scanner", tank: 0, capacity: 8, tankFull: false, score: 0, materials: 0, cleanliness: 0,
    objectives: new Session(40).objectives, notice: null, inStationZone: false, stationDistance: 30,
    marker: { left: 10, top: 10, onScreen: false, angle: 0 }, sucking: false, cutProgress: 0, unlocked, ...extra,
  });
  const slots = (ui: HTMLElement) => [...ui.querySelectorAll<HTMLElement>(".slot")];
  const names = (ui: HTMLElement) => slots(ui).map((slot) => slot.querySelector(".slot-name")!.textContent);

  it("L opens it, stops the game and releases the cursor without opening the pause menu", async () => {
    const { ui, app, game, lock } = await startPlaying();
    pressKey("KeyL");
    expect(app.screen).toBe("logbook");
    expect(game.pause).toHaveBeenCalledOnce();
    expect(lock.locked).toBe(false);
    expect(ui.querySelector(".logbook")).not.toBeNull();
    expect(ui.querySelector(".hud")).toBeNull();
    expect(ui.querySelector(".pause-screen")).toBeNull();
  });

  it("shows seven slots, the unscanned ones as '???' (also before the Bloom)", async () => {
    const { ui } = await startPlaying();
    pressKey("KeyL");
    expect(slots(ui)).toHaveLength(7);
    expect(names(ui)).toEqual(Array(7).fill("???"));
    expect(slots(ui).every((slot) => slot.dataset.state === "locked")).toBe(true);
  });

  it("shows scanned entries by name and the rest as '???', with the first scanned entry open", async () => {
    const { ui, game } = await startPlaying();
    game.onHud.mock.calls[0][0](hudWith(["turtle", "seagrass"]));
    pressKey("KeyL");
    expect(names(ui)).toEqual(["Penyu hijau", "???", "???", "???", "???", "???", "Lamun"]);
    expect(ui.querySelector(".entry h3")?.textContent).toBe("Penyu hijau");
  });

  it("clicking a scanned entry opens it; a locked one cannot be opened", async () => {
    const { ui, game } = await startPlaying();
    game.onHud.mock.calls[0][0](hudWith(["turtle", "seagrass"]));
    pressKey("KeyL");
    ui.querySelector<HTMLElement>('.slot[data-entry="seagrass"]')!.click();
    expect(ui.querySelector(".entry h3")?.textContent).toBe("Lamun");
    const locked = ui.querySelector<HTMLButtonElement>('.slot[data-entry="mantaRay"]')!;
    expect(locked.disabled).toBe(true);
    locked.click();
    expect(ui.querySelector(".entry h3")?.textContent).toBe("Lamun");
  });

  it("L closes it, locks the cursor again and resumes the same dive with the HUD back", async () => {
    const { ui, app, game, lock } = await startPlaying();
    pressKey("KeyL");
    pressKey("KeyL");
    expect(app.screen).toBe("playing");
    expect(lock.locked).toBe(true);
    expect(game.resume).toHaveBeenCalledOnce();
    expect(game.play).toHaveBeenCalledOnce();
    expect(ui.querySelector(".hud")).not.toBeNull();
    expect(ui.querySelector(".logbook")).toBeNull();
  });

  it("Esc closes it the same way, and so does the close button", async () => {
    const { ui, app, game } = await startPlaying();
    pressKey("KeyL");
    pressEscape();
    await Promise.resolve();
    expect(app.screen).toBe("playing");
    expect(game.resume).toHaveBeenCalledOnce();
    pressKey("KeyL");
    await clickButton(ui, "Tutup");
    expect(app.screen).toBe("playing");
    expect(game.resume).toHaveBeenCalledTimes(2);
  });

  it("falls back to the pause menu, with a hint, when the browser will not lock the cursor again", async () => {
    const { ui, app, game, lock } = await startPlaying();
    pressKey("KeyL");
    lock.grant = false;
    pressEscape();
    await Promise.resolve();
    await Promise.resolve();
    expect(app.screen).toBe("paused");
    expect(game.resume).not.toHaveBeenCalled();
    expect(ui.querySelector('[role="alert"]')?.textContent).toBe("Kursor belum terkunci ke game. Klik Lanjut lagi.");
    lock.grant = true;
    await clickButton(ui, "Lanjut");
    expect(app.screen).toBe("playing");
    expect(game.resume).toHaveBeenCalledOnce();
  });

  it("does nothing on the title screen or in the pause menu", async () => {
    const title = setup();
    pressKey("KeyL");
    expect(title.app.screen).toBe("title");
    const { app } = await startPlaying();
    pressEscape();
    pressKey("KeyL");
    expect(app.screen).toBe("paused");
  });

  it("hides the minimap with the rest of the HUD and brings it back unchanged (REQ-010 AC-6)", async () => {
    const { ui, game } = await startPlaying();
    const reef = new ReefField();
    reef.install(1);
    const minimap = buildMinimap({
      rov: { x: -8, z: 12, yaw: 2 },
      frames: reef.frames,
      patches: reef.patches,
      nets: new NetField().nets,
      trash: new TrashField().items,
      cleanliness: 90,
    });
    game.onHud.mock.calls[0][0](hudWith([], { minimap }));
    const before = ui.querySelector(".hud-minimap")!.outerHTML;
    expect(before).toContain('data-kind="rov"');
    pressKey("KeyL");
    expect(ui.querySelector(".hud-minimap")).toBeNull();
    game.onHud.mock.calls[0][0](hudWith([], { minimap })); // a late frame while the Logbook is open draws nothing
    expect(ui.querySelector(".hud-minimap")).toBeNull();
    pressKey("KeyL");
    expect(ui.querySelector(".hud-minimap")!.outerHTML).toBe(before);
  });
});

describe("end screen (REQ-008)", () => {
  const summary: SessionSummary = {
    trashRemoved: 36,
    trashTotal: 40,
    animalsFreed: 2,
    animalsTotal: 2,
    framesPlanted: 3,
    framesTotal: 3,
    patchesPlanted: 2,
    patchesTotal: 2,
    seconds: 487.6,
    score: 810,
  };

  async function ended() {
    const env = await startPlaying();
    env.game.onEnd.mock.calls[0][0](summary);
    return env;
  }

  it("takes over when the game ends: the game stops, the cursor is free, the HUD and the pause menu are gone (AC-1)", async () => {
    const { ui, app, game, lock } = await ended();
    expect(app.screen).toBe("end");
    expect(game.pause).toHaveBeenCalledOnce();
    expect(lock.locked).toBe(false);
    expect(ui.querySelector(".end-screen")).not.toBeNull();
    expect(ui.querySelector(".end-stats")?.textContent).toContain("8:07");
    expect(ui.querySelector(".hud")).toBeNull();
    expect(ui.querySelector(".pause-screen")).toBeNull();
  });

  it("Main lagi starts a new dive in the same language (AC-3)", async () => {
    const storage = memoryStorage();
    const env = setup({ storage, browserLanguages: ["en-US"] });
    await clickButton(env.ui, "Start");
    env.game.onEnd.mock.calls[0][0](summary);
    await clickButton(env.ui, "Play again");
    expect(env.app.screen).toBe("playing");
    expect(env.lock.locked).toBe(true);
    expect(env.game.play).toHaveBeenCalledTimes(2);
    expect(env.game.resume).not.toHaveBeenCalled();
    expect(env.app.lang).toBe("en");
    expect(env.ui.querySelector(".hud")).not.toBeNull();
  });

  it("Lanjut menjelajah closes it and the same dive goes on (AC-5)", async () => {
    const { ui, app, game } = await ended();
    await clickButton(ui, "Lanjut menjelajah");
    expect(app.screen).toBe("playing");
    expect(game.resume).toHaveBeenCalledOnce();
    expect(game.play).toHaveBeenCalledOnce();
    expect(ui.querySelector(".end-screen")).toBeNull();
  });

  it("stays, with a message, when the browser refuses the cursor", async () => {
    const { ui, app, game, lock } = await ended();
    lock.grant = false;
    await clickButton(ui, "Main lagi");
    await Promise.resolve();
    expect(app.screen).toBe("end");
    expect(game.play).toHaveBeenCalledOnce();
    expect(ui.querySelector('[role="alert"]')?.textContent).toBe("Kursor belum terkunci ke game. Klik tombolnya lagi.");
    lock.grant = true;
    await clickButton(ui, "Lanjut menjelajah");
    expect(app.screen).toBe("playing");
    expect(game.resume).toHaveBeenCalledOnce();
  });

  it("Esc and L do nothing on it", async () => {
    const { app } = await ended();
    pressEscape();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyL", key: "l" }));
    await Promise.resolve();
    expect(app.screen).toBe("end");
  });
});
