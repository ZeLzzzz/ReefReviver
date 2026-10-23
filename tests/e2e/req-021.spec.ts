import { expect, test, type Page } from "@playwright/test";
import { Color } from "three";
import { config } from "../../src/config";

type Look = { coral: number[]; seagrass: number; bladesShown: number; rays: number; decor: { shown: number; colours: number[] } };
type Piece = { kind: string; x: number; y: number; z: number; size: number; yaw: number; seed: number };
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const KINDS = ["halimeda", "padina", "sargassum", "sponge", "fan"] as const;
type Kind = (typeof KINDS)[number];
const ALGAE: string[] = ["halimeda", "padina", "sargassum"];
const { decor } = config.nature;

/** The colour a piece takes after the Bloom: its kind's colour, picked by its seed (REQ-021 AC-5). */
const colourOf = (piece: Piece): number => {
  const palette = decor.colours[piece.kind as Kind];
  return palette[piece.seed % palette.length];
};

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

async function bloomNow(page: Page) {
  await reef(page, (h) => {
    h.removeTrash(50);
    h.plantAll();
  });
  await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
}

/** Frames per second over `ms` milliseconds, counted with requestAnimationFrame in the page. */
async function framesPerSecond(page: Page, ms: number) {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          frames++;
          if (now - start < duration) requestAnimationFrame(tick);
          else resolve(frames / ((now - start) / 1000));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("before the Bloom the decoration is dull; during it each piece turns its own colour, and the algae stay green or brown (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const pieces = (await reef(page, (h) => h.decorItems())) as Piece[];
    expect(pieces.length).toBeGreaterThan(100);
    const before = (await reef(page, (h) => h.natureLook())) as Look;
    expect(before.decor.shown).toBe(pieces.length);
    expect(new Set(before.decor.colours)).toEqual(new Set([decor.dull]));
    await page.screenshot({ path: "test-results/req-021-before.png" });

    await bloomNow(page);
    await page.waitForTimeout(500);
    const after = (await reef(page, (h) => h.natureLook())) as Look;
    expect(after.decor.colours).toEqual(pieces.map(colourOf));
    pieces.forEach((piece, i) => {
      if (!ALGAE.includes(piece.kind)) return;
      const hsl = { h: 0, s: 0, l: 0 };
      new Color(after.decor.colours[i]).getHSL(hsl);
      // Green or brown, never red.
      const hue = hsl.h * 360;
      expect(hue > 20 && hue < 330).toBe(true);
    });
    await page.screenshot({ path: "test-results/req-021-after.png" });
  });

  test("each kind can be seen up close, about 4 m from the camera, before and after the Bloom (AC-1, AC-3, AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const pieces = (await reef(page, (h) => h.decorItems())) as Piece[];
    // The first piece of each kind (of a few) that the submarine can aim at from a clear side, 4 m away.
    const aim = (piece: Piece) => reef(page, (h, p) => h.aimAtPoint(p.x, p.y + p.size * 0.4, p.z, 4, 0.3, 0.2), piece);
    for (const phase of ["before", "after"] as const) {
      if (phase === "after") await bloomNow(page);
      for (const kind of KINDS) {
        const candidates = pieces.filter((p) => p.kind === kind).slice(0, 15);
        let aimed = false;
        for (const piece of candidates) {
          if (!(await aim(piece))) continue;
          await page.waitForTimeout(300);
          await page.screenshot({ path: `test-results/req-021-${kind}-${phase}.png` });
          aimed = true;
          break;
        }
        expect(aimed, `a ${kind} to aim at`).toBe(true);
      }
    }
  });

  test("the submarine passes through a sponge, and no decoration covers the trash, a planting spot or a net (AC-6)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const pieces = (await reef(page, (h) => h.decorItems())) as Piece[];
    const trash = (await reef(page, (h) => h.trash())) as number[][];
    const sites = (await reef(page, (h) => h.reefSites())) as { frames: { x: number; z: number }[]; patches: { x: number; z: number }[] };
    const nets = (await reef(page, (h) => h.nets())) as { center: number[] }[];
    const reach = (p: Piece) => p.size * decor[p.kind as Kind].reach + decor.clearOfTrash;
    for (const item of trash) {
      for (const p of pieces) expect(Math.hypot(item[0] - p.x, item[2] - p.z)).toBeGreaterThanOrEqual(reach(p) - 1e-9);
    }
    const spots = [...sites.frames, ...sites.patches, ...nets.map((n) => ({ x: n.center[0], z: n.center[2] }))];
    for (const spot of spots) {
      for (const p of pieces) expect(Math.hypot(spot.x - p.x, spot.z - p.z)).toBeGreaterThan(config.bay.padRadius + config.bay.padBlend);
    }

    // A sponge with a clear 8 m line through its middle, at the height the submarine flies: found in the page.
    const line = (await reef(
      page,
      (h, ps) => {
        for (const p of ps.filter((item: Piece) => item.kind === "sponge")) {
          for (const yaw of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, -(3 * Math.PI) / 4]) {
            const fx = Math.sin(yaw);
            const fz = Math.cos(yaw);
            let clear = true;
            for (let s = -4; s <= 4 && clear; s += 0.5) clear = h.fits(p.x + fx * s, p.y + 1.2, p.z + fz * s);
            if (clear) return { x: p.x, y: p.y, z: p.z, yaw };
          }
        }
        return null;
      },
      pieces,
    )) as { x: number; y: number; z: number; yaw: number } | null;
    expect(line).not.toBeNull();
    const { x, y, z, yaw } = line!;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Four metres short of the sponge, facing it, holding forward: the submarine goes through it and on.
    await reef(page, (h, a) => h.placeRov(a.x - a.fx * 4, a.y + 1.2, a.z - a.fz * 4, a.yaw, 0), { x, y, z, yaw, fx, fz });
    await page.waitForTimeout(300);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(2500);
    await page.keyboard.up("KeyW");
    const at = (await reef(page, (h) => h.rovPosition())) as number[];
    expect((at[0] - x) * fx + (at[2] - z) * fz).toBeGreaterThan(1);
    await page.screenshot({ path: "test-results/req-021-through-sponge.png" });
  });

  test("after the Bloom the game runs at 30 frames a second or more among the decoration (AC-7)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await bloomNow(page);
    const pieces = (await reef(page, (h) => h.decorItems())) as Piece[];
    // The busiest spot: the piece with the most others within 8 m, looked at from about 3 m.
    let busy = pieces[0];
    let busiest = 0;
    for (const p of pieces) {
      const count = pieces.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 8).length;
      if (count > busiest) {
        busy = p;
        busiest = count;
      }
    }
    expect(await reef(page, (h, p) => h.aimAtPoint(p.x, p.y + p.size * 0.4, p.z, 3, 0.3, 0.2), busy)).toBe(true);
    await page.waitForTimeout(500);
    const fps = await framesPerSecond(page, 3000);
    console.log(`REQ-021 fps after the Bloom among the decoration: ${fps.toFixed(1)}`);
    expect(fps).toBeGreaterThanOrEqual(30);
  });
});
