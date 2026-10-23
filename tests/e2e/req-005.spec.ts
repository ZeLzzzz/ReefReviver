import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
type Hook = {
  trash(): Vec[];
  rovPosition(): Vec;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
  removeTrash(n: number): number;
  plantAll(what?: "all" | "frames" | "patches"): void;
  newDive(): void;
  bloom(): { state: "idle" | "running" | "done"; progress: number; clarity: number; scannerOpen: boolean };
  water(): { background: number; fog: number; fogNear: number; fogFar: number };
  reefLook(): { coralScale: number; seagrassHeight: number; coral: number[]; markers: number[] };
  seaLife(): {
    active: boolean;
    scale: number;
    anemones: { x: number; y: number; z: number }[];
    creatures: { id: number; species: string; scannable: boolean; position: Vec }[];
  };
};
type Sample = {
  clock: number;
  state: string;
  progress: number;
  background: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  coralScale: number;
  seagrassHeight: number;
  coral: number[];
  markers: number[];
  notice: string | null;
  tool: string | null;
  rov: Vec;
};

const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const bloom = (page: Page) => reef(page, (h) => h.bloom());
const bloomState = async (page: Page) => (await bloom(page)).state;
const visibleGoals = (page: Page) => page.locator(".goal:visible .goal-text");
const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__reef.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position, which would turn
  // the ROV at every click. Park the cursor at (0, 0), where that movement is zero, before aiming.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** Records the water, the reef, the Bloom and the HUD once per animation frame, so a test can look for jumps. */
