import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
type Frame = { x: number; y: number; z: number; installed: boolean; fragments: number };
type Patch = { x: number; y: number; z: number; seeds: number };
type Hook = {
  trash(): Vec[];
  station(): Vec;
  rovPosition(): Vec;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
  reefSites(): { frames: Frame[]; patches: Patch[] };
  giveMaterials(n: number): void;
};
const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);
const sites = (page: Page) => reef(page, (h) => h.reefSites());
const goals = (page: Page) => page.locator(".goal-text");

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

/** Puts the ROV `distance` metres south of a site, level with the frame's middle, facing it. */
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

/**
 * Aims the crosshair at (x, y, z): the camera sits 6 m behind and 2 m above the ROV and looks along the aim, so the
 * ROV's pitch is searched until that ray passes through the target.
 */
async function aimAt(page: Page, rov: Vec, target: Vec) {
  await reef(
    page,
    (h, a) => {
      const [rx, ry, rz] = a.rov;
      const [tx, ty, tz] = a.target;
      const yaw = Math.atan2(tx - rx, tz - rz);
      const horizontal = Math.hypot(tx - rx, tz - rz);
      let best = 0;
      let bestError = Infinity;
      for (let p = -1.0; p <= 0.6; p += 0.002) {
        const camY = ry + 2 - 6 * Math.sin(p);
        const t = (horizontal + 6 * Math.cos(p)) / Math.cos(p);
        const error = Math.abs(camY + t * Math.sin(p) - ty);
        if (error < bestError) {
          best = p;
          bestError = error;
        }
      }
      h.placeRov(rx, ry, rz, yaw, best);
    },
    { rov, target },
  );
}

/** Holds the left button until `done()` is true, then lets go. */
async function shootUntil(page: Page, done: () => Promise<boolean>) {
  await page.mouse.down();
  await expect.poll(done, { timeout: 30_000 }).toBe(true);
  await page.mouse.up();
}

