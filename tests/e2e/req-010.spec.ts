import { expect, test, type Locator, type Page } from "@playwright/test";

type Vec = [number, number, number];
type Frame = { x: number; y: number; z: number; installed: boolean; fragments: number };
type Patch = { x: number; y: number; z: number; seeds: number };
type NetInfo = { id: number; species: string; cut: boolean; center: Vec; size: Vec };
type Hook = {
  trash(): Vec[];
  trashTotal(): number;
  rovPosition(): Vec;
  rovYaw(): number;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
  reefSites(): { frames: Frame[]; patches: Patch[] };
  nets(): NetInfo[];
  giveMaterials(n: number): void;
  removeTrash(n: number): void;
};
const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);
const icons = (page: Page, kind: string) => page.locator(`.hud-minimap [data-kind="${kind}"]`);
const sites = (page: Page) => reef(page, (h) => h.reefSites());

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

/** The map is `size` units wide and shows 150 m each way from the bay's centre (REQ-011): 200 units for 300 metres. */
const mapX = (x: number) => ((x + 150) * 200) / 300;
const mapY = (z: number) => ((z + 150) * 200) / 300;
const transformOf = (x: number, z: number, heading: number) => `translate(${mapX(x).toFixed(1)} ${mapY(z).toFixed(1)}) rotate(${heading.toFixed(1)})`;

type Box = { x: number; y: number; width: number; height: number };
async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Same helpers as req-003 and req-004: stand near something and aim the crosshair through it. */
async function aimThrough(page: Page, target: Vec, distance = 3.5) {
  await reef(
    page,
    (hook, a) => {
      const len = Math.hypot(a.target[0], a.target[2]) || 1;
      const px = a.target[0] - (a.target[0] / len) * a.distance;
      const pz = a.target[2] - (a.target[2] / len) * a.distance;
      const py = a.target[1] + 0.8;
      let yaw = 0;
      let pitch = 0;
      for (let i = 0; i < 40; i++) {
        const ax = Math.sin(yaw) * Math.cos(pitch);
        const ay = Math.sin(pitch);
        const az = Math.cos(yaw) * Math.cos(pitch);
        const d = [a.target[0] - (px - ax * 6), a.target[1] - (py - ay * 6 + 2), a.target[2] - (pz - az * 6)];
        yaw = Math.atan2(d[0], d[2]);
        pitch = Math.asin(d[1] / Math.hypot(d[0], d[1], d[2]));
      }
      hook.placeRov(px, py, pz, yaw, pitch);
    },
    { target, distance },
  );
}

async function aimAtNet(page: Page, id: number) {
  const net = (await reef(page, (h) => h.nets()))[id];
  await aimThrough(page, [net.center[0], net.center[1] + net.size[1] * 0.85, net.center[2]]);
}

async function standSouthOf(page: Page, kind: "frame" | "patch", index: number, distance = 9) {
  await reef(
    page,
    (h, a) => {
      const s = h.reefSites();
      const site = a.kind === "frame" ? s.frames[a.index] : s.patches[a.index];
      h.placeRov(site.x, site.y + 1, site.z + a.distance, Math.PI, 0);
    },
    { kind, index, distance },
  );
}

/** REQ-012: aims the crosshair at (x, y, z) from whichever side is clear, `distance` m away and `rise` m above it. */
async function aimAtPoint(page: Page, target: Vec, distance = 9, rise = 0) {
  expect(await page.evaluate(([t, d, r]) => (window as any).__reef.aimAtPoint(t[0], t[1], t[2], d, r), [target, distance, rise] as const)).toBe(true);
}

async function shootUntil(page: Page, done: () => Promise<boolean>) {
  await page.mouse.down();
  await expect.poll(done, { timeout: 40_000 }).toBe(true);
  await page.mouse.up();
}

