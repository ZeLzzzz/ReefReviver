import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { cameraBlocked } from "../../src/game/cinematic";
import { boardAgain, goAshore } from "./ashore";

// REQ-028: the Bloom's cinematic and the ending's. The browser tests start with the cinematics off (dev server with
// VITE_TEST_SEED); a test turns them on with `__reef.cinematics(true)`, as REQ-027's do. They are turned on after Mulai here,
// unless the test is about the opening too, so the opening does not stand in the way.

type Vec = [number, number, number];
type Cine = { kind: string; time: number; duration: number; shot: number; skipping: boolean; hud: { caption: string | null; letterbox: number } } | null;

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const { cinematic, rov, bloom } = config;
const FLOAT_Y = config.bay.surfaceY - rov.floatDepth;
const mode = (page: Page) => reef(page, (h) => h.mode());
const cine = (page: Page) => reef(page, (h) => h.cinematic()) as Promise<Cine>;
const camera = (page: Page) => reef(page, (h) => h.cameraPosition()) as Promise<Vec>;
const position = (page: Page) => reef(page, (h) => h.rovPosition()) as Promise<Vec>;
const bloomState = (page: Page) => reef(page, (h) => h.bloom()) as Promise<{ state: string; progress: number; clarity: number }>;
const playSeconds = (page: Page) => reef(page, (h) => h.playSeconds()) as Promise<number>;
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const asPlayTime = (seconds: number) => `${Math.floor(Math.floor(seconds) / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
const ALL_ENTRIES = ["turtle", "reefShark", "clownfish", "mantaRay", "dolphin", "coral", "seagrass"];

async function boot(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) problems.push(`console: ${message.text()}`);
  });
  return problems;
}

async function startDive(page: Page, button: RegExp = /Mulai|Start/) {
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
  await page.getByRole("button", { name: button }).click();
  await expect.poll(() => mode(page)).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  await page.mouse.move(0, 0);
}

/** Frees both animals, cleans to 80 % and plants every site: the Bloom starts at once. */
async function triggerBloom(page: Page) {
  await reef(page, (h) => {
    h.freeAnimals();
    h.removeTrash(50);
    h.plantAll();
  });
}

async function seek(page: Page, seconds: number) {
  await reef(page, (h, a) => h.seekCinematic(a.seconds), { seconds });
  await page.waitForTimeout(250);
}

const caption = (page: Page) => page.locator(".cine-caption");
const noticeText = (page: Page) => page.locator(".message-notice");
const endScreen = (page: Page) => page.locator(".end-screen");

/** Waits for the Bloom's cinematic to start, which is the frame after the conditions hold. */
async function bloomCinematic(page: Page) {
  await expect.poll(async () => (await cine(page))?.kind, { timeout: 20_000 }).toBe("bloom");
}

/** Starts counting the frames the page draws (their times, in milliseconds). */
async function countFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    const tick = (time: number) => {
      w.__frames.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** The fewest frames in any second since `countFrames`, and the average a second. */
async function frameRate(page: Page): Promise<{ slowest: number; average: number }> {
  const frames = (await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames)) as number[];
  let slowest = Infinity;
  for (let i = 0; i < frames.length; i++) {
    let j = i;
    while (j < frames.length && frames[j] - frames[i] < 1000) j++;
    if (j < frames.length) slowest = Math.min(slowest, j - i);
  }
  return { slowest, average: (frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000) };
}

/** The same sampled while it plays: where the camera is, every so often, until the cinematic is over. */
async function sampleCamera(page: Page, every = 120): Promise<{ cameras: Vec[]; cave: number[] }> {
  const cameras: Vec[] = [];
  const cave: number[] = [];
  while ((await cine(page)) !== null) {
    const [c, level] = (await reef(page, (h) => [h.cameraPosition(), h.cave().cameraLevel])) as [Vec, number];
    cameras.push(c);
    cave.push(level);
    await page.waitForTimeout(every);
  }
  return { cameras, cave };
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("under water: control stops, the camera pulls away and circles while the bay clears, then it is back behind the submarine, control returns, and the notice shows (AC-1, AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page);
    await startDive(page);
    // Open water, clear of the rocks, facing east.
    await reef(page, (h) => h.placeRov(-30, -9, 30, Math.PI / 2, 0));
    await page.waitForTimeout(300);
    await reef(page, (h) => h.cinematics(true));
    const before = await position(page);
    await countFrames(page);
    await triggerBloom(page);
    await bloomCinematic(page);

    // The look: bars, hint and no HUD.
    await expect(page.locator(".cine")).toBeVisible();
    await expect(page.locator(".cine-skip")).toHaveText("Klik atau Spasi untuk melewati");
    await expect(page.locator(".crosshair")).toBeHidden();
    await expect(page.locator(".hud-goals")).toBeHidden();
    await expect(page.locator(".hud-stats")).toBeHidden();
    await expect(caption(page)).toHaveCount(1);
    const info = (await cine(page))!;
    expect(info.duration).toBe(bloom.seconds);

    // The player has no control: WASD and Shift, the tools, E and L do nothing (Space skips).
    for (const key of ["KeyW", "KeyD", "ShiftLeft"]) await page.keyboard.down(key);
    await page.waitForTimeout(500);
    for (const key of ["KeyW", "KeyD", "ShiftLeft"]) await page.keyboard.up(key);
    for (const key of ["Digit1", "Digit3", "KeyE", "KeyL"]) await page.keyboard.press(key);
    expect(distance(await position(page), before)).toBeLessThan(1e-6);
    expect(await mode(page)).toBe("playing");
    await expect(page.locator(".logbook")).toHaveCount(0);

    // The camera pulls away: further from the submarine than the follow camera, and the bay clears as it does.
    await expect.poll(async () => (await cine(page))?.time ?? 99).toBeGreaterThan(2.4);
    const mid = await camera(page);
    expect(distance(mid, await position(page))).toBeGreaterThan(8);
    expect((await bloomState(page)).clarity).toBeGreaterThan(0.15);
    await page.screenshot({ path: "test-results/req-028-bloom-under.png" });
    // It circles: the camera's bearing from the submarine changes.
    const bearing = (c: Vec, s: Vec) => Math.atan2(c[0] - s[0], c[2] - s[2]);
    const sub = await position(page);
    const first = bearing(mid, sub);
    await expect.poll(async () => Math.abs(bearing(await camera(page), sub) - first), { timeout: 10_000 }).toBeGreaterThan(0.3);

    // After the transition the camera is back where the follow camera stands, control is back, and the message shows.
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await expect(page.locator(".crosshair")).toBeVisible();
    await expect(noticeText(page)).toHaveText("Teluk kembali jernih. Scanner terbuka!");
    expect((await bloomState(page)).state).toBe("done");
    const yaw = (await reef(page, (h) => h.rovYaw())) as number;
    const expected: Vec = [before[0] - Math.sin(yaw) * config.camera.distance, before[1] + config.camera.height, before[2] - Math.cos(yaw) * config.camera.distance];
    expect(distance(await camera(page), expected)).toBeLessThan(0.05);
    const rate = await frameRate(page);
    test.info().annotations.push({ type: "fps during the Bloom, under water", description: rate.average.toFixed(1) });
    expect(rate.slowest).toBeGreaterThanOrEqual(30);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => distance(await position(page), before), { timeout: 15_000 }).toBeGreaterThan(1.5);
    await page.keyboard.up("KeyW");
    expect(problems).toEqual([]);
  });

  test("at the surface and on land it rises high to show the sea turning blue (AC-1)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    // Afloat at the surface.
    await reef(page, (h, a) => h.placeRov(-60, a.y, 20, 1.2, 0), { y: FLOAT_Y });
    await page.waitForTimeout(300);
    await countFrames(page);
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(async () => (await cine(page))?.time ?? 99).toBeGreaterThan(2.6);
    const high = await camera(page);
    expect(high[1]).toBeGreaterThan(FLOAT_Y + 14);
    expect(((await reef(page, (h) => h.view())) as { above: boolean }).above).toBe(true);
    expect((await bloomState(page)).clarity).toBeGreaterThan(0.2);
    await page.screenshot({ path: "test-results/req-028-bloom-surface.png" });
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await expect(noticeText(page)).toHaveText("Teluk kembali jernih. Scanner terbuka!");
    // The frame rate held, with the whole bay in view from up there (AC-7).
    const rate = await frameRate(page);
    test.info().annotations.push({ type: "fps during the Bloom, from the surface", description: rate.average.toFixed(1) });
    expect(rate.slowest).toBeGreaterThanOrEqual(30);
  });

  test("on land too: it rises over the shore, looking out over the sea, and lands on the first-person view (AC-1)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await goAshore(page, 8);
    const eye = await camera(page);
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(async () => (await cine(page))?.time ?? 99).toBeGreaterThan(2.6);
    const high = await camera(page);
    expect(high[1]).toBeGreaterThan(eye[1] + 10);
    await page.screenshot({ path: "test-results/req-028-bloom-ashore.png" });
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    expect(distance(await camera(page), eye)).toBeLessThan(0.05);
    await expect(page.locator(".crosshair")).toBeVisible();
    expect(await reef(page, (h) => h.onLand())).toBe(true);
    await boardAgain(page);
  });

  test("when the player is in the cave the camera stays in the tunnel, and never in its walls or roof (AC-7)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    const path = ((await reef(page, (h) => h.cave())) as { path: { x: number; y: number; z: number }[] }).path;
    const point = path[Math.floor(path.length * 0.5)];
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0), point);
    await page.waitForTimeout(400);
    expect(((await reef(page, (h) => h.cave())) as { level: number }).level).toBeGreaterThan(0.5);
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(async () => (await cine(page))?.time ?? 0).toBeGreaterThan(2.4);
    await page.screenshot({ path: "test-results/req-028-bloom-cave.png" });
    const { cameras, cave } = await sampleCamera(page, 100);
    expect(cameras.length).toBeGreaterThan(10);
    for (const [index, [x, y, z]] of cameras.entries()) {
      expect(cameraBlocked(x, y, z, 0.3), `camera ${index} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
      expect(cave[index], `camera ${index} in the tunnel`).toBeGreaterThanOrEqual(cinematic.bloom.caveHold - 0.01);
    }
  });

  test("a click skips the Bloom's cinematic and gives back the control at once; the transition goes on and finishes as usual (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await reef(page, (h) => h.placeRov(-30, -9, 30, Math.PI / 2, 0));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(async () => (await cine(page))?.time ?? 99).toBeGreaterThan(1);
    await page.mouse.click(300, 200);
    await expect.poll(() => reef(page, (h) => h.screenFade()), { timeout: 5_000 }).toBeGreaterThan(0.3);
    await expect.poll(() => cine(page), { timeout: 5_000 }).toBeNull();
    await expect(page.locator(".crosshair")).toBeVisible();
    // The Bloom had not finished: it does, and the message comes.
    expect((await bloomState(page)).state).toBe("running");
    const here = await position(page);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => distance(await position(page), here), { timeout: 15_000 }).toBeGreaterThan(1.5);
    await page.keyboard.up("KeyW");
    await expect.poll(async () => (await bloomState(page)).state, { timeout: 20_000 }).toBe("done");
    await expect(noticeText(page)).toHaveText("Teluk kembali jernih. Scanner terbuka!");
    expect((await bloomState(page)).clarity).toBe(1);
  });

  test("Space skips it too (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await triggerBloom(page);
    await bloomCinematic(page);
    await page.keyboard.press("Space");
    await expect.poll(() => cine(page), { timeout: 5_000 }).toBeNull();
    await expect.poll(async () => (await bloomState(page)).state, { timeout: 20_000 }).toBe("done");
  });

  test("Esc stops the Bloom's cinematic and its transition together; Lanjut goes on from the same point (AC-6)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await reef(page, (h) => h.placeRov(-30, -9, 30, Math.PI / 2, 0));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(async () => (await cine(page))?.time ?? 0).toBeGreaterThan(1.5);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
    const paused = (await cine(page))!;
    const progress = (await bloomState(page)).progress;
    const where = await camera(page);
    await page.waitForTimeout(1500);
    expect((await cine(page))!.time).toBe(paused.time);
    expect((await bloomState(page)).progress).toBe(progress);
    expect(await camera(page)).toEqual(where);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(page.locator(".cine")).toBeVisible();
    expect((await cine(page))!.time).toBeLessThan(paused.time + 1);
    await expect.poll(async () => (await cine(page))?.time ?? 99, { timeout: 10_000 }).toBeGreaterThan(paused.time + 0.8);
    // Leaving the window pauses it the same way.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
  });

  test("after the 7th entry and its notice the camera flies over the restored bay, with the closing line, and then the end screen shows; the time and score are the same as at the 7th entry (AC-2, AC-3, AC-5, AC-7)", async ({ page }) => {
    test.setTimeout(240_000);
    const problems = await boot(page);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await expect.poll(async () => (await bloomState(page)).state).toBe("done");

    // The 7th entry: its notice first.
    const score = ((await reef(page, (h) => h.hud())) as { score: number }).score;
    await reef(page, (h, a) => a.ids.forEach((id: string) => h.scanEntry(id)), { ids: ALL_ENTRIES });
    const scannedAt = Date.now();
    const seconds = await playSeconds(page);
    await expect(noticeText(page)).toHaveText("Entri baru: Lamun");
    expect(await cine(page)).toBeNull();
    await expect(endScreen(page)).toHaveCount(0);

    // After the notice (3 s) the ending begins.
    await expect.poll(async () => (await cine(page))?.kind, { timeout: 20_000 }).toBe("ending");
    expect(Date.now() - scannedAt).toBeGreaterThan(2000);
    await expect(page.locator(".cine")).toBeVisible();
    await expect(page.locator(".cine-skip")).toHaveText("Klik atau Spasi untuk melewati");
    await expect(page.locator(".crosshair")).toBeHidden();
    await expect(page.locator(".hud-goals")).toBeHidden();
    await expect(endScreen(page)).toHaveCount(0);
    expect((await cine(page))!.duration).toBeGreaterThanOrEqual(15);
    expect((await cine(page))!.duration).toBeLessThanOrEqual(20);

    // It runs at the real speed: the camera never in the rock, the frame rate holds; it ends in the end screen.
    await countFrames(page);
    const shots = new Set<number>();
    const cameras: Vec[] = [];
    const lines = new Set<string>();
    let shot4Above = false;
    while ((await cine(page)) !== null) {
      const now = await cine(page);
      if (!now) break;
      shots.add(now.shot);
      cameras.push(await camera(page));
      if (now.hud.caption) lines.add(now.hud.caption);
      if (now.shot === 4 && ((await reef(page, (h) => h.view())) as { above: boolean }).above) shot4Above = true;
      await page.waitForTimeout(180);
    }
    expect([...shots].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...lines]).toEqual(["cinematic.ending"]);
    expect(shot4Above).toBe(true);
    for (const [x, y, z] of cameras) expect(cameraBlocked(x, y, z, 0.3), `camera at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
    const rate = await frameRate(page);
    expect(rate.slowest).toBeGreaterThanOrEqual(30);
    test.info().annotations.push({ type: "fps during the ending", description: rate.average.toFixed(1) });

    // The end screen: the same time and score as at the 7th entry.
    await expect(endScreen(page)).toBeVisible({ timeout: 10_000 });
    expect(await mode(page)).toBe("paused");
    expect(await playSeconds(page)).toBe(seconds);
    const rows = await page.locator(".end-stats > div").evaluateAll((all) => all.map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
    expect(rows).toEqual([
      ["Sampah terangkat", "50/60"],
      ["Satwa diselamatkan", "2/2"],
      ["Rangka koral ditanami", "3/3"],
      ["Petak lamun ditanami", "2/2"],
      ["Waktu bermain", asPlayTime(seconds)],
      ["Skor", String(score)],
    ]);
    expect(problems).toEqual([]);
  });

  test("the ending shows each part: the reef, the fish, the manta rays, the dolphins, then the beach (AC-2)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await reef(page, (h, a) => a.ids.forEach((id: string) => h.scanEntry(id)), { ids: ALL_ENTRIES });
    await expect.poll(async () => (await cine(page))?.kind, { timeout: 20_000 }).toBe("ending");
    const shots = cinematic.ending.shots;
    let at = 0;
    for (const [index, length] of shots.entries()) {
      await seek(page, at + length / 2);
      await page.screenshot({ path: `test-results/req-028-ending-${index}.png` });
      expect((await cine(page))!.shot).toBe(index);
      if (index < 4) await expect.poll(async () => Number(await caption(page).evaluate((el) => getComputedStyle(el).opacity))).toBe(0);
      at += length;
    }
    // The closing line, in the last shot.
    await seek(page, at - shots[4] + (cinematic.ending.caption.from + cinematic.ending.caption.to) / 2);
    await expect(caption(page)).toHaveText("Teluk ini hidup kembali.");
    await expect.poll(async () => Number(await caption(page).evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);
    // Above the water, looking at the beach, by the end.
    await seek(page, at - 0.8);
    expect((await camera(page))[1]).toBeGreaterThan(5);
    expect(((await reef(page, (h) => h.view())) as { above: boolean }).above).toBe(true);
  });

  test("a click during the ending goes straight to the end screen, with the same numbers (AC-4, AC-5)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await reef(page, (h, a) => a.ids.forEach((id: string) => h.scanEntry(id)), { ids: ALL_ENTRIES });
    const seconds = await playSeconds(page);
    await expect.poll(async () => (await cine(page))?.kind, { timeout: 20_000 }).toBe("ending");
    await seek(page, 6);
    await page.mouse.click(300, 200);
    await expect(endScreen(page)).toBeVisible({ timeout: 5_000 });
    expect(await cine(page)).toBeNull();
    expect(await mode(page)).toBe("paused");
    expect(await playSeconds(page)).toBe(seconds);
    await expect(page.locator(".end-stats > div").nth(4).locator("dd")).toHaveText(asPlayTime(seconds));
  });

  test("Esc and leaving the window pause the ending; Lanjut goes on (AC-6)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await reef(page, (h) => h.cinematics(true));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await reef(page, (h, a) => a.ids.forEach((id: string) => h.scanEntry(id)), { ids: ALL_ENTRIES });
    await expect.poll(async () => (await cine(page))?.kind, { timeout: 20_000 }).toBe("ending");
    await seek(page, 5);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    const paused = (await cine(page))!;
    await page.waitForTimeout(1500);
    expect((await cine(page))!.time).toBe(paused.time);
    expect(await mode(page)).toBe("paused");
    await expect(endScreen(page)).toHaveCount(0);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    expect((await cine(page))!.time).toBeLessThan(paused.time + 1);
    await expect.poll(async () => (await cine(page))?.time ?? 0, { timeout: 10_000 }).toBeGreaterThan(paused.time + 0.8);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
  });

  test("after the end screen, Lanjut menjelajah and Main lagi work as before; the Bloom's cinematic plays in the new session too, the opening does not (AC-8)", async ({ page }) => {
    test.setTimeout(400_000);
    await startDive(page);
    // With the opening on too: it plays on this first Mulai only.
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
    await reef(page, (h) => h.cinematics(true));
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(async () => (await cine(page))?.kind).toBe("opening");
    await page.keyboard.press("Space");
    await expect.poll(() => cine(page), { timeout: 5_000 }).toBeNull();
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await reef(page, (h, a) => a.ids.forEach((id: string) => h.scanEntry(id)), { ids: ALL_ENTRIES });
    await expect.poll(async () => (await cine(page))?.kind, { timeout: 20_000 }).toBe("ending");
    await page.keyboard.press("Space");
    await expect(endScreen(page)).toBeVisible({ timeout: 5_000 });

    // Lanjut menjelajah: back in the restored bay, in control, no cinematic.
    await page.getByRole("button", { name: "Lanjut menjelajah" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(page.locator(".crosshair")).toBeVisible();
    expect(await cine(page)).toBeNull();
    await page.waitForTimeout(800);
    expect(await cine(page)).toBeNull();
    await expect(endScreen(page)).toHaveCount(0);
    expect((await bloomState(page)).state).toBe("done");
    const here = await position(page);
    await page.mouse.move(0, 0);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => distance(await position(page), here), { timeout: 15_000 }).toBeGreaterThan(1.5);
    await page.keyboard.up("KeyW");

    // Main lagi (reach the end screen again, with the cinematics off to be quick): the opening does not play.
    await reef(page, (h) => h.cinematics(false));
    await reef(page, (h) => h.newDive());
    await expect.poll(() => mode(page)).toBe("playing");
    expect(await cine(page)).toBeNull();
    await expect(page.locator(".crosshair")).toBeVisible();
    expect(await position(page)).toEqual([rov.start.x, rov.start.y, rov.start.z]);
    // The new dive reaches the Bloom: the cinematic plays there too.
    await reef(page, (h) => h.cinematics(true));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    expect((await bloomState(page)).state).toBe("done");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the closing line is in English (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page, /Start/);
    await reef(page, (h) => h.cinematics(true));
    await triggerBloom(page);
    await bloomCinematic(page);
    await expect(page.locator(".cine-skip")).toHaveText("Click or Space to skip");
    await expect.poll(() => cine(page), { timeout: 20_000 }).toBeNull();
    await expect(noticeText(page)).toHaveText("The bay is clear again. Scanner unlocked!");
    await reef(page, (h, a) => a.ids.forEach((id: string) => h.scanEntry(id)), { ids: ALL_ENTRIES });
    await expect.poll(async () => (await cine(page))?.kind, { timeout: 20_000 }).toBe("ending");
    await seek(page, 16.5);
    await expect(caption(page)).toHaveText("The bay is alive again.");
    await page.screenshot({ path: "test-results/req-028-english.png" });
  });
});
