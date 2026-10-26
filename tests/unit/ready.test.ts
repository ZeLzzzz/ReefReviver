import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, type AppDeps } from "../../src/app";
import type { PointerLock } from "../../src/ui/pointer-lock";

const pointerLock: PointerLock = { request: async () => true, exit: () => {}, onChange: () => {} };

function setup(overrides: Partial<AppDeps> = {}) {
  document.body.innerHTML = '<div id="ui"></div>';
  const ui = document.querySelector<HTMLElement>("#ui")!;
  const game = { play: vi.fn(), pause: vi.fn(), resume: vi.fn(), onHud: vi.fn(), onEnd: vi.fn() };
  const createGame = vi.fn(() => game);
  const app = new App({
    ui,
    browserLanguages: ["id-ID"],
    storage: null,
    phoneOrTablet: false,
    getWebGL2: () => ({}) as WebGL2RenderingContext,
    createGame,
    pointerLock,
    ...overrides,
  });
  return { app, ui, createGame };
}

const buttons = (ui: HTMLElement) => [...ui.querySelectorAll("button")].map((b) => b.textContent);
const click = (ui: HTMLElement, text: string) => {
  const target = [...ui.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!target) throw new Error(`No button "${text}" in: ${buttons(ui).join(", ")}`);
  target.click();
};
const pressEscape = () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

