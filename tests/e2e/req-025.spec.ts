import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { boardAgain, goAshore } from "./ashore";

type Vec = [number, number, number];
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const { bay, rov, vacuum, tank } = config;
const FLOAT_Y = bay.surfaceY - rov.floatDepth;
const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

const surface = (page: Page) => reef(page, (h) => h.surfaceTrash() as Vec[]);

/** Items within a few metres of one another make one group. */
function groupsOf(items: Vec[]): Vec[][] {
  const groups: Vec[][] = [];
  for (const item of items) {
    const group = groups.find((g) => g.some((o) => Math.hypot(o[0] - item[0], o[2] - item[2]) < 2 * config.trash.surface.groupRadius + 1));
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

const tankNow = async (page: Page) => Number((await stat(page, "tank").innerText()).split("/")[0]);

/**
 * Holds the left mouse button until the tank has at least one more than it had, then lets go, and returns the tank once the
 * items on their way have arrived. The floating items lie in groups, so a neighbour in the cone can come along with the first.
 */
async function suckSome(page: Page): Promise<number> {
  const before = await tankNow(page);
  await page.mouse.down();
  await expect.poll(() => tankNow(page), { timeout: 20_000 }).toBeGreaterThan(before);
  await page.mouse.up();
  await page.waitForTimeout(700);
  return tankNow(page);
}

/** Puts the submarine at the surface (or `below` m deeper), `distance` m from the nearest free floating item, aimed at it. */
async function aimAtSurface(page: Page, distance = 4, below = 0): Promise<Vec> {
  const item = await reef(page, (h, a) => h.aimAtSurfaceTrash(a.distance, a.below) as Vec | null, { distance, below });
  expect(item).not.toBeNull();
  return item!;
}

/** Half the side, in pixels, of the square looked at around each floating item on the screen. */
const BOX = 18;

/**
 * How many pixels differ clearly between two screenshots, counting only the squares around `spots` (the floating items on
 * the screen), in the middle of the screen clear of the HUD's panels. Looking only there keeps the waves and the clouds,
 * which move by themselves all over the screen, from drowning out the items.
 */
async function differing(page: Page, a: Buffer, b: Buffer, spots: number[][]): Promise<number> {
  const decoder = await page.context().newPage();
  try {
    await decoder.goto("about:blank");
    return await decoder.evaluate(
      async ({ first, second, spots, box }) => {
        const load = async (base64: string) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
        };
        const [p, q] = [await load(first), await load(second)];
        let count = 0;
        for (let y = Math.floor(p.height * 0.2); y < Math.floor(p.height * 0.8); y++) {
          for (let x = Math.floor(p.width * 0.28); x < Math.floor(p.width * 0.78); x++) {
            if (!spots.some(([cx, cy]) => Math.abs(x - cx) <= box && Math.abs(y - cy) <= box)) continue;
            const i = (y * p.width + x) * 4;
            const d = (Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2])) / 3;
            if (d > 40) count += 1;
          }
        }
        return count;
      },
      { first: a.toString("base64"), second: b.toString("base64"), spots, box: BOX },
    );
  } finally {
    await decoder.close();
  }
}

/** Where the three views are taken from: the group nearest the beach, which the beach sees. */
async function viewSpots(page: Page) {
  const items = await surface(page);
  const near = items.filter((p) => p[0] < -100 + 80).sort((a, b) => a[0] - b[0]);
  const target = near[0];
  return { target };
}

type ViewKind = "sub" | "under" | "beach";
/** Puts the player where `kind` looks at `target`. */
async function lookAt(page: Page, kind: ViewKind, target: Vec) {
  await reef(
    page,
    (h, a) => {
      const [tx, , tz] = a.target;
      if (a.kind === "sub") {
        h.placeRov(tx, a.floatY, tz - 4, 0, Math.atan2(-0.3, 4) + 0.12);
      } else if (a.kind === "under") {
        h.placeRov(tx, -5, tz - 6, 0, 0.7);
      } else {
        let x = -128;
        for (; x > -150; x -= 0.5) {
          h.placeWalker(x, tz, -Math.PI / 2, 0);
          if (Math.abs(h.walker().position[0] - x) < 0.01) break;
        }
        const dx = tx - x;
        h.placeWalker(x, tz, Math.atan2(dx, 0), Math.atan2(-1.6, Math.abs(dx)));
      }
    },
    { kind, target, floatY: FLOAT_Y },
  );
  await page.waitForTimeout(900);
}