async function startSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__samples = [];
    const tick = () => {
      const h = w.__reef;
      const water = h.water();
      const b = h.bloom();
      const look = h.reefLook();
      const hud = h.hud();
      w.__samples.push({
        clock: h.clock(),
        state: b.state,
        progress: b.progress,
        background: water.background,
        fog: water.fog,
        fogNear: water.fogNear,
        fogFar: water.fogFar,
        coralScale: look.coralScale,
        seagrassHeight: look.seagrassHeight,
        coral: look.coral,
        markers: look.markers,
        notice: hud?.notice?.key ?? null,
        tool: hud?.tool ?? null,
        rov: h.rovPosition(),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const samples = (page: Page) => page.evaluate(() => (window as any).__samples as Sample[]);
const channels = (hex: number) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];

/** Puts the ROV 3 m from the nearest free trash item it can approach with no other item in the cone, aimed straight at it. */
async function aimAtNearestTrash(page: Page, distance = 3) {
  expect(await page.evaluate((d) => (window as any).__reef.aimAtTrash(d), distance)).not.toBeNull();
}

/** Cleans the bay to 80 % (50 of 60 trash and 2 nets) and plants everything: the Bloom starts at once. */
async function meetBothConditions(page: Page) {
  await reef(page, (h) => {
    h.removeTrash(50);
    h.plantAll();
  });
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("one condition alone does not start the Bloom, and the lists show what is missing (AC-4)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    const frames = () => reef(page, (h) => h.plantAll("frames"));
    const frameClock = () => page.evaluate(() => (window as any).__reef.clock() as number);
    const wait = async (seconds: number) => {
      const from = await frameClock();
      await expect.poll(frameClock, { timeout: 60_000 }).toBeGreaterThan(from + seconds);
    };

    // Planted, but 0 % clean.
    await reef(page, (h) => h.plantAll("all"));
    await wait(1);
    expect(await bloomState(page)).toBe("idle");
    await expect(visibleGoals(page).first()).toHaveText("Bersihkan teluk 0%/80%");
    await expect(page.locator('.goal[data-goal="clean"]')).not.toHaveClass(/done/);

    // 80 % clean, but nothing planted: a new dive.
    await reef(page, (h) => h.newDive());
    await page.mouse.move(0, 0);
    await reef(page, (h) => h.removeTrash(50));
    await wait(1);
    expect(await bloomState(page)).toBe("idle");
    await expect(page.locator('.goal[data-goal="clean"]')).toHaveClass(/done/);
    await expect(stat(page, "cleanliness")).toHaveText("80%");

    // Clean and the frames planted, one seagrass patch short: still nothing.
    await frames();
    await wait(1);
    expect(await bloomState(page)).toBe("idle");
    expect((await reef(page, (h) => h.water())).fogFar).toBe(24);
    await expect(page.locator(".goal-list-phase3")).toBeHidden();

    // The last condition arrives: the Bloom starts.
    await reef(page, (h) => h.plantAll("patches"));
    await expect.poll(() => bloomState(page), { timeout: 30_000 }).not.toBe("idle");
  });

  test("the water clears over about 6 s, coral and seagrass grow, sea life returns, Phase 3 opens, controls work throughout (AC-1, 2, 3, 5, 6, 7)", async ({ page }) => {
    test.setTimeout(300_000);
    await startDive(page);
    await expect(visibleGoals(page)).toHaveText(["Bersihkan teluk 0%/80%", "Bebaskan satwa 0/2", "Setor sampah ke stasiun"]);
    const murky = await reef(page, (h) => h.water());
    expect(murky.fogFar).toBe(24);
    expect(murky.background).toBe(murky.fog);
    expect((await reef(page, (h) => h.seaLife())).active).toBe(false);
    await page.screenshot({ path: "test-results/req-005-murky.png" });

    await startSampler(page);
    // Hold W the whole time: the ROV must keep moving during the transition (AC-6).
    await page.keyboard.down("KeyW");
    await meetBothConditions(page);
    await expect.poll(() => bloomState(page), { timeout: 60_000 }).toBe("running");
    await page.keyboard.press("Digit1");
    await expect.poll(async () => (await bloom(page)).progress, { timeout: 60_000 }).toBeGreaterThan(0.4);
    await page.screenshot({ path: "test-results/req-005-middle.png" });
    await expect.poll(() => bloomState(page), { timeout: 120_000 }).toBe("done");
    await page.keyboard.up("KeyW");

    const log = await samples(page);
    const running = log.filter((s) => s.state === "running");
    expect(running.length).toBeGreaterThan(30);
    const first = log.findIndex((s) => s.state === "running");
    const lastIndex = log.findIndex((s) => s.state === "done");

    // AC-1: about 6 s of game time, from murky green-grey to clear blue, and the view gets longer.
    expect(log[lastIndex].clock - log[first].clock).toBeGreaterThan(5.4);
    expect(log[lastIndex].clock - log[first].clock).toBeLessThan(6.8);
    const before = log[0];
    const after = log[log.length - 1];
    expect(before.fogFar).toBe(24);
    expect(after.fogFar).toBeGreaterThanOrEqual(80);
    expect(after.fogNear).toBeGreaterThan(before.fogNear);
    const [r0, g0, b0] = channels(before.background);
    const [r1, , b1] = channels(after.background);
    expect(b1).toBeGreaterThan(r1 + 100);
    expect(b1).toBeGreaterThan(b0);
    expect(r1).toBeLessThan(r0);
    expect(g0).toBeGreaterThan(r0);
    for (const s of log) expect(s.background).toBe(s.fog);

    // AC-7: every value moves one way and in small steps, frame after frame, so nothing flashes or flickers.
    const range = after.fogFar - before.fogFar;
    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1];
      const b = log[i];
      expect(b.fogFar).toBeGreaterThanOrEqual(a.fogFar);
      expect(b.fogFar - a.fogFar).toBeLessThanOrEqual(range * 0.035);
      expect(b.coralScale).toBeGreaterThanOrEqual(a.coralScale);
      expect(b.coralScale - a.coralScale).toBeLessThan(0.05);
      expect(b.seagrassHeight).toBeGreaterThanOrEqual(a.seagrassHeight);
      expect(b.seagrassHeight - a.seagrassHeight).toBeLessThan(0.12);
      expect(b.markers[0]).toBeLessThanOrEqual(a.markers[0]);
      expect(a.markers[0] - b.markers[0]).toBeLessThan(0.05);
      const ca = channels(a.background);
      const cb = channels(b.background);
      const from = channels(before.background);
      const to = channels(after.background);
      for (let c = 0; c < 3; c++) {
        expect((cb[c] - ca[c]) * Math.sign(to[c] - from[c])).toBeGreaterThanOrEqual(0);
        expect(Math.abs(cb[c] - ca[c])).toBeLessThanOrEqual(Math.abs(to[c] - from[c]) * 0.035 + 1);
      }
    }

    // AC-2: the coral is bigger and in several pastel colours, the seagrass is tall.
    expect(before.coralScale).toBe(1);
    expect(after.coralScale).toBeGreaterThan(1.6);
    expect(after.seagrassHeight).toBeGreaterThan(3);
    expect(new Set(before.coral).size).toBe(1);
    expect(new Set(after.coral).size).toBeGreaterThanOrEqual(5);

    // AC-8 (D-052): the site markers fade out with the Bloom; the minimap still shows every site, planted.
    expect(before.markers).toEqual([1, 1, 1, 1, 1]);
    expect(after.markers).toEqual([0, 0, 0, 0, 0]);
    await expect(page.locator('.hud-minimap [data-kind="frame"][data-status="planted"]')).toHaveCount(3);
    await expect(page.locator('.hud-minimap [data-kind="patch"][data-status="planted"]')).toHaveCount(2);

    // AC-6: controls stayed active during the transition: the key switched the tool and the ROV kept moving.
    expect(running.some((s) => s.tool === "cutter")).toBe(true);
    const moved = (a: Sample, b: Sample) => Math.hypot(a.rov[0] - b.rov[0], a.rov[2] - b.rov[2]);
    expect(moved(running[0], running[running.length - 1])).toBeGreaterThan(5);

    // AC-5: the notice, and the Phase 3 list in place of the others. The goals stay done and no key is named.
    expect(log.some((s) => s.notice === "bloom.scannerOpen")).toBe(true);
    await expect(visibleGoals(page)).toHaveText(["Pindai 0/7"]);
    expect((await bloom(page)).scannerOpen).toBe(true);
    for (const s of log.slice(0, first)) expect(s.notice).not.toBe("bloom.scannerOpen");

    // AC-3: the animals come in gently and then swim in the bay.
    await expect.poll(async () => (await reef(page, (h) => h.seaLife())).scale, { timeout: 60_000 }).toBe(1);
    const life = await reef(page, (h) => h.seaLife());
    const count = (species: string) => life.creatures.filter((c) => c.species === species).length;
    expect([count("clownfish"), count("yellowtail"), count("mantaRay"), count("dolphin")]).toEqual([6, 24, 2, 3]);
    expect(life.anemones).toHaveLength(3);
    expect(life.creatures.filter((c) => c.species === "yellowtail").every((c) => !c.scannable)).toBe(true);
    // In the bay's water, short of the rock wall and the shore (REQ-011).
    for (const c of life.creatures) expect(Math.max(Math.abs(c.position[0]), Math.abs(c.position[2]))).toBeLessThan(140);
    const later = await reef(page, (h) => h.seaLife());
    expect(later.creatures.some((c, i) => Math.hypot(c.position[0] - life.creatures[i].position[0], c.position[2] - life.creatures[i].position[2]) > 0.05)).toBe(true);
    await page.screenshot({ path: "test-results/req-005-clear.png" });

    // AC-6: once only. More cleaning and planting changes nothing.
    await reef(page, (h) => {
      h.removeTrash(6);
      h.plantAll();
    });
    await page.waitForTimeout(1000);
    expect(await bloom(page)).toMatchObject({ state: "done", progress: 1 });
  });

  test("the rest of the trash can still be vacuumed after the Bloom (AC-5)", async ({ page }) => {
    test.setTimeout(240_000);
    await startDive(page);
    await meetBothConditions(page);
    await expect.poll(() => bloomState(page), { timeout: 150_000 }).toBe("done");
    expect((await reef(page, (h) => h.trash())).length).toBe(10);
    await aimAtNearestTrash(page);
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText("1/12", { timeout: 30_000 });
    await page.mouse.up();
    await expect(stat(page, "score")).toHaveText(/^(10|\d+)$/);
    expect((await reef(page, (h) => h.trash())).length).toBe(9);
    await expect(visibleGoals(page)).toHaveText(["Pindai 0/7"]);
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("pausing freezes the Bloom, the Phase 3 list reads Scan 0/7, and a new dive is murky again (AC-5, AC-6)", async ({ page }) => {
    test.setTimeout(300_000);
    await startDive(page);
    await startSampler(page);
    await meetBothConditions(page);
    await expect.poll(async () => (await bloom(page)).progress, { timeout: 60_000 }).toBeGreaterThan(0.2);

    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => (window as any).__reef.mode())).toBe("paused");
    const frozen = await bloom(page);
    const frozenWater = await reef(page, (h) => h.water());
    await page.waitForTimeout(1500);
    expect(await bloom(page)).toEqual(frozen);
    expect(await reef(page, (h) => h.water())).toEqual(frozenWater);

    await page.getByRole("button", { name: "Resume" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__reef.mode())).toBe("playing");
    await expect.poll(() => bloomState(page), { timeout: 150_000 }).toBe("done");
    await expect(visibleGoals(page)).toHaveText(["Scan 0/7"]);
    await expect(page.locator(".goal-list-phase3 .goal")).toHaveCount(1);
    await page.screenshot({ path: "test-results/req-005-english.png" });
    const log = await samples(page);
    expect(log.some((s) => s.notice === "bloom.scannerOpen")).toBe(true);

    // A new dive starts murky: pale coral, small sprouts, no animals, the three Phase 1 goals, and the Bloom can happen again.
    await reef(page, (h) => h.newDive());
    await page.mouse.move(0, 0);
    expect(await bloom(page)).toMatchObject({ state: "idle", progress: 0, scannerOpen: false });
    const water = await reef(page, (h) => h.water());
    expect(water).toMatchObject({ fogNear: 2, fogFar: 24, background: 0x55695c, fog: 0x55695c });
    const look = await reef(page, (h) => h.reefLook());
    expect(look.coralScale).toBe(1);
    expect(look.seagrassHeight).toBe(1);
    expect(new Set(look.coral).size).toBe(1);
    expect(look.markers).toEqual([1, 1, 1, 1, 1]);
    expect((await reef(page, (h) => h.seaLife())).active).toBe(false);
    await expect(visibleGoals(page)).toHaveText(["Clean the bay 0%/80%", "Free the animals 0/2", "Deposit trash at the station"]);
    expect((await reef(page, (h) => h.trash())).length).toBe(60);
  });
});