/** A loadAssets whose result the test decides. */
function controlledLoad() {
  let report: (fraction: number) => void = () => {};
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  const loadAssets = vi.fn((onProgress: (fraction: number) => void) => {
    report = onProgress;
    return new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  return { loadAssets, progress: (f: number) => report(f), finish: () => finish(), fail: (e: Error) => fail(e) };
}

beforeEach(() => {
  document.documentElement.lang = "";
});

describe("loading screen (REQ-009 AC-2)", () => {
  it("shows the progress while the files load, then the title screen with the game created", async () => {
    const load = controlledLoad();
    const { app, ui, createGame } = setup({ loadAssets: load.loadAssets });
    const booted = app.boot();
    expect(app.screen).toBe("loading");
    expect(ui.querySelector("h1")?.textContent).toBe("ReefReviver");
    const bar = ui.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(ui.querySelector(".loading-text")?.textContent).toBe("Memuat game 0%");
    expect(buttons(ui)).toEqual([]);
    expect(createGame).not.toHaveBeenCalled();

    load.progress(0.42);
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(ui.querySelector(".loading-text")?.textContent).toBe("Memuat game 42%");
    expect(ui.querySelector<HTMLElement>(".loading-fill")!.style.width).toBe("42%");

    load.progress(1);
    load.finish();
    await booted;
    expect(app.screen).toBe("title");
    expect(buttons(ui)).toContain("Mulai");
    expect(createGame).toHaveBeenCalledOnce();
  });

  it("uses the browser language", async () => {
    const load = controlledLoad();
    const { app, ui } = setup({ browserLanguages: ["en-US"], loadAssets: load.loadAssets });
    void app.boot();
    expect(ui.querySelector(".loading-text")?.textContent).toBe("Loading the game 0%");
  });

  it("goes straight to the title when there is nothing to load", () => {
    const { app } = setup();
    void app.boot();
    expect(app.screen).toBe("title");
  });

  it("does not download anything without WebGL 2", async () => {
    const load = controlledLoad();
    await setup({ getWebGL2: () => null, loadAssets: load.loadAssets }).app.boot();
    expect(load.loadAssets).not.toHaveBeenCalled();
  });

  it("loads the game on a phone too, which plays it with touch controls (REQ-030)", async () => {
    const load = controlledLoad();
    void setup({ phoneOrTablet: true, loadAssets: load.loadAssets }).app.boot();
    expect(load.loadAssets).toHaveBeenCalledTimes(1);
  });
});

describe("files that fail to load (REQ-009 AC-3)", () => {
  it("shows a message with a reload button, and never creates the game", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = controlledLoad();
    const { app, ui, createGame } = setup({ loadAssets: load.loadAssets });
    const booted = app.boot();
    load.progress(0.5);
    load.fail(new Error("rov.glb: HTTP 404"));
    await booted;
    expect(app.screen).toBe("assetError");
    expect(ui.querySelector("h1")?.textContent).toBe("File game gagal dimuat");
    expect(ui.querySelector("p")?.textContent).toContain("muat ulang");
    expect(buttons(ui)).toEqual(["Muat ulang"]);
    expect(ui.querySelector('[role="progressbar"]')).toBeNull();
    expect(createGame).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("speaks English to an English browser", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = controlledLoad();
    const { app, ui } = setup({ browserLanguages: ["en"], loadAssets: load.loadAssets });
    const booted = app.boot();
    load.fail(new Error("x"));
    await booted;
    expect(ui.querySelector("h1")?.textContent).toBe("The game files couldn't load");
    expect(buttons(ui)).toEqual(["Reload"]);
    error.mockRestore();
  });
});

describe("credits screen (REQ-009 AC-5)", () => {
  async function openCredits(browserLanguages = ["id-ID"]) {
    const env = setup({ browserLanguages });
    await env.app.boot();
    click(env.ui, browserLanguages[0] === "en" ? "Credits" : "Kredit");
    return env;
  }

  it("opens from the title screen and lists the team marker, the assets and three.js with its licence", async () => {
    const { app, ui } = await openCredits();
    expect(app.screen).toBe("credits");
    expect(ui.querySelector("h1")?.textContent).toBe("Kredit");
    expect([...ui.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Tim", "Aset pihak ketiga", "Kode pihak ketiga"]);
    // D-054: no invented names; a clear marker until the user fills in CREDITS.md.
    expect(ui.querySelector(".credit-pending")?.textContent).toBe("Nama anggota tim belum diisi.");
    // REQ-026 AC-4, G-005: the one third-party asset is the music.
    expect(ui.querySelector(".credit-none")).toBeNull();
    const music = ui.querySelector(".credit-list:not(.credit-team) li")!;
    expect(music.textContent).toContain("Underwater Ambient Pad (musik latar)");
    expect(music.textContent).toContain("oleh isaiah658");
    expect(music.textContent).toContain("Lisensi: CC0 1.0");
    expect(music.querySelector("a")?.getAttribute("href")).toBe("https://opengameart.org/content/underwater-ambient-pad");
    const three = [...ui.querySelectorAll(".credit-list:not(.credit-team) li")].find((li) => li.textContent?.includes("three.js"))!;
    expect(three.textContent).toContain("three.js");
    expect(three.textContent).toContain("Lisensi: MIT");
    expect(three.querySelector("a")?.getAttribute("href")).toBe("https://threejs.org");
    expect(ui.querySelector(".credit-notice summary")?.textContent).toBe("three.js (MIT)");
    expect(ui.querySelector(".credit-notice pre")?.textContent).toContain("Copyright © 2010-2026 three.js authors");
    expect(ui.querySelector(".credit-notice pre")?.textContent).toContain("THE SOFTWARE IS PROVIDED");
  });

  it("is in English for an English browser", async () => {
    const { ui } = await openCredits(["en"]);
    expect([...ui.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Team", "Third-party assets", "Third-party code"]);
    expect(ui.querySelector(".credit-pending")?.textContent).toContain("have not been filled in yet");
    const lists = [...ui.querySelectorAll(".credit-list:not(.credit-team) li")].map((li) => li.textContent);
    expect(lists.some((text) => text?.includes("by isaiah658") && text.includes("Licence: CC0 1.0"))).toBe(true);
    expect(lists.some((text) => text?.includes("Licence: MIT"))).toBe(true);
  });

  it("Kembali returns to the title screen", async () => {
    const { app, ui } = await openCredits();
    click(ui, "Kembali");
    expect(app.screen).toBe("title");
    expect(buttons(ui)).toContain("Mulai");
  });

  it("Esc returns to the title screen", async () => {
    const { app, ui } = await openCredits();
    pressEscape();
    expect(app.screen).toBe("title");
    expect(buttons(ui)).toContain("Kredit");
  });

  it("does not pause or start anything, and losing focus changes nothing", async () => {
    const { app, createGame } = await openCredits();
    window.dispatchEvent(new Event("blur"));
    expect(app.screen).toBe("credits");
    expect(createGame).toHaveBeenCalledOnce();
  });
});