/** Where the free floating items show on the screen now, in CSS pixels. */
async function itemSpots(page: Page): Promise<number[][]> {
  const items = await surface(page);
  const spots = await reef(page, (h, a) => a.items.map(([x, y, z]: Vec) => h.screenOf(x, y, z)), { items });
  return (spots as (number[] | null)[]).filter((spot): spot is number[] => spot !== null);
}

/**
 * AC-3: the floating items can be seen from the floating submarine, from under water and from the beach. Takes each view
 * once with the items there and twice with them gone (to see how much the moving water and the bobbing submarine change
 * by themselves), and compares them around where the items show.
 */
async function checkVisible(page: Page, tag: string) {
  const { target } = await viewSpots(page);
  const withItems: Partial<Record<ViewKind, Buffer>> = {};
  const spots: Partial<Record<ViewKind, number[][]>> = {};
  for (const kind of ["sub", "under"] as const) {
    await lookAt(page, kind, target);
    spots[kind] = await itemSpots(page);
    withItems[kind] = await page.screenshot({ path: `test-results/req-025-${tag}-${kind}.png` });
  }
  await goAshore(page);
  await lookAt(page, "beach", target);
  spots.beach = await itemSpots(page);
  withItems.beach = await page.screenshot({ path: `test-results/req-025-${tag}-beach.png` });

  // Now take the floating items away and look again.
  await reef(page, (h) => h.removeSurfaceTrash());
  expect(await surface(page)).toHaveLength(0);
  const without: Partial<Record<ViewKind, Buffer[]>> = {};
  const twice = async () => {
    const first = await page.screenshot();
    await page.waitForTimeout(400);
    return [first, await page.screenshot()];
  };
  await lookAt(page, "beach", target);
  without.beach = await twice();
  await boardAgain(page);
  for (const kind of ["sub", "under"] as const) {
    await lookAt(page, kind, target);
    without[kind] = await twice();
  }
  for (const kind of ["sub", "under", "beach"] as const) {
    const [empty, empty2] = without[kind]!;
    expect(spots[kind]!.length, `${tag} ${kind}: the items are in front of the camera`).toBeGreaterThan(0);
    const noise = await differing(page, empty, empty2, spots[kind]!);
    const seen = await differing(page, withItems[kind]!, empty, spots[kind]!);
    expect(seen, `${tag} ${kind}: the items change the picture`).toBeGreaterThan(15);
    expect(seen, `${tag} ${kind}: more than the moving water does`).toBeGreaterThan(noise * 2);
  }
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("8 of the 60 pieces float, in 2 or 3 groups over water at least 3 m deep, one within 50 m of the west beach; the sea floor keeps 44 (AC-1)", async ({ page }) => {
    await startDive(page);
    expect(await reef(page, (h) => h.trashTotal())).toBe(60);
    expect(await reef(page, (h) => h.surfaceTotal())).toBe(8);
    expect(await reef(page, (h) => h.beachTotal())).toBe(8);
    const items = await surface(page);
    expect(items).toHaveLength(8);
    const groups = groupsOf(items);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.length).toBeLessThanOrEqual(3);
    const waterline = bay.shore.waterlineX;
    expect(groups.some((g) => g.every(([x]) => x - waterline <= 50 + bay.shore.wiggle + 2))).toBe(true);
    // The floor keeps 44: every free piece that is neither floating nor on the beach.
    const all: Vec[] = await reef(page, (h) => h.trash());
    const beach: Vec[] = await reef(page, (h) => h.beachTrash());
    expect(all.length - items.length - beach.length).toBe(44);
    await page.screenshot({ path: "test-results/req-025-minimap-hidden.png" });
  });

  test("they float half under water and bob gently in place, only bottles and bags (AC-2)", async ({ page }) => {
    await startDive(page);
    const kinds = await reef(page, (h) => h.surfaceKinds() as string[]);
    expect(kinds).toHaveLength(8);
    expect(new Set(kinds)).toEqual(new Set(["bottle", "bag"]));
    const before = await surface(page);
    for (const [, y] of before) expect(Math.abs(y - bay.surfaceY)).toBeLessThan(0.1);
    const heights: number[][] = [];
    for (let i = 0; i < 16; i++) {
      heights.push((await reef(page, (h) => h.surfaceModels() as Vec[])).map((p) => p[1]));
      await page.waitForTimeout(250);
    }
    // The models rock a little, each on its own phase ...
    for (let item = 0; item < 8; item++) {
      const series = heights.map((h) => h[item]);
      expect(Math.max(...series) - Math.min(...series)).toBeGreaterThan(0.01);
      expect(Math.max(...series.map((y) => Math.abs(y - before[item][1])))).toBeLessThanOrEqual(config.trash.surface.bob.amplitude + 1e-6);
    }
    expect(new Set(heights[0].map((y) => y.toFixed(3))).size).toBeGreaterThan(4);
    // ... and the items themselves stay where they are.
    expect(await surface(page)).toEqual(before);
  });

  test("seen from the floating submarine, from under water and from the beach, before the Bloom (AC-3)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await checkVisible(page, "murky");
  });

  test("and after the Bloom, with the clear water (AC-3)", async ({ page }) => {
    test.setTimeout(240_000);
    await startDive(page);
    // The floor's 40, the 4 oil slicks (REQ-038) and the beach's 8 are cleaned up: 83% with the floating ones still there.
    await reef(page, (h) => {
      h.removeTrash(44);
      h.removeTrash(8, true);
      h.plantAll();
    });
    expect(await surface(page)).toHaveLength(8);
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 120_000 }).toBe("done");
    await page.waitForTimeout(800);
    await checkVisible(page, "bloom");
  });

  for (const [where, below] of [
    ["from the floating submarine", 0],
    ["from 3 m below the surface", 3],
  ] as const) {
    test(`hold left click ${where}: it is sucked in like floor trash, tank +1, score +10, cleanliness up (AC-4)`, async ({ page }) => {
      await startDive(page);
      const before = (await surface(page)).length;
      await aimAtSurface(page, 4, below);
      await page.mouse.down();
      await expect.poll(() => page.locator(".hud.sucking").count()).toBe(1);
      await page.screenshot({ path: `test-results/req-025-sucking-${below}.png` });
      await expect.poll(() => tankNow(page), { timeout: 20_000 }).toBeGreaterThan(0);
      await page.mouse.up();
      await page.waitForTimeout(700);
      // One item, or two when a neighbour in the cone came along: each is +1 in the tank, +10 in the score, and gone from the water.
      const n = await tankNow(page);
      expect(n).toBeGreaterThanOrEqual(1);
      await expect(stat(page, "score")).toHaveText(String(10 * n));
      await expect(stat(page, "cleanliness")).toHaveText(`${Math.floor((100 * n) / 62)}%`); // n of 60 trash and 2 nets
      expect(await surface(page)).toHaveLength(before - n);
    });
  }

  test("out of range or out of the aim, it stays and nothing changes (AC-5)", async ({ page }) => {
    await startDive(page);
    // Beyond the Vacuum's range.
    await aimAtSurface(page, vacuum.range + 2);
    await page.mouse.down();
    await page.waitForTimeout(2000);
    await page.mouse.up();
    await expect(stat(page, "tank")).toHaveText("0/12");
    await expect(stat(page, "score")).toHaveText("0");
    // In range, but looking well away from it.
    await aimAtSurface(page, 4);
    await reef(page, (h) => h.placeRov(...(h.rovPosition() as Vec), h.rovYaw() + 1.4, 0));
    await page.mouse.down();
    await page.waitForTimeout(2000);
    await page.mouse.up();
    await expect(stat(page, "tank")).toHaveText("0/12");
    await expect(stat(page, "score")).toHaveText("0");
    expect(await surface(page)).toHaveLength(8);
  });

  test("with a full tank it stays, and the message to deposit it shows (AC-5, REQ-002 AC-2)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    // A few from the surface (a group's neighbours can come along), then the rest from the floor, fill the tank (REQ-002).
    while ((await tankNow(page)) < 3) {
      await aimAtSurface(page);
      await suckSome(page);
    }
    while ((await tankNow(page)) < tank.capacity) {
      expect(await reef(page, (h) => h.aimAtTrash(3))).not.toBeNull();
      await suckSome(page);
    }
    await expect(stat(page, "tank")).toHaveText("12/12");
    await expect(page.locator(".message-full")).toHaveText("Tangki penuh, setor di gudang daur ulang di darat");
    const score = await stat(page, "score").innerText();
    const clean = await stat(page, "cleanliness").innerText();
    const left = await surface(page);
    expect(left.length).toBeGreaterThanOrEqual(1);
    await aimAtSurface(page);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    await expect(stat(page, "tank")).toHaveText("12/12");
    await expect(stat(page, "score")).toHaveText(score);
    await expect(stat(page, "cleanliness")).toHaveText(clean);
    expect(await surface(page)).toHaveLength(left.length);
    await expect(page.locator(".message-full")).toHaveText("Tangki penuh, setor di gudang daur ulang di darat");
    await page.screenshot({ path: "test-results/req-025-full.png" });
  });

  test("they count in the cleanliness and in the Bloom's 80%, and show as dots on the minimap from 70% (AC-6)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const dots = page.locator('.hud-minimap [data-kind="trash"]');
    // The floor's 40 and the 4 oil slicks (REQ-038) gone: 44 of 62 is 70%, so every item left shows: 8 floating and 8 on the beach.
    await reef(page, (h) => h.removeTrash(43));
    await expect(stat(page, "cleanliness")).toHaveText("69%");
    await page.waitForTimeout(400);
    await expect(dots).toHaveCount(0);
    await reef(page, (h) => h.removeTrash(1));
    await expect(stat(page, "cleanliness")).toHaveText("70%");
    await expect(dots).toHaveCount(16);
    await page.locator(".hud-minimap").screenshot({ path: "test-results/req-025-minimap.png" });
    // Sucking floating ones raises it by one item each; 6 of them bring it to 80%, the Bloom's condition for a clean bay.
    let n = 0;
    while (n < 6) {
      await aimAtSurface(page);
      n = await suckSome(page);
      await expect(stat(page, "cleanliness")).toHaveText(`${Math.floor((100 * (44 + n)) / 62)}%`);
      await expect(dots).toHaveCount(16 - n);
      if (n < 6) await expect(page.locator('.goal[data-goal="clean"]')).not.toHaveClass(/done/);
    }
    await expect(page.locator('.goal[data-goal="clean"]')).toHaveClass(/done/);
  });

  test("on Main lagi they all float again, somewhere new (AC-7)", async ({ page }) => {
    await startDive(page);
    const first = await surface(page);
    await aimAtSurface(page);
    const n = await suckSome(page);
    expect(await surface(page)).toHaveLength(8 - n);
    await reef(page, (h) => h.newDive());
    const second = await surface(page);
    expect(second).toHaveLength(8);
    expect(await reef(page, (h) => h.surfaceTotal())).toBe(8);
    expect(second).not.toEqual(first);
    for (const [x, y, z] of second) {
      expect(Math.abs(y - bay.surfaceY)).toBeLessThan(0.1);
      expect(Math.hypot(x - rov.start.x, z - rov.start.z)).toBeGreaterThanOrEqual(config.trash.surface.clearOfStart);
    }
  });

  test("the submarine and the camera pass through the floating items (AC-8)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    const [tx, , tz] = await aimAtSurface(page, 5);
    const yaw = await reef(page, (h) => h.rovYaw() as number);
    await page.keyboard.down("KeyW");
    // It travels on past the item: the item is 5 m ahead, and the submarine gets 3 m beyond it.
    await expect
      .poll(async () => {
        const [x, , z] = await reef(page, (h) => h.rovPosition() as Vec);
        return (x - tx) * Math.sin(yaw) + (z - tz) * Math.cos(yaw);
      }, { timeout: 30_000 })
      .toBeGreaterThan(3);
    await page.keyboard.up("KeyW");
    const [, y] = await reef(page, (h) => h.rovPosition() as Vec);
    expect(y).toBeLessThanOrEqual(FLOAT_Y + 1e-6);
    // The camera is out of the water at the surface and behind the submarine, not held back by the item.
    const camera = await reef(page, (h) => h.cameraPosition() as Vec);
    expect(camera[1]).toBeGreaterThan(bay.surfaceY);
  });
});
