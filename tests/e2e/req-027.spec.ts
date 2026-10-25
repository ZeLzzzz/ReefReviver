import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { Vector3 } from "three";
import { beachGroup, cameraBlocked } from "../../src/game/cinematic";

// REQ-027: the opening cinematic. The browser tests start with the cinematics off (dev server with VITE_TEST_SEED), so each test
// here turns them on with `__reef.cinematics(true)` before Mulai. `seekCinematic` jumps its clock so most checks need not wait.

type Vec = [number, number, number];
type Cine = { kind: string; time: number; duration: number; shot: number; skipping: boolean; hud: { caption: string | null; captionOpacity: number; letterbox: number } } | null;

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const { cinematic, rov } = config;
const mode = (page: Page) => reef(page, (h) => h.mode());
const cine = (page: Page) => reef(page, (h) => h.cinematic()) as Promise<Cine>;
const camera = (page: Page) => reef(page, (h) => h.cameraPosition()) as Promise<Vec>;
const position = (page: Page) => reef(page, (h) => h.rovPosition()) as Promise<Vec>;
const audioState = (page: Page) => reef(page, (h) => h.audio()) as Promise<{ phase: string; muted: boolean; ambience: { under: number; above: number } }>;

async function boot(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) problems.push(`console: ${message.text()}`);
  });
  return problems;
}

/** Opens the game with the cinematics on and presses Mulai; the opening is playing when it returns. */
async function startWithCinematics(page: Page, button: RegExp = /Mulai|Start/) {
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
  await reef(page, (h) => h.cinematics(true));
  await page.getByRole("button", { name: button }).click();
  await expect.poll(() => mode(page)).toBe("playing");
  await expect.poll(() => cine(page)).not.toBeNull();
}

/** Jumps the opening's clock and waits for a few frames to draw it. */
async function seek(page: Page, seconds: number) {
  await reef(page, (h, a) => h.seekCinematic(a.seconds), { seconds });
  await page.waitForTimeout(250);
}

/** Lets the opening go to its end without waiting for it, and waits until the player has the control. */
async function finishOpening(page: Page) {
  await seek(page, cinematic.opening.duration - 0.6);
  await expect.poll(() => cine(page), { timeout: 15_000 }).toBeNull();
  await expect(page.locator(".crosshair")).toBeVisible();
}

