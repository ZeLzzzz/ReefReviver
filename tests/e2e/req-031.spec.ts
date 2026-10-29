import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { inland } from "../../src/game/terrain";
import type { BeachItem } from "../../src/game/beach";
import { goAshore, standAtCounter } from "./ashore";

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await page.mouse.move(0, 0);
  await goAshore(page, 0);
}

async function waterPixels(page: Page): Promise<number[]> {
  const viewport = page.viewportSize()!;
  const png = await page.screenshot({ clip: {
    x: Math.floor(viewport.width * 0.43), y: Math.floor(viewport.height * 0.6),
    width: Math.floor(viewport.width * 0.55), height: Math.floor(viewport.height * 0.34),
  } });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
  }, png.toString("base64"));
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("shells and fallen coconuts lie on the sand, and the counter in the timber house still takes deposits (AC-1, AC-5)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await startDive(page);
    const look = await reef(page, (h) => h.beach());
    expect(look.shells).toBeGreaterThan(400);
    expect(look.coconuts).toBe(config.land.palms.length * config.land.beachDecor.coconutsPerPalm);
    await reef(page, (h) => h.placeWalker(-130, 12, Math.atan2(-13, -37), 0.12));
    await page.waitForTimeout(300);
    await page.screenshot({ path: "test-results/beach-overview.png" });
    await standAtCounter(page);
    await expect(page.locator(".message-prompt")).toHaveText("Tekan E untuk menyetor sampah");
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toHaveText("Tangki kosong");
    expect(errors).toEqual([]);
  });

  test("shells are only decoration: E does not pick them up, the tank stays empty and the player walks over them (AC-2)", async ({ page }) => {
    await startDive(page);
    const items: BeachItem[] = await reef(page, (h) => h.beachItems());
    const item = items.find((p) => p.kind === "scallop" && inland(p.x, p.z) > 4.5 && p.z < -20)!;
    expect(item).toBeDefined();
    await reef(page, (h, p) => h.placeWalker(p.x - 1.5, p.z, Math.PI / 2, -0.9), item);
    await page.keyboard.press("KeyE");
    await expect(page.locator(".stat-tank .stat-value")).toHaveText("0/12");
    const from = (await reef(page, (h) => h.walker())).position;
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await reef(page, (h) => h.walker())).position[0] - from[0]).toBeGreaterThan(2.5);
    await page.keyboard.up("KeyW");
    await expect(page.locator(".stat-tank .stat-value")).toHaveText("0/12");
  });

  test("the shells and coconuts stay through the Bloom, and the coast keeps 30 frames a second or more (AC-1, AC-8)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const before = await reef(page, (h) => h.beach());
    await reef(page, (h) => { h.removeTrash(50); h.plantAll(); });
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
    expect(await reef(page, (h) => h.beach())).toEqual(before);
    for (const [name, yaw, pitch] of [["shoreline", Math.atan2(-13, -37), 0.12], ["inland hills", Math.atan2(-60, -20), 0.25], ["breaking waves", Math.PI / 2, -0.25]] as const) {
      await reef(page, (h, p) => h.placeWalker(-130, 12, p.yaw, p.pitch), { yaw, pitch });
      await page.waitForTimeout(300);
      const fps = await page.evaluate(() => new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          frames++;
          if (now - start < 3000) requestAnimationFrame(tick);
          else resolve(frames / ((now - start) / 1000));
        };
        requestAnimationFrame(tick);
      }));
      console.log(`Coastal scenery after Bloom, ${name}: ${fps.toFixed(1)} fps`);
      expect(fps).toBeGreaterThanOrEqual(30);
    }
    await page.screenshot({ path: "test-results/beach-bloom.png" });
  });

  test("small waves break into moving pale foam along the beach, without shader errors (AC-7)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/");
    await page.getByRole("button", { name: /Mulai|Start/ }).click();
    await page.waitForFunction(() => (window as any).__reef?.mode() === "playing");
    await page.mouse.move(0, 0);
    await goAshore(page, -22);
    await page.evaluate(() => (window as any).__reef.placeWalker(-137, -22, Math.atan2(3, -15), -0.08));
    await page.waitForTimeout(300);
    const frames: number[][] = [];
    for (let i = 0; i < 4; i++) {
      frames.push(await waterPixels(page));
      if (i < 3) await page.waitForTimeout(1100);
    }
    const foam = (pixels: number[], i: number) => {
      const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      const high = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      return low > 170 && high - low < 40;
    };
    let mostFoam = 0, mostMoved = 0;
    frames.forEach((frame, index) => {
      let pale = 0, moved = 0;
      for (let i = 0; i < frame.length; i += 4) {
        if (foam(frame, i)) pale++;
        if (index > 0 && foam(frame, i) !== foam(frames[index - 1], i)) moved++;
      }
      mostFoam = Math.max(mostFoam, pale);
      mostMoved = Math.max(mostMoved, moved);
    });
    console.log(`Surf: ${mostFoam} pale pixels, ${mostMoved} changed foam pixels`);
    expect(mostFoam).toBeGreaterThan(40);
    expect(mostMoved).toBeGreaterThan(25);
    expect(errors).toEqual([]);
  });
});
