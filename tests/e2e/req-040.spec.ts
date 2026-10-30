import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

// REQ-040: presenter mode. That only `?presenter` turns it on and that P and B count only while playing is checked in
// app.test.ts; here, the game does what they ask. The build is checked in e2e-dist/req-040-dist.spec.ts.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
type Goal = { id: string; done: boolean };
const hud = (page: Page) => reef(page, (h) => h.hud()) as Promise<{ objectives: Goal[]; reef?: { phase2: Goal[] }; materials: number; tank: number; cleanliness: number; score: number }>;
const sites = (page: Page) => reef(page, (h) => h.reefSites()) as Promise<{ frames: { installed: boolean; fragments: number }[]; patches: { seeds: number }[] }>;
const notice = (page: Page) => page.locator(".message-notice");

async function startDive(page: Page, address = "/?presenter") {
  await page.goto(address);
  await page.getByRole("button", { name: /^(Mulai|Start)$/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await page.mouse.move(0, 0);
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("P finishes Phase 1 as if played, then plants everything so the Bloom and its cinematic begin; after that P does nothing (AC-1, AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await expect(page.locator(".presenter-tag")).toHaveText("Presenter · P: lewati fase · B: panggil kapal");
    // Something in the tank first: it is deposited too.
    await page.keyboard.press("Digit2");
    expect(await reef(page, (h) => h.aimAtTrash(3))).not.toBeNull();
    await page.mouse.down();
    await expect.poll(async () => (await hud(page)).tank, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.mouse.up();

    await page.keyboard.press("KeyP");
    await expect(notice(page)).toHaveText("Mode presenter: Fase 1 dilewati");
    await expect.poll(async () => (await hud(page)).objectives.every((goal) => goal.done)).toBe(true);
    let state = await hud(page);
    expect(state.cleanliness).toBeGreaterThanOrEqual(config.phase1.cleanTarget);
    expect(state.tank).toBe(0);
    expect(state.materials).toBeGreaterThanOrEqual(config.reef.frames * config.reef.frameCost);
    expect(state.reef?.phase2).toHaveLength(3);
    await expect(page.locator(".goal-list-phase2")).toBeVisible();
    expect((await sites(page)).frames.every((f) => !f.installed)).toBe(true);
    const nets = (await reef(page, (h) => h.nets())) as { cut: boolean }[];
    expect(nets.every((net) => net.cut)).toBe(true);

    await reef(page, (h) => h.cinematics(true));
    await page.keyboard.press("KeyP");
    await expect.poll(async () => ((await reef(page, (h) => h.cinematic())) as { kind: string } | null)?.kind, { timeout: 10_000 }).toBe("bloom");
    const planted = await sites(page);
    expect(planted.frames.every((f) => f.installed && f.fragments >= config.reef.fragmentsPerFrame)).toBe(true);
    expect(planted.patches.every((p) => p.seeds >= config.reef.seedsPerPatch)).toBe(true);
    await reef(page, (h) => h.skipCinematic());
    await expect.poll(() => reef(page, (h) => h.cinematic())).toBeNull();
    // Once the Bloom has begun, P does nothing more.
    state = await hud(page);
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(500);
    expect((await hud(page)).score).toBe(state.score);
    await expect(notice(page)).not.toHaveText(/Mode presenter/);
  });

  test("B calls the dumping boat now, only while none is in the bay and the Bloom has not begun (AC-4)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    expect((await reef(page, (h) => h.dumper())) as { phase: string }).toMatchObject({ phase: "waiting" });
    await page.keyboard.press("KeyB");
    await expect.poll(async () => ((await reef(page, (h) => h.dumper())) as { phase: string }).phase).toBe("arriving");
    await expect(page.locator(".dumper-marker")).toBeVisible();
    const first = ((await reef(page, (h) => h.dumper())) as { position: number[] }).position;
    await page.keyboard.press("KeyB");
    await page.waitForTimeout(300);
    const still = (await reef(page, (h) => h.dumper())) as { phase: string; position: number[] };
    expect(still.phase).toBe("arriving");
    // The same boat, still on its way in (not a new one from 80 m out).
    expect(Math.abs(still.position[0] - first[0])).toBeLessThan(10);

    // After the Bloom, B calls nothing.
    await page.keyboard.press("KeyP");
    await page.keyboard.press("KeyP");
    await expect.poll(async () => ((await reef(page, (h) => h.bloom())) as { state: string }).state).not.toBe("idle");
    await expect.poll(async () => ((await reef(page, (h) => h.dumper())) as { phase: string }).phase, { timeout: 30_000 }).toBe("done");
    await page.keyboard.press("KeyB");
    await page.waitForTimeout(500);
    expect(((await reef(page, (h) => h.dumper())) as { phase: string }).phase).toBe("done");
  });

  test("P does nothing during a cinematic (AC-5)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/?presenter");
    await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
    await reef(page, (h) => h.cinematics(true));
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => reef(page, (h) => h.cinematic())).not.toBeNull();
    await page.keyboard.press("KeyP");
    await page.waitForTimeout(300);
    expect((await hud(page)).objectives.some((goal) => !goal.done)).toBe(true);
  });

  test("without ?presenter there is no tag, and P and B do nothing (AC-1)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page, "/");
    await expect(page.locator(".presenter-tag")).toHaveCount(0);
    await page.keyboard.press("KeyP");
    await page.keyboard.press("KeyB");
    await page.waitForTimeout(500);
    expect((await hud(page)).objectives.some((goal) => !goal.done)).toBe(true);
    expect(((await reef(page, (h) => h.dumper())) as { phase: string }).phase).toBe("waiting");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the tag and the notices are in English (AC-1, AC-2)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await expect(page.locator(".presenter-tag")).toHaveText("Presenter · P: skip phase · B: call the boat");
    await page.keyboard.press("KeyP");
    await expect(notice(page)).toHaveText("Presenter mode: Phase 1 skipped");
  });
});