const floatingTrash = async (page: Page) => (await reef(page, (h) => h.surfaceTrash())) as Vec[];

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("Mulai plays the opening before the player can move: bars, hint, no HUD or crosshair; the camera goes from high up to under water to behind the submarine (AC-1, AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page);
    await startWithCinematics(page);
    const start = await position(page);
    expect(start).toEqual([rov.start.x, rov.start.y, rov.start.z]);

    // The black bars, the hint, and none of the HUD.
    await expect(page.locator(".cine")).toBeVisible();
    await expect(page.locator(".cine-bar-top")).toBeVisible();
    await expect(page.locator(".cine-bar-bottom")).toBeVisible();
    await expect(page.locator(".cine-skip")).toHaveText("Klik atau Spasi untuk melewati");
    await expect(page.locator(".crosshair")).toBeHidden();
    await expect(page.locator(".hud-goals")).toBeHidden();
    await expect(page.locator(".hud-stats")).toBeHidden();
    await expect(page.locator(".hud-tool")).toBeHidden();
    await expect(page.locator(".hud-minimap")).toBeHidden();
    await expect(page.locator(".station-marker")).toBeHidden();
    const viewport = page.viewportSize()!;
    // They slide in over the first moments.
    await expect
      .poll(async () => (await page.evaluate(() => [...document.querySelectorAll(".cine-bar")].map((bar) => bar.getBoundingClientRect().height))).map((height) => height / viewport.height))
      .toEqual([expect.closeTo(cinematic.letterbox, 2), expect.closeTo(cinematic.letterbox, 2)]);

    // From high up, the sea above the water at first.
    await seek(page, 2);
    expect((await camera(page))[1]).toBeGreaterThan(20);
    expect((await reef(page, (h) => h.view())) as { above: boolean }).toMatchObject({ above: true });
    await page.screenshot({ path: "test-results/req-027-aerial.png" });

    // WASD, Space, the tools, E and L do nothing meanwhile.
    for (const key of ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"]) await page.keyboard.down(key);
    await page.waitForTimeout(600);
    for (const key of ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"]) await page.keyboard.up(key);
    for (const key of ["Digit1", "Digit3", "Digit4", "KeyE", "KeyL"]) await page.keyboard.press(key);
    await page.waitForTimeout(300);
    expect(await position(page)).toEqual(start);
    expect(await mode(page)).toBe("playing");
    expect(((await reef(page, (h) => h.hud())) as { tool: string }).tool).toBe("vacuum");
    await expect(page.locator(".logbook-screen, .logbook")).toHaveCount(0);

    // A low glide over the surface.
    await seek(page, 12);
    const glide = await camera(page);
    expect(glide[1]).toBeGreaterThan(config.bay.surfaceY);
    expect(glide[1]).toBeLessThan(config.bay.surfaceY + cinematic.opening.glide.height + 4);
    expect((await cine(page))!.shot).toBe(1);
    await page.screenshot({ path: "test-results/req-027-glide.png" });

    // Then under water, and it ends behind the submarine.
    await seek(page, 20);
    expect((await camera(page))[1]).toBeLessThan(config.bay.surfaceY);
    expect((await cine(page))!.shot).toBe(2);
    await page.screenshot({ path: "test-results/req-027-dive.png" });
    await finishOpening(page);
    const [x, y, z] = await camera(page);
    expect(x).toBeCloseTo(rov.start.x - 6, 0);
    expect(y).toBeCloseTo(rov.start.y + 2, 0);
    expect(z).toBeCloseTo(rov.start.z, 0);
    expect(problems).toEqual([]);
  });

  test("the narration comes in turn at the bottom, in Indonesian, one line at a time (AC-2)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    const caption = page.locator(".cine-caption");
    const lines = ["Teluk ini dulu penuh kehidupan.", "Kini sampah, jaring hantu, dan karang yang memucat menguasainya.", "Saatnya memulihkannya."];
    for (const [index, line] of lines.entries()) {
      const { from, to } = cinematic.opening.captions[index];
      await seek(page, (from + to) / 2);
      await expect(caption).toHaveText(line);
      await expect.poll(async () => Number(await caption.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
      // Below the picture, in the bottom bar.
      const box = (await caption.boundingBox())!;
      expect(box.y).toBeGreaterThan(page.viewportSize()!.height * (1 - cinematic.letterbox - 0.01));
    }
    // Between the lines there is none.
    const between = (cinematic.opening.captions[0].to + cinematic.opening.captions[1].from) / 2;
    await seek(page, between);
    await expect.poll(async () => Number(await caption.evaluate((el) => getComputedStyle(el).opacity))).toBe(0);
  });

  test("the ambience follows the camera through the surface; the music and ambience play (AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await seek(page, 3);
    await expect.poll(async () => (await audioState(page)).phase).toBe("playing");
    await expect.poll(async () => (await audioState(page)).ambience.above).toBeGreaterThan((await audioState(page)).ambience.under);
    await seek(page, 19);
    expect((await reef(page, (h) => h.view())) as { above: boolean }).toMatchObject({ above: false });
    await expect.poll(async () => (await audioState(page)).ambience.under).toBeGreaterThan((await audioState(page)).ambience.above);
    expect((await audioState(page)).muted).toBe(false);
  });

  test("M still turns the sound off during it (AC-4)", async ({ page }) => {
    await startWithCinematics(page);
    expect((await audioState(page)).muted).toBe(false);
    await page.keyboard.press("KeyM");
    await expect.poll(async () => (await audioState(page)).muted).toBe(true);
    await page.keyboard.press("KeyM");
    await expect.poll(async () => (await audioState(page)).muted).toBe(false);
    expect(await cine(page)).not.toBeNull();
  });

  test("a click skips it: a short fade, then the player has the submarine at the start and the HUD (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await seek(page, 6);
    await page.mouse.click(400, 225);
    // The screen goes dark...
    await expect.poll(() => reef(page, (h) => h.screenFade()), { timeout: 5_000 }).toBeGreaterThan(0.3);
    // ... and the control is back with the camera behind the submarine, and the HUD, as the fade comes up.
    await expect.poll(() => cine(page), { timeout: 5_000 }).toBeNull();
    await expect(page.locator(".crosshair")).toBeVisible();
    await expect(page.locator(".cine")).toBeHidden();
    await expect.poll(() => reef(page, (h) => h.screenFade()), { timeout: 5_000 }).toBe(0);
    expect(await position(page)).toEqual([rov.start.x, rov.start.y, rov.start.z]);
    const [x, y, z] = await camera(page);
    expect(x).toBeCloseTo(rov.start.x - 6, 0);
    expect(y).toBeCloseTo(rov.start.y + 2, 0);
    expect(z).toBeCloseTo(rov.start.z, 0);
    // The player flies the submarine.
    const before = await position(page);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => Math.hypot(...(await position(page)).map((v, i) => v - before[i])), { timeout: 15_000 }).toBeGreaterThan(1.5);
    await page.keyboard.up("KeyW");
  });

  test("Space skips it too, and the Space does not also lift the submarine (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await seek(page, 9);
    await page.keyboard.down("Space");
    await expect.poll(() => cine(page), { timeout: 5_000 }).toBeNull();
    // Still held after the skip: the submarine does not rise.
    await page.waitForTimeout(700);
    const held = await position(page);
    expect(held[1]).toBeCloseTo(rov.start.y, 1);
    await page.keyboard.up("Space");
    await page.keyboard.down("Space");
    await expect.poll(async () => (await position(page))[1], { timeout: 15_000 }).toBeGreaterThan(rov.start.y + 0.5);
    await page.keyboard.up("Space");
  });

  test("when it ends by itself the camera is already where the follow camera stands, the HUD comes, and the player moves (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await seek(page, cinematic.opening.duration - 2);
    // In the last seconds the camera merges into the follow camera: it is close to it, then on it.
    const expected: Vec = [rov.start.x - 6, rov.start.y + 2, rov.start.z];
    const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    await seek(page, cinematic.opening.duration - 0.3);
    expect(distance(await camera(page), expected)).toBeLessThan(1);
    await expect.poll(() => cine(page), { timeout: 10_000 }).toBeNull();
    await expect(page.locator(".crosshair")).toBeVisible();
    await expect(page.locator(".hud-goals")).toBeVisible();
    expect(distance(await camera(page), expected)).toBeLessThan(0.05);
    const before = await position(page);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => Math.hypot(...(await position(page)).map((v, i) => v - before[i])), { timeout: 15_000 }).toBeGreaterThan(1.5);
    await page.keyboard.up("KeyW");
  });

  test("the play time counts only after the opening (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await seek(page, 4);
    await page.waitForTimeout(1500);
    expect(await reef(page, (h) => h.playSeconds())).toBe(0);
    await finishOpening(page);
    const after = (await reef(page, (h) => h.playSeconds())) as number;
    await page.waitForTimeout(1500);
    const later = (await reef(page, (h) => h.playSeconds())) as number;
    expect(later - after).toBeGreaterThan(1);
  });

  test("it plays on the first Mulai only: Main lagi starts at once, and after a refresh Mulai plays it again (AC-6)", async ({ page }) => {
    test.setTimeout(240_000);
    await startWithCinematics(page);
    expect(await reef(page, (h) => h.openingPlayed())).toBe(true);
    await finishOpening(page);
    // To the end screen, with no other cinematic in the way: the Bloom and the ending belong to REQ-028.
    await reef(page, (h) => {
      h.cinematics(false);
      h.freeAnimals();
      h.removeTrash(50);
      h.plantAll();
    });
    await expect.poll(async () => ((await reef(page, (h) => h.bloom())) as { state: string }).state, { timeout: 120_000 }).toBe("done");
    await reef(page, (h) => ["turtle", "reefShark", "clownfish", "mantaRay", "dolphin", "coral", "seagrass"].forEach((id) => h.scanEntry(id)));
    await expect(page.locator(".end-screen")).toBeVisible({ timeout: 30_000 });
    await reef(page, (h) => h.cinematics(true));
    await page.getByRole("button", { name: "Main lagi" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    // At once: the HUD, no bars, no cinematic, at the start.
    await expect(page.locator(".crosshair")).toBeVisible();
    await expect(page.locator(".cine")).toBeHidden();
    expect(await cine(page)).toBeNull();
    expect(await position(page)).toEqual([rov.start.x, rov.start.y, rov.start.z]);

    // Refreshed, the game has forgotten it (nothing is saved, D-021): Mulai plays it again.
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
    expect(await reef(page, (h) => h.openingPlayed())).toBe(false);
    await reef(page, (h) => h.cinematics(true));
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(async () => (await cine(page))?.kind).toBe("opening");
    await expect(page.locator(".cine")).toBeVisible();
    const storage = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    expect(storage.filter((key) => /cine|intro|opening/i.test(key))).toEqual([]);
  });

  test("Esc stops it with the game and shows the pause menu; leaving the window does the same; Lanjut goes on from the same point (AC-7)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await seek(page, 6);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
    const paused = (await cine(page))!;
    const camAtPause = await camera(page);
    await page.waitForTimeout(1500);
    expect((await cine(page))!.time).toBe(paused.time);
    expect(await camera(page)).toEqual(camAtPause);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(page.locator(".cine")).toBeVisible();
    await expect(page.locator(".crosshair")).toBeHidden();
    const resumed = (await cine(page))!;
    expect(resumed.time).toBeGreaterThanOrEqual(paused.time);
    expect(resumed.time).toBeLessThan(paused.time + 1);
    // It goes on from there.
    await expect.poll(async () => (await cine(page))!.time, { timeout: 10_000 }).toBeGreaterThan(resumed.time + 0.8);

    // Leaving the window (or the tab) pauses it the same way.
    const before = (await cine(page))!.time;
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
    const left = (await cine(page))!.time;
    expect(left).toBeGreaterThanOrEqual(before);
    await page.waitForTimeout(1000);
    expect((await cine(page))!.time).toBe(left);
  });

  test("the camera keeps the floating trash near the beach in view, whichever way it flies, and never goes inside the terrain or the buildings; the frame rate holds (AC-8)", async ({ page }) => {
    test.setTimeout(180_000);
    await startWithCinematics(page);
    const trash = await floatingTrash(page);
    const group = beachGroup(trash.map(([x, y, z]) => ({ x, y, z })))!;
    expect(Math.abs(group.z)).toBeLessThanOrEqual(config.trash.surface.beachHalfLength);

    // The real frames, at a few moments of the first half: the group is on the screen, between the bars.
    const { height, width } = page.viewportSize()!;
    for (const t of [0.8, 3, 6, 8.5, 10, 12, 14]) {
      await seek(page, t);
      const at = (await reef(page, (h, a) => h.screenOf(a.x, a.y, a.z), { x: group.x, y: group.y, z: group.z })) as [number, number] | null;
      expect(at, `the group at ${t} s`).not.toBeNull();
      expect(at![0]).toBeGreaterThan(0);
      expect(at![0]).toBeLessThan(width);
      expect(at![1]).toBeGreaterThan(height * cinematic.letterbox);
      expect(at![1]).toBeLessThan(height * (1 - cinematic.letterbox));
    }

    // Then a whole run at the real speed: where the camera is, and how many frames a second the game draws.
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[] };
      w.__frames = [];
      const tick = (time: number) => {
        w.__frames.push(time);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await seek(page, 0.2);
    const cameras: Vec[] = [];
    while ((await cine(page)) !== null) {
      cameras.push(await camera(page));
      await page.waitForTimeout(150);
    }
    for (const [x, y, z] of cameras) expect(cameraBlocked(x, y, z, 0.3), `camera at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
    const frames = (await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames)) as number[];
    const seconds = (frames[frames.length - 1] - frames[0]) / 1000;
    const fps = (frames.length - 1) / seconds;
    test.info().annotations.push({ type: "fps during the opening", description: `${fps.toFixed(1)} over ${seconds.toFixed(1)} s` });
    expect(fps).toBeGreaterThanOrEqual(30);
    // The slowest stretch too: no second where it dropped under 30.
    let slowest = Infinity;
    for (let i = 0; i < frames.length; i++) {
      let j = i;
      while (j < frames.length && frames[j] - frames[i] < 1000) j++;
      if (j < frames.length) slowest = Math.min(slowest, j - i);
    }
    expect(slowest).toBeGreaterThanOrEqual(30);
    // The camera stayed inside the world: it ended where it began to play.
    expect(new Vector3(...(await camera(page))).distanceTo(new Vector3(rov.start.x - 6, rov.start.y + 2, rov.start.z))).toBeLessThan(0.5);
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the narration, the hint and the bars are in English (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page, /Start/);
    await expect(page.locator(".cine-skip")).toHaveText("Click or Space to skip");
    const lines = ["This bay was once full of life.", "Now trash, ghost nets and bleaching corals have taken over.", "Time to bring it back."];
    for (const [index, line] of lines.entries()) {
      const { from, to } = cinematic.opening.captions[index];
      await seek(page, (from + to) / 2);
      await expect(page.locator(".cine-caption")).toHaveText(line);
    }
    await page.screenshot({ path: "test-results/req-027-english.png" });
    await page.keyboard.press("Space");
    await expect.poll(() => cine(page), { timeout: 5_000 }).toBeNull();
    await expect(page.locator(".crosshair")).toBeVisible();
  });
});
