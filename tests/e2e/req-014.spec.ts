import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
type Point = { x: number; y: number; z: number };
type CaveState = {
  mouths: [Point, Point];
  length: number;
  path: Point[];
  hole: { x: number; z: number; under: number; top: number; radius: number };
  level: number;
  cameraLevel: number;
  dark: number;
  lampLit: boolean;
  lamp: number;
  shaft: number;
  light: { hemisphere: number; sun: number };
};
type Hook = {
  mode(): string;
  rovPosition(): Vec;
  cameraPosition(): Vec;
  trash(): Vec[];
  trashTotal(): number;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
  aimAtTrash(distance: number): Vec | null;
  fits(x: number, y: number, z: number): boolean;
  removeTrash(n: number, fromEnd?: boolean): number;
  plantAll(): void;
  bloom(): { state: string };
  water(): { background: number; fog: number; fogNear: number; fogFar: number };
  cave(): CaveState;
  newDive(): void;
};
const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

// The cave stands in the north-east of the bay (config.bay.cave); its dark fog colour and lamp are in config.
const CAVE = { x: 98, z: -88, fogColor: 0x03121f };

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

const cave = (page: Page) => reef(page, (h) => h.cave());

/** Records the vehicle, the camera, the lamp and the darkness every frame, until the test reads them. */
async function startSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__samples = [];
    const tick = () => {
      const h = w.__reef;
      const c = h.cave();
      const [x, y, z] = h.rovPosition();
      w.__samples.push({ x, y, z, level: c.level, cameraLevel: c.cameraLevel, dark: c.dark, lampLit: c.lampLit, lamp: c.lamp, hemisphere: c.light.hemisphere, t: performance.now() });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
type Sample = { x: number; y: number; z: number; level: number; cameraLevel: number; dark: number; lampLit: boolean; lamp: number; hemisphere: number; t: number };
const samples = (page: Page) => page.evaluate(() => (window as any).__samples as Sample[]);

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("flying in at one mouth and out at the other, holding W: the lamp comes on inside and goes out outside, the camera stays in (AC-1, AC-3, AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const { mouths, length } = await cave(page);
    const [west, east] = mouths;
    expect(length).toBeGreaterThanOrEqual(30);
    expect(length).toBeLessThanOrEqual(40);
    // In the open bay the lamp is out.
    const open = await cave(page);
    expect(open.lampLit).toBe(false);
    expect(open.lamp).toBe(0);

    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0), { x: west.x - 9, y: west.y, z: west.z });
    await page.waitForTimeout(400);
    await page.screenshot({ path: "test-results/req-014-approach.png" });
    await startSampler(page);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await reef(page, (h) => h.rovPosition()))[0], { timeout: 60_000 }).toBeGreaterThan(east.x + 4);
    await page.keyboard.up("KeyW");
    await page.waitForTimeout(600);

    const log = await samples(page);
    // The vehicle came out the other mouth, level and not stuck on anything: it went the whole way.
    const [x, y, z] = await reef(page, (h) => h.rovPosition());
    expect(x).toBeGreaterThan(east.x + 4);
    expect(Math.abs(z - east.z)).toBeLessThan(5);
    expect(y).toBeGreaterThan(-12);
    const inside = log.filter((s) => s.level >= 0.5);
    expect(inside.length).toBeGreaterThan(20);

    // AC-3: lit once the vehicle is in (after a moment's fade-in), out before it enters and again after it leaves.
    for (const s of log.filter((s) => s.x < west.x - 3)) {
      expect(s.lampLit).toBe(false);
      expect(s.lamp).toBe(0);
    }
    const lit = log.filter((s) => s.lampLit);
    expect(lit.length).toBeGreaterThan(20);
    expect(Math.max(...lit.map((s) => s.lamp))).toBe(40);
    for (const s of log.filter((s) => s.level >= 0.99 && s.x > west.x + 4 && s.x < east.x - 4)) expect(s.lampLit).toBe(true);
    for (const s of inside) expect(s.lampLit).toBe(true);
    const last = log[log.length - 1];
    expect(last.lampLit).toBe(false);
    expect(last.lamp).toBe(0);
    // It turned on once and off once: no flicker at a mouth.
    const flips = log.filter((s, i) => i > 0 && s.lampLit !== log[i - 1].lampLit).length;
    expect(flips).toBe(2);

    // AC-5: with the vehicle well inside, the camera is inside too: the player never sees out of the hill.
    const deep = log.filter((s) => s.x > west.x + 8 && s.x < east.x - 8);
    expect(deep.length).toBeGreaterThan(10);
    for (const s of deep) expect(s.cameraLevel).toBeGreaterThan(0.5);
    await page.screenshot({ path: "test-results/req-014-out.png" });
  });

  test("it is dark inside except for the light shaft from the roof, and not outside (AC-2)", async ({ page }) => {
    await startDive(page);
    await page.screenshot({ path: "test-results/req-014-open-water.png" });
    const outside = await cave(page);
    expect(outside.dark).toBe(0);
    expect(outside.light.hemisphere).toBeCloseTo(1.6, 3);

    const { hole, mouths } = outside;
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0.15), { x: hole.x - 7, y: mouths[0].y, z: hole.z });
    await expect.poll(async () => (await cave(page)).dark, { timeout: 10_000 }).toBe(1);
    const inside = await cave(page);
    expect(inside.level).toBe(1);
    // The sky and sun light are a fraction of what they were; the shaft's light is on; the water is the cave's dark.
    expect(inside.light.hemisphere).toBeLessThan(outside.light.hemisphere * 0.4);
    expect(inside.light.sun).toBeLessThan(0.5);
    expect(inside.shaft).toBeGreaterThan(50);
    const water = await reef(page, (h) => h.water());
    expect(water.fog).toBe(CAVE.fogColor);
    expect(water.background).toBe(CAVE.fogColor);
    expect(water.fogFar).toBeLessThanOrEqual(26);
    await page.waitForTimeout(400);
    await page.screenshot({ path: "test-results/req-014-shaft.png" });

    // Coming out brings the light back, with no jump: the level eases (sampled every frame).
    await startSampler(page);
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0), { x: hole.x + 30, y: mouths[1].y, z: mouths[1].z });
    await expect.poll(async () => (await cave(page)).dark, { timeout: 10_000 }).toBeLessThan(0.01);
    expect((await cave(page)).light.hemisphere).toBeCloseTo(1.6, 2);
    const log = await samples(page);
    let biggest = 0;
    for (let i = 1; i < log.length; i++) biggest = Math.max(biggest, Math.abs(log[i].hemisphere - log[i - 1].hemisphere));
    // 1.6 down to 0.35 over about a third of a second at the very least: a few frames, never one jump.
    expect(biggest).toBeLessThan(1.2);
  });

  test("the walls, the floor and the roof stop the vehicle; the roof hole is too narrow to pass (AC-5, AC-6)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    const { hole, mouths } = await cave(page);
    const flyingY = mouths[0].y;

    // Against the wall: strafing right (south) in the chamber stops at the wall, inside the tunnel.
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0), { x: hole.x - 3, y: flyingY, z: hole.z });
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(3500);
    const [, , wallZ] = await reef(page, (h) => h.rovPosition());
    expect(wallZ - hole.z).toBeGreaterThan(2);
    expect(wallZ - hole.z).toBeLessThan(6.2);
    await page.waitForTimeout(800);
    const [, , stillZ] = await reef(page, (h) => h.rovPosition());
    expect(Math.abs(stillZ - wallZ)).toBeLessThan(0.1);
    await page.keyboard.up("KeyD");
    expect((await cave(page)).level).toBe(1);
    // The camera did not go through the wall either.
    expect((await cave(page)).cameraLevel).toBeGreaterThan(0.5);
    await page.screenshot({ path: "test-results/req-014-wall.png" });

    // Under the hole, holding Space: stops at the roof, below the hole, and stays in the cave.
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0), { x: hole.x, y: flyingY, z: hole.z });
    await page.keyboard.down("Space");
    await page.waitForTimeout(4000);
    const [, roofY] = await reef(page, (h) => h.rovPosition());
    expect(roofY).toBeLessThan(hole.under);
    expect(roofY).toBeGreaterThan(hole.under - 3);
    await page.waitForTimeout(600);
    expect((await reef(page, (h) => h.rovPosition()))[1]).toBeCloseTo(roofY, 1);
    await page.keyboard.up("Space");
    expect((await cave(page)).level).toBeGreaterThan(0.9);
    expect((await cave(page)).cameraLevel).toBeGreaterThan(0.5);
    await page.screenshot({ path: "test-results/req-014-roof.png" });

    // And on the floor, holding Shift.
    await page.keyboard.down("ShiftLeft");
    await page.waitForTimeout(3500);
    await page.keyboard.up("ShiftLeft");
    const [, floorY] = await reef(page, (h) => h.rovPosition());
    expect(floorY).toBeLessThan(flyingY - 0.5);
    expect(floorY).toBeGreaterThan(-9.4);
    expect(hole.radius * 2).toBeLessThan(1.6);
  });

  test("about 6 of the 60 pieces of trash lie in the tunnel, and one can be sucked up like any other (AC-4)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    const { mouths } = await cave(page);
    const inTunnel = (p: Vec) => p[0] > mouths[0].x && p[0] < mouths[1].x && Math.abs(p[2] - CAVE.z) < 8 && p[1] < -8;
    expect(await reef(page, (h) => h.trashTotal())).toBe(60);
    const all = await reef(page, (h) => h.trash());
    expect(all).toHaveLength(60);
    const mine = all.filter(inTunnel);
    expect(mine).toHaveLength(6);

    // Go in, to the first piece in the tunnel, and take it.
    const [x, y, z] = mine[0];
    await reef(page, (h, a) => h.placeRov(a.x - 5, a.y + 1, a.z, Math.PI / 2, -0.1), { x, y, z });
    await page.waitForTimeout(500);
    const item = await reef(page, (h) => h.aimAtTrash(3));
    expect(item).not.toBeNull();
    expect(inTunnel(item!)).toBe(true);
    await page.screenshot({ path: "test-results/req-014-trash.png" });
    await page.mouse.down();
    await expect(page.locator(".stat-tank .stat-value")).toHaveText("1/12", { timeout: 20_000 });
    await page.mouse.up();
    // It counts in the cleanliness like any other (1 of 60 pieces and 2 nets).
    await expect(page.locator(".stat-cleanliness .stat-value")).toHaveText("1%");
    expect((await reef(page, (h) => h.trash())).filter(inTunnel)).toHaveLength(5);
  });

  test("the minimap shows both mouths with an icon of their own and the tunnel faintly; the trash in it shows from 70 % (AC-7, AC-4)", async ({ page }) => {
    await startDive(page);
    const icons = page.locator('.hud-minimap [data-kind="cave"]');
    await expect(icons).toHaveCount(2);
    await expect(icons.first()).toBeVisible();
    await expect(page.locator('.hud-minimap [data-kind="tunnel"]')).toHaveCount(1);
    const { mouths } = await cave(page);
    // 300 m of bay on a 200 unit map, north up, the bay's centre in the middle.
    const unit = (m: number) => ((m + 150) * 200) / 300;
    for (const [i, mouth] of mouths.entries()) {
      const transform = await icons.nth(i).getAttribute("transform");
      const [mx, my] = transform!.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(mx).toBeCloseTo(unit(mouth.x), 0);
      expect(my).toBeCloseTo(unit(mouth.z), 0);
    }
    // The icon is not any other icon's shape: an arch (a path with an arc).
    expect(await icons.first().locator("path").getAttribute("d")).toContain("A");
    await expect(page.locator(".hud-minimap .mm-dot")).toHaveCount(0);

    // At 70 % (44 of 60 pieces and 0 of 2 nets, of 62) every piece left shows, the ones in the cave among them.
    await reef(page, (h) => h.removeTrash(44, true));
    await expect(page.locator(".stat-cleanliness .stat-value")).toHaveText("70%");
    await expect(page.locator(".hud-minimap .mm-dot")).toHaveCount(16);
    const points = (await page.locator('.hud-minimap [data-kind="tunnel"]').getAttribute("points"))!.split(" ").map((p) => p.split(",").map(Number));
    const dots = await page.locator(".hud-minimap .mm-dot").evaluateAll((els) => els.map((el) => [Number(el.getAttribute("cx")), Number(el.getAttribute("cy"))]));
    const onTunnel = dots.filter(([cx, cy]) => points.some(([px, py]) => Math.hypot(cx - px, cy - py) < 4));
    expect(onTunnel).toHaveLength(6);
    await page.locator(".hud-minimap").screenshot({ path: "test-results/req-014-minimap.png" });
  });

  test("after the Bloom the water is clear outside but the cave is still dark, with the lamp on (AC-8)", async ({ page }) => {
    test.setTimeout(240_000);
    await startDive(page);
    const { hole, mouths } = await cave(page);
    await reef(page, (h) => {
      h.removeTrash(50, true);
      h.plantAll();
    });
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 120_000 }).toBe("done");

    // Out in the bay it is clear and bright.
    await page.waitForTimeout(500);
    const clear = await cave(page);
    expect(clear.dark).toBe(0);
    expect(clear.lampLit).toBe(false);
    expect(clear.light.hemisphere).toBeGreaterThan(1.9);
    expect((await reef(page, (h) => h.water())).fogFar).toBe(90);
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0), { x: mouths[0].x - 8, y: mouths[0].y, z: mouths[0].z });
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/req-014-bloom-outside.png" });

    // Inside, the same Bloom: dark, with the lamp lit.
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0.1), { x: hole.x - 6, y: mouths[0].y, z: hole.z });
    await expect.poll(async () => (await cave(page)).dark, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await cave(page)).lamp, { timeout: 10_000 }).toBe(40);
    const dark = await cave(page);
    expect(dark.lampLit).toBe(true);
    expect(dark.light.hemisphere).toBeLessThan(clear.light.hemisphere * 0.3);
    const water = await reef(page, (h) => h.water());
    expect(water.fog).toBe(CAVE.fogColor);
    expect(water.fogFar).toBeLessThanOrEqual(26);
    await page.waitForTimeout(400);
    await page.screenshot({ path: "test-results/req-014-bloom-inside.png" });
  });

  test("a new dive starts with the lamp out and the water as it was, even if the last one ended in the cave", async ({ page }) => {
    await startDive(page);
    const { hole, mouths } = await cave(page);
    await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, 0), { x: hole.x - 6, y: mouths[0].y, z: hole.z });
    await expect.poll(async () => (await cave(page)).lamp, { timeout: 10_000 }).toBe(40);
    await reef(page, (h) => h.newDive());
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await cave(page)).lamp, { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => (await cave(page)).dark, { timeout: 10_000 }).toBe(0);
    expect((await cave(page)).light.hemisphere).toBeCloseTo(1.6, 3);
  });
});