async function pressDigit3(page: Page) {
  await page.keyboard.press("Digit3");
  await expect(page.locator(".tool-name")).toHaveText("3 Seed launcher");
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("three reef sites and two seagrass patches exist in the east, empty at the start (AC-1)", async ({ page }) => {
    await startDive(page);
    const s = await sites(page);
    expect(s.frames).toHaveLength(3);
    expect(s.patches).toHaveLength(2);
    for (const site of [...s.frames, ...s.patches]) expect(site.x).toBeGreaterThan(12);
    expect(s.frames.every((f) => !f.installed && f.fragments === 0)).toBe(true);
    expect(s.patches.every((p) => p.seeds === 0)).toBe(true);
    // The Phase 2 list is not there before the first deposit.
    await expect(goals(page)).toHaveCount(3);
    await standSouthOf(page, "frame", 0, 30);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-004-markers-far.png" });
  });

  test("E with fewer than 5 materials installs nothing and says so; with 5 it installs and takes 5 (AC-2, AC-3)", async ({ page }) => {
    await startDive(page);
    await reef(page, (h) => h.giveMaterials(4));
    await expect(stat(page, "materials")).toHaveText("4");
    await standSouthOf(page, "frame", 0, 3);
    await expect(page.locator(".message-prompt")).toHaveText("Tekan E untuk memasang rangka (5 bahan)");
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toHaveText("Butuh 5 bahan. Setor sampah di stasiun.");
    await expect(stat(page, "materials")).toHaveText("4");
    expect((await sites(page)).frames[0].installed).toBe(false);

    await reef(page, (h) => h.giveMaterials(3));
    await expect(stat(page, "materials")).toHaveText("7");
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toHaveText("Rangka baja dan beton terpasang");
    await expect(stat(page, "materials")).toHaveText("2");
    expect((await sites(page)).frames.map((f) => f.installed)).toEqual([true, false, false]);
    // No prompt at a site that already has a frame, and E there does nothing more.
    await expect(page.locator(".message-prompt")).toBeHidden();
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(500);
    await expect(stat(page, "materials")).toHaveText("2");
    await page.screenshot({ path: "test-results/req-004-frame.png" });
  });

  test("E far from every site does nothing", async ({ page }) => {
    await startDive(page);
    await reef(page, (h) => h.giveMaterials(10));
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(500);
    await expect(stat(page, "materials")).toHaveText("10");
    await expect(page.locator(".message-notice")).toBeHidden();
  });

  test("an installed frame is solid for the ROV", async ({ page }) => {
    await startDive(page);
    await reef(page, (h) => h.giveMaterials(5));
    await standSouthOf(page, "frame", 0, 3);
    await page.keyboard.press("KeyE");
    await expect(stat(page, "materials")).toHaveText("0");
    await standSouthOf(page, "frame", 0, 4);
    await page.keyboard.down("KeyW");
    const distance = () =>
      reef(page, (h) => {
        const [x, , z] = h.rovPosition();
        const f = h.reefSites().frames[0];
        return Math.hypot(x - f.x, z - f.z);
      });
    await expect.poll(distance, { timeout: 20_000 }).toBeLessThan(2.6);
    await page.waitForTimeout(1500);
    await page.keyboard.up("KeyW");
    expect(await distance()).toBeGreaterThan(2.2);
  });

  test("key 3 selects the Seed launcher; shots at a frame attach coral, the third plants it, and it costs no materials (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await reef(page, (h) => h.giveMaterials(5));
    await standSouthOf(page, "frame", 0, 3);
    await page.keyboard.press("KeyE");
    await expect(stat(page, "materials")).toHaveText("0");
    await pressDigit3(page);
    await expect(page.locator(".tool-hint")).toHaveText("Klik kiri untuk menembak bibit ke rangka atau petak lamun");

    const f = (await sites(page)).frames[0];
    await aimAt(page, [f.x, f.y + 1, f.z + 9], [f.x, f.y + 1, f.z]);
    await page.mouse.down();
    await expect.poll(async () => (await sites(page)).frames[0].fragments, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: "test-results/req-004-coral-1.png" });
    await expect.poll(async () => (await sites(page)).frames[0].fragments, { timeout: 30_000 }).toBe(3);
    await page.mouse.up();
    await page.screenshot({ path: "test-results/req-004-coral-3.png" });
    await expect(stat(page, "materials")).toHaveText("0");

    // Planted: +50 score, and a further shot is lost without effect (AC-6).
    await expect(stat(page, "score")).toHaveText("50");
    await expect(page.locator(".message-notice")).toHaveText("Rangka ditanami koral, skor +50");
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    expect((await sites(page)).frames[0].fragments).toBe(3);
    await expect(stat(page, "score")).toHaveText("50");
  });

  test("shots at a patch plant sprouts; the third plants it (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await pressDigit3(page);
    const p = (await sites(page)).patches[0];
    await aimAt(page, [p.x - 8, p.y + 3, p.z], [p.x, p.y, p.z]);
    await page.mouse.down();
    await expect.poll(async () => (await sites(page)).patches[0].seeds, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: "test-results/req-004-seagrass-1.png" });
    await expect.poll(async () => (await sites(page)).patches[0].seeds, { timeout: 30_000 }).toBe(3);
    await page.mouse.up();
    await expect(stat(page, "score")).toHaveText("50");
    await expect(page.locator(".message-notice")).toHaveText("Petak lamun ditanami, skor +50");
    await page.screenshot({ path: "test-results/req-004-seagrass-3.png" });
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    expect((await sites(page)).patches[0].seeds).toBe(3);
    await expect(stat(page, "score")).toHaveText("50");
  });

  test("shots at plain sand, a cliff, or a site without a frame are lost and not counted (AC-6)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await pressDigit3(page);
    const s = await sites(page);

    // A site without a frame.
    const empty = s.frames[1];
    await aimAt(page, [empty.x, empty.y + 1, empty.z + 9], [empty.x, empty.y + 0.3, empty.z]);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();

    // Plain sand, far from every site.
    await aimAt(page, [0, -6, 30], [0, -12, 12]);
    await page.mouse.down();
    await page.waitForTimeout(2000);
    await page.mouse.up();

    // The cliff at the east edge of the bay, level with the ROV.
    await reef(page, (h) => h.placeRov(36, -6, -20, Math.PI / 2, 0));
    await page.mouse.down();
    await page.waitForTimeout(2000);
    await page.mouse.up();

    const after = await sites(page);
    expect(after.frames.every((f) => f.fragments === 0 && !f.installed)).toBe(true);
    expect(after.patches.every((q) => q.seeds === 0)).toBe(true);
    await expect(stat(page, "score")).toHaveText("0");
    await expect(stat(page, "materials")).toHaveText("0");
  });

  test("after the first deposit the Phase 2 list shows below Phase 1 and follows the progress (AC-7)", async ({ page }) => {
    test.setTimeout(150_000);
    await startDive(page);
    await expect(goals(page)).toHaveCount(3);

    // Suck one trash item, then deposit it at the station.
    await page.evaluate(() => {
      const hook = (window as any).__reef as Hook;
      const [px, , pz] = hook.rovPosition();
      const items = hook.trash();
      items.sort((a, b) => Math.hypot(a[0] - px, a[2] - pz) - Math.hypot(b[0] - px, b[2] - pz));
      const [x, y, z] = items[0];
      const len = Math.hypot(x, z) || 1;
      const rx = x - (x / len) * 3;
      const rz = z - (z / len) * 3;
      hook.placeRov(rx, y + 1, rz, Math.atan2(x - rx, z - rz), Math.atan2(-1, 3));
    });
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText("1/8", { timeout: 20_000 });
    await page.mouse.up();
    await reef(page, (h) => {
      const [x, y, z] = h.station();
      h.placeRov(x + 2, y + 2, z + 2, 0, 0);
    });
    await page.keyboard.press("KeyE");
    await expect(stat(page, "materials")).toHaveText("1");
    await expect(goals(page)).toHaveText([
      "Bersihkan teluk 2%/80%",
      "Bebaskan satwa 0/2",
      "Setor sampah ke stasiun",
      "Pasang rangka 0/3",
      "Tanam koral 0/3",
      "Tanam lamun 0/2",
    ]);
    await page.screenshot({ path: "test-results/req-004-phase2.png" });

    // Install one frame (4 more materials), plant coral on it, and plant one patch.
    await reef(page, (h) => h.giveMaterials(4));
    await standSouthOf(page, "frame", 0, 3);
    await page.keyboard.press("KeyE");
    await expect(goals(page).nth(3)).toHaveText("Pasang rangka 1/3");
    await pressDigit3(page);
    const s = await sites(page);
    await aimAt(page, [s.frames[0].x, s.frames[0].y + 1, s.frames[0].z + 9], [s.frames[0].x, s.frames[0].y + 1, s.frames[0].z]);
    await shootUntil(page, async () => (await sites(page)).frames[0].fragments >= 3);
    await expect(goals(page).nth(4)).toHaveText("Tanam koral 1/3");
    const p = s.patches[0];
    await aimAt(page, [p.x - 8, p.y + 3, p.z], [p.x, p.y, p.z]);
    await shootUntil(page, async () => (await sites(page)).patches[0].seeds >= 3);
    await expect(goals(page).nth(5)).toHaveText("Tanam lamun 1/2");
    await expect(stat(page, "score")).toHaveText("110"); // 10 for the trash, 50 for the planted frame, 50 for the planted patch
  });

  test("the pause controls list key 3 and the E action", async ({ page }) => {
    await startDive(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Kontrol" }).click();
    const rows = await page.locator(".controls dt").evaluateAll((els) => els.map((el) => `${el.textContent} = ${el.nextElementSibling?.textContent}`));
    expect(rows).toContain("3 = Pilih Seed launcher");
    expect(rows).toContain("E = Setor sampah atau pasang rangka");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("prompt, message, tool and Phase 2 goals are in English (G-004)", async ({ page }) => {
    await startDive(page);
    await reef(page, (h) => h.giveMaterials(4));
    await standSouthOf(page, "frame", 1, 3);
    await expect(page.locator(".message-prompt")).toHaveText("Press E to install a frame (5 materials)");
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toHaveText("You need 5 materials. Deposit trash at the station.");
    await page.keyboard.press("Digit3");
    await expect(page.locator(".tool-name")).toHaveText("3 Seed launcher");
    await expect(page.locator(".tool-hint")).toHaveText("Left click to shoot seeds at a frame or a seagrass patch");
  });
});