/** Where the arrow's tip is on screen, relative to its centre, as a unit vector (x to the right, y down). */
const arrowDirection = (page: Page) =>
  page.evaluate(() => {
    const g = document.querySelector('.hud-minimap [data-kind="rov"]') as unknown as SVGGraphicsElement;
    const matrix = g.getScreenCTM()!;
    const tip = new DOMPoint(0, -12).matrixTransform(matrix);
    const centre = new DOMPoint(0, 0).matrixTransform(matrix);
    const length = Math.hypot(tip.x - centre.x, tip.y - centre.y);
    return { x: (tip.x - centre.x) / length, y: (tip.y - centre.y) / length };
  });

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the minimap shows in the top right with the arrow at the ROV, turned the way it faces (AC-1)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    const map = page.locator(".hud-minimap");
    await expect(map).toBeVisible();
    await expect(map.locator("svg")).toHaveAttribute("role", "img");
    await expect(map.locator("svg")).toHaveAttribute("aria-label", "Peta teluk");
    await expect(page.locator(".mm-north")).toHaveText("U");

    const viewport = page.viewportSize()!;
    const b = await box(map);
    const svg = await box(map.locator("svg"));
    expect(b.x + b.width).toBeCloseTo(viewport.width - 16, 0);
    expect(b.y).toBeCloseTo(16, 0);
    expect(svg.width).toBeLessThanOrEqual(200.5);
    expect(svg.width).toBeGreaterThanOrEqual(120);
    expect(svg.width).toBeCloseTo(svg.height, 0);
    // A semi-transparent panel, like the rest of the HUD (AC-5).
    const alpha = await map.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(alpha).toMatch(/rgba\(.*0\.\d+\)/);

    // At the start the ROV is at (-96, 8) near the station on the west shore, facing about east. (Clicking Mulai can
    // turn it a little under pointer lock, so the arrow is checked against the ROV's own heading.)
    const rov = icons(page, "rov");
    const startYaw = await reef(page, (h) => h.rovYaw());
    expect(Math.sin(startYaw)).toBeGreaterThan(0.5);
    await expect(rov).toHaveAttribute("transform", transformOf(-96, 8, ((180 - (startYaw * 180) / Math.PI) % 360 + 360) % 360));
    const facing = await arrowDirection(page);
    expect(facing.x).toBeCloseTo(Math.sin(startYaw), 1);
    expect(facing.y).toBeCloseTo(Math.cos(startYaw), 1);

    // Moving and turning moves and turns the arrow; the screen direction matches where the ROV faces (sin yaw, cos yaw).
    for (const [x, z, yaw] of [[-20, -10, Math.PI / 2], [15, 5, 0], [5, -30, -1]] as const) {
      await reef(page, (h, a) => h.placeRov(a.x, -6, a.z, a.yaw, 0), { x, z, yaw });
      await expect.poll(() => rov.getAttribute("transform")).toBe(transformOf(x, z, ((180 - (yaw * 180) / Math.PI) % 360 + 360) % 360));
      const dir = await arrowDirection(page);
      expect(dir.x).toBeCloseTo(Math.sin(yaw), 1);
      expect(dir.y).toBeCloseTo(Math.cos(yaw), 1);
    }

    // Driving forward really moves the arrow north (up the screen).
    await reef(page, (h) => h.placeRov(0, -6, 20, Math.PI, 0));
    const before = await box(rov);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await box(rov)).y, { timeout: 20_000 }).toBeLessThan(before.y - 4);
    await page.keyboard.up("KeyW");
    await page.screenshot({ path: "test-results/req-010-minimap.png" });
  });

  test("the station, 3 reef sites and 2 seagrass patches have different shapes, and planting changes a site's mark (AC-2)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await expect(icons(page, "station")).toHaveCount(1);
    await expect(icons(page, "frame")).toHaveCount(3);
    await expect(icons(page, "patch")).toHaveCount(2);
    await expect(icons(page, "rov")).toHaveCount(1);
    const tag = (kind: string, selector: string) => icons(page, kind).first().locator(selector).evaluate((el) => el.tagName.toLowerCase());
    expect(await tag("station", ".mm-shape")).toBe("rect");
    expect(await tag("frame", ".mm-shape")).toBe("polygon");
    expect(await tag("patch", ".mm-shape")).toBe("circle");
    // The landmarks sit where the world has them: the station in the west, the sites in the east.
    const station = await box(icons(page, "station"));
    const frame = await box(icons(page, "frame").first());
    expect(station.x).toBeLessThan(frame.x);
    await expect(icons(page, "frame").first()).toHaveAttribute("data-status", "empty");
    await expect(icons(page, "patch").first()).toHaveAttribute("data-status", "empty");
    // The check mark is only drawn for a planted site.
    await expect(icons(page, "frame").first().locator(".mm-check")).toBeHidden();

    // Install a frame: the mark changes from empty to started; the others stay empty.
    await reef(page, (h) => h.giveMaterials(5));
    await standSouthOf(page, "frame", 0, 3);
    await page.keyboard.press("KeyE");
    await expect(icons(page, "frame").nth(0)).toHaveAttribute("data-status", "started");
    await expect(icons(page, "frame").nth(1)).toHaveAttribute("data-status", "empty");

    // Plant coral on it, then seagrass on a patch: the marks change again and show the check.
    await page.keyboard.press("Digit3");
    await expect(page.locator(".tool-name")).toHaveText("3 Seed launcher");
    const s = await sites(page);
    await aimAtPoint(page, [s.frames[0].x, s.frames[0].y + 1, s.frames[0].z]);
    await shootUntil(page, async () => (await sites(page)).frames[0].fragments >= 3);
    await expect(icons(page, "frame").nth(0)).toHaveAttribute("data-status", "planted");
    await expect(icons(page, "frame").nth(0).locator(".mm-check")).toBeVisible();
    const p = s.patches[0];
    await aimAtPoint(page, [p.x, p.y, p.z], 8, 3);
    await page.mouse.down();
    await expect(icons(page, "patch").nth(0)).toHaveAttribute("data-status", "started", { timeout: 40_000 });
    await shootUntil(page, async () => (await sites(page)).patches[0].seeds >= 3);
    await expect(icons(page, "patch").nth(0)).toHaveAttribute("data-status", "planted");
    await expect(icons(page, "patch").nth(1)).toHaveAttribute("data-status", "empty");
    await page.screenshot({ path: "test-results/req-010-planted.png" });
  });

  test("a net that still traps an animal has a mark, and the mark goes when the net is cut (AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await expect(icons(page, "net")).toHaveCount(2);
    await page.keyboard.press("Digit1");
    await aimAtNet(page, 0);
    await page.mouse.down();
    await expect.poll(async () => (await reef(page, (h) => h.nets()))[0].cut, { timeout: 40_000 }).toBe(true);
    await page.mouse.up();
    await expect(icons(page, "net")).toHaveCount(1);
    // The mark left is the shark's net (id 1), at its place on the map.
    await expect(icons(page, "net")).toHaveAttribute("data-id", "1");
    const [, shark] = await reef(page, (h) => h.nets());
    const markBox = await box(icons(page, "net"));
    const svg = await box(page.locator(".hud-minimap svg"));
    const scale = svg.width / 200;
    expect(markBox.x + markBox.width / 2).toBeCloseTo(svg.x + mapX(shark.center[0]) * scale, 0);
    expect(markBox.y + markBox.height / 2).toBeCloseTo(svg.y + mapY(shark.center[2]) * scale, 0);
    await page.screenshot({ path: "test-results/req-010-net-cut.png" });
  });

  test("trash dots stay hidden under 70% cleanliness; from 70% each item left is a dot, and one goes when it is sucked (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const total = await reef(page, (h) => h.trashTotal());
    const clean = (removed: number) => Math.floor((100 * removed) / (total + 2));
    let need = 0;
    while (clean(need) < 70) need++;
    expect(clean(need - 1)).toBeLessThan(70);

    await expect(icons(page, "trash")).toHaveCount(0);
    await reef(page, (h, n) => h.removeTrash(n), need - 1);
    await expect(stat(page, "cleanliness")).toHaveText(`${clean(need - 1)}%`);
    await page.waitForTimeout(500);
    await expect(icons(page, "trash")).toHaveCount(0);

    await reef(page, (h) => h.removeTrash(1));
    await expect(stat(page, "cleanliness")).toHaveText(`${clean(need)}%`);
    const left = total - need;
    await expect(icons(page, "trash")).toHaveCount(left);
    await page.screenshot({ path: "test-results/req-010-trash.png" });

    // Suck one item (one with no other item in the cone: the trash lies in groups): its dot goes. The 44 removed are the
    // floor's, so the ones left to the vacuum are the 8 floating at the surface (REQ-025).
    expect(await page.evaluate(() => (window as any).__reef.aimAtSurfaceTrash(3, 0, true))).not.toBeNull();
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText("1/12", { timeout: 30_000 });
    await page.mouse.up();
    await expect(icons(page, "trash")).toHaveCount(left - 1);
    expect(await reef(page, (h) => h.trash().length)).toBe(left - 1);
  });

  test("the minimap covers neither the crosshair, the goals, the stats nor the messages, at three window sizes (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await reef(page, (h) => h.giveMaterials(0));
    // A prompt and a notice, the two messages that can show at once, near an empty reef site.
    await standSouthOf(page, "frame", 0, 3);
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toBeVisible();
    await expect(page.locator(".message-prompt")).toBeVisible();

    for (const [width, height] of [[800, 450], [1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      const map = await box(page.locator(".hud-minimap"));
      const svg = await box(page.locator(".hud-minimap svg"));
      expect(svg.width).toBeLessThanOrEqual(200.5);
      expect(svg.width).toBeGreaterThanOrEqual(120);
      // One column on the right: the stats sit under the minimap, on the same right edge, without a gap bigger than a few px.
      const stats = await box(page.locator(".hud-stats"));
      expect(stats.y).toBeGreaterThanOrEqual(map.y + map.height);
      expect(stats.y - (map.y + map.height)).toBeLessThanOrEqual(12);
      expect(stats.x + stats.width).toBeCloseTo(map.x + map.width, 0);
      expect(map.x + map.width).toBeLessThanOrEqual(width - 16 + 0.5);
      // Nothing else overlaps the column, down to the bottom of the stats.
      const column = { x: Math.min(map.x, stats.x), y: map.y, width: Math.max(map.width, stats.width), height: stats.y + stats.height - map.y };
      expect(overlaps(map, await box(page.locator(".crosshair")))).toBe(false);
      expect(overlaps(column, await box(page.locator(".crosshair")))).toBe(false);
      expect(overlaps(column, await box(page.locator(".hud-goals")))).toBe(false);
      for (const message of await page.locator(".message").all()) {
        if (await message.isVisible()) expect(overlaps(column, await box(message))).toBe(false);
      }
      expect(overlaps(column, await box(page.locator(".hud-tool")))).toBe(false);
      await page.screenshot({ path: `test-results/req-010-layout-${width}x${height}.png` });
    }
  });

  test("the minimap goes with the HUD when paused and comes back the same on resume (AC-6)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(-18, -6, -22, 0.8, 0));
    // 44 of 60 trash is 70 % of 60 trash and 2 nets: the dots show.
    await reef(page, (h) => h.removeTrash(44));
    await expect(icons(page, "trash").first()).toBeVisible();
    const content = () => page.locator(".hud-minimap").evaluate((el) => el.outerHTML);
    await expect.poll(content).toContain(transformOf(-18, -22, ((180 - (0.8 * 180) / Math.PI) % 360 + 360) % 360));
    const before = await content();
    const dots = await icons(page, "trash").count();

    await page.keyboard.press("Escape");
    await expect(page.locator(".pause-screen")).toBeVisible();
    await expect(page.locator(".hud-minimap")).toHaveCount(0);
    await expect(page.locator("svg.mm-map")).toHaveCount(0);

    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.locator(".hud-minimap")).toBeVisible();
    await expect(icons(page, "trash")).toHaveCount(dots);
    // Clicking Lanjut moves Playwright's cursor, and under pointer lock that movement can turn the ROV a little, so the
    // arrow's turn is left out; everything else on the map is as it was.
    const withoutArrow = (html: string) => html.replace(/(data-kind="rov" transform="translate\([^)]*\)) rotate\([^)]*\)/, "$1");
    expect(withoutArrow(await content())).toBe(withoutArrow(before));
    // The Logbook (REQ-006) hides the HUD the same way as the pause menu; it is not built yet, so it is not tested here.
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the map is named in English and shows in the top right (G-004)", async ({ page }) => {
    await startDive(page);
    await expect(page.locator(".hud-minimap svg")).toHaveAttribute("aria-label", "Bay map");
    await expect(page.locator(".mm-north")).toHaveText("N");
    await expect(icons(page, "frame")).toHaveCount(3);
  });
});
