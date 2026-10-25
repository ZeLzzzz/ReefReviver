import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { boardAgain, goAshore, standAtCounter } from "./ashore";

// REQ-026: the game's sound. Nobody can listen in a test, so these read the sound engine's state through the dev hook
// `__reef.audio()` (context state, bus gains, the music filter, the ambience mix, the effects fired, and the RMS level of
// the output) and render every effect offline to check it makes sound.

type Vec = [number, number, number];
interface AudioState {
  available: boolean;
  state: string;
  started: boolean;
  phase: string;
  inactive: boolean;
  muted: boolean;
  volumes: { music: number; effects: number };
  gains: { master: number; music: number; effects: number; world: number };
  targets: { master: number; music: number; effects: number; world: number };
  music: { state: string; cutoff: number; cutoffTarget: number };
  ambience: { under: number; above: number; underValue: number; aboveValue: number };
  loops: { vacuum: number; scan: number };
  fired: string[];
  level: number;
}

const { audio: sound } = config;

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
const state = (page: Page) => reef(page, (h) => h.audio()) as Promise<AudioState>;
const fired = async (page: Page) => (await state(page)).fired;
const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);

async function boot(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // A music file made to fail logs the browser's own "Failed to load resource"; that is not the game's error.
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) problems.push(`console: ${message.text()}`);
  });
  return problems;
}

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** Keeps the ROV where the crosshair points at whatever `expr` returns: [x, y, z, distance, height above the point]. */
async function installTracker(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__aimFn = null;
    const tick = () => {
      const h = w.__reef;
      if (w.__aimFn) {
        const [tx, ty, tz, d, dy] = w.__aimFn(h) as number[];
        const len = Math.hypot(tx, tz) || 1;
        const px = tx - (tx / len) * d;
        const pz = tz - (tz / len) * d;
        const py = ty + dy;
        let yaw = 0;
        let pitch = 0;
        for (let i = 0; i < 40; i++) {
          const ax = Math.sin(yaw) * Math.cos(pitch);
          const ay = Math.sin(pitch);
          const az = Math.cos(yaw) * Math.cos(pitch);
          const v = [tx - (px - ax * 6), ty - (py - ay * 6 + 2), tz - (pz - az * 6)];
          yaw = Math.atan2(v[0], v[2]);
          pitch = Math.asin(v[1] / Math.hypot(v[0], v[1], v[2]));
        }
        h.placeRov(px, py, pz, yaw, pitch);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const track = (page: Page, expr: string) =>
  page.evaluate((src) => {
    (window as any).__aimFn = new Function("h", `return (${src});`);
  }, expr);

/** Aims at a point `distance` m from a net's dome (the crosshair ray starts 6 m behind and 2 m above the ROV). */
async function aimAtNet(page: Page, id: number) {
  const net = (await reef(page, (h) => h.nets()))[id];
  await reef(
    page,
    (h, a) => {
      const target = a.target;
      const len = Math.hypot(target[0], target[2]) || 1;
      const px = target[0] - (target[0] / len) * 3.5;
      const pz = target[2] - (target[2] / len) * 3.5;
      const py = target[1] + 0.8;
      let yaw = 0;
      let pitch = 0;
      for (let i = 0; i < 40; i++) {
        const ax = Math.sin(yaw) * Math.cos(pitch);
        const ay = Math.sin(pitch);
        const az = Math.cos(yaw) * Math.cos(pitch);
        const d = [target[0] - (px - ax * 6), target[1] - (py - ay * 6 + 2), target[2] - (pz - az * 6)];
        yaw = Math.atan2(d[0], d[2]);
        pitch = Math.asin(d[1] / Math.hypot(d[0], d[1], d[2]));
      }
      h.placeRov(px, py, pz, yaw, pitch);
    },
    { target: [net.center[0], net.center[1] + net.size[1] * 0.85, net.center[2]] },
  );
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the title screen is silent; a click on Mulai starts the music and the ambience (AC-1)", async ({ page }) => {
    const problems = await boot(page);
    await page.addInitScript(() => {
      const w = window as any;
      const Original = w.AudioContext;
      w.__contexts = 0;
      w.AudioContext = class extends Original {
        constructor(...args: unknown[]) {
          super(...args);
          w.__contexts += 1;
        }
      };
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("title");
    await page.waitForTimeout(500);
    // Nothing yet: no context, so nothing can sound.
    expect(await page.evaluate(() => (window as any).__contexts)).toBe(0);
    expect((await state(page)).state).toBe("none");
    expect((await state(page)).started).toBe(false);

    // A click on another button makes the context for its click sound, but starts no music and no ambience.
    await page.getByRole("button", { name: "Kredit" }).click();
    await expect.poll(async () => (await state(page)).state).toBe("running");
    expect((await state(page)).started).toBe(false);
    expect((await state(page)).music.state).toBe("none");
    expect((await state(page)).fired).toEqual(["click"]);
    await page.getByRole("button", { name: "Kembali" }).click();

    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    expect(await page.evaluate(() => (window as any).__contexts)).toBe(1);
    await expect.poll(async () => (await state(page)).music.state).toBe("playing");
    const playing = await state(page);
    expect(playing.started).toBe(true);
    expect(playing.state).toBe("running");
    expect(playing.ambience.under).toBe(sound.ambience.level);
    // The output really carries sound (the music and the rumble).
    await expect.poll(async () => (await state(page)).level, { timeout: 10_000 }).toBeGreaterThan(0.0005);
    expect(problems).toEqual([]);
  });

  test("the sea sounds under water, waves and wind above it, and the change follows the view (AC-2)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page);
    await startDive(page);
    await reef(page, (h) => h.placeRov(60, -6, 5, Math.PI / 2, 0));
    await expect.poll(async () => (await state(page)).ambience.underValue).toBeCloseTo(sound.ambience.level, 2);
    expect((await state(page)).ambience.aboveValue).toBeCloseTo(0, 2);

    // Up to the surface: the camera rises out of the water, the view switches (REQ-024 AC-4) and so does the ambience.
    await page.keyboard.down("Space");
    await expect.poll(async () => (await reef(page, (h) => h.view())).above, { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await state(page)).ambience.aboveValue, { timeout: 10_000 }).toBeCloseTo(sound.ambience.level, 2);
    expect((await state(page)).ambience.underValue).toBeCloseTo(0, 2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-026-surface.png" });
    await page.keyboard.up("Space");

    // Down again: the sea comes back.
    await page.keyboard.down("ShiftLeft");
    await expect.poll(async () => (await reef(page, (h) => h.view())).above, { timeout: 60_000 }).toBe(false);
    await page.keyboard.up("ShiftLeft");
    await expect.poll(async () => (await state(page)).ambience.underValue, { timeout: 10_000 }).toBeCloseTo(sound.ambience.level, 2);
    expect((await state(page)).ambience.aboveValue).toBeCloseTo(0, 2);

    // Bubbles rise now and then under water.
    await expect.poll(async () => (await fired(page)).includes("bubbles"), { timeout: 30_000 }).toBe(true);

    // On the land it is waves and wind, too.
    await goAshore(page);
    await expect.poll(async () => (await state(page)).ambience.aboveValue, { timeout: 10_000 }).toBeCloseTo(sound.ambience.level, 2);
    expect((await state(page)).ambience.underValue).toBeCloseTo(0, 2);
    expect(problems).toEqual([]);
  });

  test("the vacuum hums while the button is held; trash into the tank clinks and a full tank buzzes (AC-3)", async ({ page }) => {
    test.setTimeout(240_000);
    const problems = await boot(page);
    await startDive(page);
    expect((await state(page)).loops.vacuum).toBe(0);
    expect(await reef(page, (h) => h.aimAtTrash(3))).not.toBeNull();
    await page.mouse.down();
    await expect.poll(async () => (await state(page)).loops.vacuum).toBe(1);
    await expect.poll(async () => (await fired(page)).includes("trashIn"), { timeout: 20_000 }).toBe(true);
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).loops.vacuum).toBe(0);
    expect((await fired(page)).filter((name) => name === "vacuum")).toHaveLength(1);

    // Fill the tank (12): the buzzer sounds.
    for (let i = 2; i <= 12; i++) {
      expect(await reef(page, (h) => h.aimAtTrash(3))).not.toBeNull();
      await page.mouse.down();
      await expect(stat(page, "tank")).toHaveText(new RegExp(`^${i}/12$`), { timeout: 20_000 });
      await page.mouse.up();
    }
    await expect.poll(async () => (await fired(page)).includes("tankFull"), { timeout: 10_000 }).toBe(true);
    expect(problems).toEqual([]);
  });

  test("a net cut and an animal freed sound (AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page);
    await startDive(page);
    await page.keyboard.press("Digit1");
    await aimAtNet(page, 0);
    await page.mouse.down();
    await expect.poll(async () => (await fired(page)).includes("netCut"), { timeout: 40_000 }).toBe(true);
    await page.mouse.up();
    await expect.poll(async () => (await fired(page)).includes("animalFreed"), { timeout: 10_000 }).toBe(true);
    expect(problems).toEqual([]);
  });

  test("a seed shot and a finished planting sound (AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page);
    await startDive(page);
    await reef(page, (h) => h.giveMaterials(5));
    await reef(page, (h) => {
      const frame = h.reefSites().frames[0];
      h.placeRov(frame.x, frame.y + 1, frame.z + 3, Math.PI, 0);
    });
    await page.keyboard.press("KeyE");
    await expect.poll(async () => (await fired(page)).includes("frameInstall")).toBe(true);
    await page.keyboard.press("Digit3");
    const frame = (await reef(page, (h) => h.reefSites())).frames[0];
    expect(await page.evaluate(([t]) => (window as any).__reef.aimAtPoint(t[0], t[1], t[2], 9, 0), [[frame.x, frame.y + 1, frame.z]])).toBe(true);
    await page.mouse.down();
    await expect.poll(async () => (await fired(page)).includes("seedShot"), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await reef(page, (h) => h.reefSites())).frames[0].fragments, { timeout: 40_000 }).toBe(3);
    await page.mouse.up();
    await expect.poll(async () => (await fired(page)).includes("planted"), { timeout: 10_000 }).toBe(true);
    expect(problems).toEqual([]);
  });

  test("on land: leaving the sub, footsteps on sand and on the dock, picking up, depositing, boarding (AC-3)", async ({ page }) => {
    test.setTimeout(180_000);
    const problems = await boot(page);
    await startDive(page);
    await goAshore(page);
    expect(await fired(page)).toContain("leaveSub");

    // Footsteps on the sand.
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await fired(page)).includes("footstepSand"), { timeout: 20_000 }).toBe(true);
    await page.keyboard.up("KeyW");

    // Picking up beach trash (the walker stands 2 m from a piece, the crosshair on it), then depositing at the counter.
    expect(await reef(page, (h) => h.aimAtBeachTrash(2, 0))).not.toBeNull();
    await page.keyboard.press("KeyE");
    await expect.poll(async () => (await fired(page)).includes("pickup"), { timeout: 10_000 }).toBe(true);
    await standAtCounter(page);
    await page.keyboard.press("KeyE");
    await expect.poll(async () => (await fired(page)).includes("deposit"), { timeout: 10_000 }).toBe(true);

    // Footsteps on the boards: from the dock's landward end, walking east out over the water.
    await reef(page, (h, a) => h.placeWalker(a.x, a.z, Math.PI / 2, 0), { x: config.bay.dock.landX + 0.8, z: config.bay.dock.z });
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await fired(page)).includes("footstepDock"), { timeout: 20_000 }).toBe(true);
    await page.keyboard.up("KeyW");

    await boardAgain(page);
    expect(await fired(page)).toContain("boardSub");
    expect(problems).toEqual([]);
  });

  test("after the Bloom the music clears, step by step during the 6 s; the Bloom, the Scanner and a new entry sound (AC-3, AC-4)", async ({ page }) => {
    test.setTimeout(400_000);
    const problems = await boot(page);
    await startDive(page);
    await installTracker(page);
    // Record every distinct cutoff the game asks the filter for.
    await page.evaluate(() => {
      const w = window as any;
      w.__cutoffs = [] as number[];
      const tick = () => {
        const cutoff = w.__reef.audio()?.music?.cutoffTarget;
        if (cutoff !== undefined && w.__cutoffs.at(-1) !== cutoff) w.__cutoffs.push(cutoff);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await expect.poll(async () => (await state(page)).music.state).toBe("playing");
    // Muffled before the Bloom.
    expect((await state(page)).music.cutoffTarget).toBe(sound.music.muffledHz);
    expect(await fired(page)).not.toContain("bloom");

    await reef(page, (h) => {
      h.removeTrash(50);
      h.plantAll();
    });
    await expect.poll(async () => (await reef(page, (h) => h.bloom())).state, { timeout: 200_000 }).toBe("done");
    expect(await fired(page)).toContain("bloom");
    const cutoffs: number[] = await page.evaluate(() => (window as any).__cutoffs);
    expect(cutoffs[0]).toBe(sound.music.muffledHz);
    expect(cutoffs.at(-1)).toBeCloseTo(sound.music.clearHz, 3);
    expect([...cutoffs].sort((a, b) => a - b)).toEqual(cutoffs);
    expect(cutoffs.length).toBeGreaterThan(5);
    const after = await state(page);
    expect(after.music.cutoffTarget).toBeCloseTo(sound.music.clearHz, 3);
    // The filter really moved (the audio thread's own value follows the target).
    await expect.poll(async () => (await state(page)).music.cutoff, { timeout: 10_000 }).toBeGreaterThan(sound.music.clearHz * 0.9);
    await page.screenshot({ path: "test-results/req-026-after-bloom.png" });

    // The Scanner hums while it scans, and a new Logbook entry sounds.
    await expect.poll(async () => (await reef(page, (h) => h.seaLife())).scale, { timeout: 100_000 }).toBe(1);
    await page.keyboard.press("Digit4");
    await track(page, `(() => { const c = h.seaLife().creatures.filter((c) => c.species === "clownfish")[0]; return [...c.position, 4, 0.8]; })()`);
    await page.mouse.down();
    await expect.poll(async () => (await state(page)).loops.scan, { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await fired(page)).includes("logbookEntry"), { timeout: 90_000 }).toBe(true);
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).loops.scan, { timeout: 30_000 }).toBe(0);
    expect(problems).toEqual([]);
  });

  test("every effect is made in code and makes sound: audible, finite, not clipping (AC-3)", async ({ page }) => {
    await page.goto("/");
    const results = await page.evaluate(async () => {
      // Playwright turns a literal import() into a require(), which the page does not have.
      const load = new Function("path", "return import(path)") as (path: string) => Promise<any>;
      const { EFFECTS, createNoise, playEffect } = await load("/src/audio/recipes.ts");
      const { config } = await load("/src/config.ts");
      const rate = 44100;
      const render = async (spec: any) => {
        const seconds = Math.max(...spec.layers.map((l: any) => (l.at ?? 0) + l.dur)) + 0.2;
        const ctx = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
        playEffect(ctx, ctx.destination, spec, createNoise(ctx), 0, () => 0.5);
        const data = (await ctx.startRendering()).getChannelData(0);
        let peak = 0;
        let sum = 0;
        let finite = true;
        for (const v of data) {
          if (!Number.isFinite(v)) finite = false;
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
        }
        return { peak, rms: Math.sqrt(sum / data.length), finite, seconds };
      };
      const out: Record<string, { peak: number; rms: number; finite: boolean; seconds: number }> = {};
      for (const [name, spec] of Object.entries(EFFECTS)) out[name] = await render(spec);
      out.bubble = await render(config.audio.ambience.under.bubbles);
      return out;
    });
    expect(Object.keys(results).sort()).toEqual([...Object.keys(config.audio.effects), "bubble"].sort());
    for (const [name, { peak, rms, finite }] of Object.entries(results)) {
      expect(finite, name).toBe(true);
      expect(peak, `${name} is audible`).toBeGreaterThan(0.01);
      expect(peak, `${name} does not clip`).toBeLessThan(1);
      expect(rms, name).toBeGreaterThan(0.0005);
    }
  });

  test("M mutes all sound and shows 'Suara mati'; M again brings it back (AC-5)", async ({ page }) => {
    const problems = await boot(page);
    await startDive(page);
    await expect.poll(async () => (await state(page)).level, { timeout: 10_000 }).toBeGreaterThan(0.0005);
    await expect(page.locator(".sound-off")).toBeHidden();
    await page.keyboard.press("KeyM");
    await expect(page.locator(".sound-off")).toHaveText("Suara mati");
    await page.screenshot({ path: "test-results/req-026-muted.png" });
    await expect.poll(async () => (await state(page)).gains.master).toBe(0);
    expect((await state(page)).muted).toBe(true);
    // Nothing at all comes out.
    await expect.poll(async () => (await state(page)).level, { timeout: 10_000 }).toBeLessThan(0.00005);
    await page.keyboard.press("KeyM");
    await expect(page.locator(".sound-off")).toBeHidden();
    await expect.poll(async () => (await state(page)).gains.master).toBe(1);
    await expect.poll(async () => (await state(page)).level, { timeout: 10_000 }).toBeGreaterThan(0.0005);
    // M is in the controls list.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Kontrol" }).click();
    const row = page.locator("dt", { hasText: /^M$/ });
    await expect(row).toBeVisible();
    await expect(row.locator("+ dd")).toHaveText("Matikan atau nyalakan suara");
    expect(problems).toEqual([]);
  });

  test("the Sound view sets the music and effects volumes at once; pausing and the Logbook stop the world's sounds and quieten the music (AC-6, AC-7)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page);
    await startDive(page);
    const playing = await state(page);
    expect(playing.volumes).toEqual({ music: 0.6, effects: 0.8 });
    expect(playing.gains.world).toBe(1);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    // Paused: ambience and effects off, music quieter but there.
    await expect.poll(async () => (await state(page)).gains.world).toBeCloseTo(0, 2);
    const paused = await state(page);
    expect(paused.phase).toBe("quiet");
    expect(paused.gains.master).toBe(1);
    await expect.poll(async () => (await state(page)).gains.music).toBeCloseTo(playing.gains.music * sound.music.quiet, 3);
    expect((await state(page)).gains.music).toBeGreaterThan(0);

    // The pause menu still clicks.
    await page.getByRole("button", { name: "Suara" }).click();
    expect((await fired(page)).filter((name) => name === "click").length).toBeGreaterThan(1);
    await expect(page.locator("label", { hasText: "Musik" })).toBeVisible();
    await expect(page.locator("#volume-music")).toHaveValue("60");
    await expect(page.locator("#volume-effects")).toHaveValue("80");
    await page.screenshot({ path: "test-results/req-026-sound-view.png" });
    await page.locator("#volume-music").fill("20");
    await expect(page.locator("output").first()).toHaveText("20%");
    await expect.poll(async () => (await state(page)).volumes.music).toBe(0.2);
    // 20 % with the curve, at the pause menu's quiet level.
    await expect.poll(async () => (await state(page)).gains.music).toBeCloseTo(0.2 ** sound.volumeCurve * sound.music.level * sound.music.quiet, 4);
    await page.locator("#volume-effects").fill("0");
    await expect.poll(async () => (await state(page)).gains.effects).toBe(0);
    await page.locator("#volume-effects").fill("100");
    await expect.poll(async () => (await state(page)).gains.effects).toBeCloseTo(sound.effectsLevel, 4);

    await page.getByRole("button", { name: "Kembali" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    await expect.poll(async () => (await state(page)).gains.world).toBeCloseTo(1, 2);
    expect((await state(page)).phase).toBe("playing");
    expect((await state(page)).volumes.music).toBe(0.2);

    // The Logbook: the same.
    await page.keyboard.press("KeyL");
    await expect(page.locator(".logbook")).toBeVisible();
    await expect.poll(async () => (await state(page)).gains.world).toBeCloseTo(0, 2);
    expect((await state(page)).phase).toBe("quiet");
    await page.keyboard.press("KeyL");
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    await expect.poll(async () => (await state(page)).gains.world).toBeCloseTo(1, 2);

    // M in the pause menu changes nothing.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await page.keyboard.press("KeyM");
    expect((await state(page)).muted).toBe(false);
    expect(problems).toEqual([]);
  });

  test("a window that loses focus stops all sound and sleeps; it wakes when the focus is back (AC-7)", async ({ page }) => {
    const problems = await boot(page);
    await startDive(page);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    // The gain glides to 0 and the context is put to sleep before it gets quite there (-60 dB: silent).
    await expect.poll(async () => (await state(page)).targets.master).toBe(0);
    await expect.poll(async () => (await state(page)).gains.master).toBeLessThan(0.01);
    await expect.poll(async () => (await state(page)).state).toBe("suspended");
    expect((await state(page)).inactive).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(async () => (await state(page)).state).toBe("running");
    await expect.poll(async () => (await state(page)).gains.master).toBe(1);
    expect((await state(page)).inactive).toBe(false);
    await expect.poll(async () => (await state(page)).level, { timeout: 10_000 }).toBeGreaterThan(0.0005);
    expect(problems).toEqual([]);
  });

  test("the end screen is quiet; the volumes and the mute stay through Main lagi, and are not stored (AC-6, AC-7)", async ({ page }) => {
    test.setTimeout(400_000);
    const problems = await boot(page);
    await startDive(page);
    await page.keyboard.press("KeyM");
    await expect(page.locator(".sound-off")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Suara" }).click();
    await page.locator("#volume-effects").fill("35");
    await page.getByRole("button", { name: "Kembali" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    await reef(page, (h) => {
      h.freeAnimals();
      h.removeTrash(50);
      h.plantAll();
    });
    await expect.poll(async () => (await reef(page, (h) => h.bloom())).state, { timeout: 200_000 }).toBe("done");
    for (const id of ["turtle", "reefShark", "clownfish", "mantaRay", "dolphin", "coral", "seagrass"]) await reef(page, (h, entry) => h.scanEntry(entry), id);
    await expect(page.locator(".end-screen")).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await state(page)).gains.world).toBeCloseTo(0, 2);
    expect((await state(page)).phase).toBe("quiet");
    expect((await state(page)).gains.music).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Main lagi" }).click();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    const again = await state(page);
    expect(again.muted).toBe(true);
    expect(again.volumes.effects).toBe(0.35);
    expect(again.phase).toBe("playing");
    await expect(page.locator(".sound-off")).toBeVisible();
    // The music is murky again for the new dive.
    expect(again.music.cutoffTarget).toBe(sound.music.muffledHz);

    // A refresh starts from the defaults: nothing was stored.
    await page.reload();
    await startDive(page);
    const fresh = await state(page);
    expect(fresh.volumes).toEqual({ music: 0.6, effects: 0.8 });
    expect(fresh.muted).toBe(false);
    expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain("reefreviver.audio");
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => !key.startsWith("reefreviver.lang")))).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("music that cannot be loaded leaves the game playable, with ambience and effects, and only a warning (AC-8)", async ({ page }) => {
    const problems = await boot(page);
    const warnings: string[] = [];
    page.on("console", (message) => message.type() === "warning" && warnings.push(message.text()));
    await page.route("**/*.ogg", (route) => route.abort());
    await startDive(page);
    await expect.poll(async () => (await state(page)).music.state).toBe("failed");
    expect(warnings.some((text) => text.includes("music could not be loaded"))).toBe(true);
    const failed = await state(page);
    expect(failed.available).toBe(true);
    expect(failed.ambience.under).toBe(sound.ambience.level);
    await expect.poll(async () => (await state(page)).level, { timeout: 10_000 }).toBeGreaterThan(0.0005);
    // The game plays on: the ROV moves and an effect still sounds.
    const before = await reef(page, (h) => h.rovPosition() as Vec);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => Math.hypot(...((await reef(page, (h) => h.rovPosition() as Vec)).map((v, i) => v - before[i]))), { timeout: 20_000 }).toBeGreaterThan(1);
    await page.keyboard.up("KeyW");
    await reef(page, (h) => h.playSound("deposit"));
    expect(await fired(page)).toContain("deposit");
    expect(problems).toEqual([]);
  });

  test("a browser without Web Audio plays the game without sound; the Sound view says so (AC-8)", async ({ page }) => {
    const problems = await boot(page);
    const warnings: string[] = [];
    page.on("console", (message) => message.type() === "warning" && warnings.push(message.text()));
    await page.addInitScript(() => {
      delete (window as any).AudioContext;
      delete (window as any).webkitAudioContext;
    });
    await startDive(page);
    expect((await state(page)).available).toBe(false);
    expect(warnings.some((text) => text.includes("no Web Audio"))).toBe(true);
    // Everything else works: moving, M, pausing and the Sound view.
    const before = await reef(page, (h) => h.rovPosition() as Vec);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => Math.hypot(...((await reef(page, (h) => h.rovPosition() as Vec)).map((v, i) => v - before[i]))), { timeout: 20_000 }).toBeGreaterThan(1);
    await page.keyboard.up("KeyW");
    await page.keyboard.press("KeyM");
    await expect(page.locator(".sound-off")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Suara" }).click();
    await expect(page.locator(".notice")).toContainText("tidak bisa memutar suara");
    await page.locator("#volume-music").fill("10");
    await page.getByRole("button", { name: "Kembali" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    expect(problems).toEqual([]);
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the tag, the Sound view and the Controls row are in English (G-004)", async ({ page }) => {
    const problems = await boot(page);
    await startDive(page);
    await page.keyboard.press("KeyM");
    await expect(page.locator(".sound-off")).toHaveText("Sound off");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Controls" }).click();
    const row = page.locator("dt", { hasText: /^M$/ });
    await expect(row.locator("+ dd")).toHaveText("Turn sound off or on");
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Sound" }).click();
    await expect(page.locator("label")).toHaveText(["Music", "Sound effects"]);
    await page.screenshot({ path: "test-results/req-026-sound-view-en.png" });
    expect(problems).toEqual([]);
  });

  test("the credits name the music, its maker and licence (AC-4, G-005)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Credits" }).click();
    const item = page.locator(".credit-list li", { hasText: "Underwater Ambient Pad" });
    await expect(item).toContainText("by isaiah658");
    await expect(item).toContainText("Licence: CC0 1.0");
    await expect(item.locator("a")).toHaveAttribute("href", "https://opengameart.org/content/underwater-ambient-pad");
  });
});
