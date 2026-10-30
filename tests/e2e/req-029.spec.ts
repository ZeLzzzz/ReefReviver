import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { LOGBOOK_ENTRIES } from "../../src/logbook/entries";

// REQ-029: the mission card after the opening. The browser tests start with the cinematics off (dev server with VITE_TEST_SEED), so
// each test here turns them on with `__reef.cinematics(true)` before Mulai and lets the opening go to its end with `seekCinematic`.

type Vec = [number, number, number];

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const { cinematic, rov } = config;
const mode = (page: Page) => reef(page, (h) => h.mode());
const cine = (page: Page) => reef(page, (h) => h.cinematic()) as Promise<{ kind: string } | null>;
const position = (page: Page) => reef(page, (h) => h.rovPosition()) as Promise<Vec>;
const playSeconds = (page: Page) => reef(page, (h) => h.playSeconds()) as Promise<number>;
const locked = (page: Page) => page.evaluate(() => document.pointerLockElement?.id ?? null);
const card = (page: Page) => page.locator(".mission-screen");
const startButton = (page: Page) => page.getByRole("button", { name: /^(Mulai menyelam|Start diving)$/ });

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

/** Lets the opening play to its end and waits for the card. */
async function openingToCard(page: Page) {
  await reef(page, (h, a) => h.seekCinematic(a.seconds), { seconds: cinematic.opening.duration - 0.6 });
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("when the opening ends the card shows over the stopped game, the cursor is free and the player cannot move; the button gives back the HUD and the cursor (AC-1, AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await boot(page);
    await startWithCinematics(page);
    expect(await locked(page)).toBe("scene");
    await openingToCard(page);

    // The game stopped behind it, the cursor is released, and there is no HUD or crosshair.
    await expect.poll(() => mode(page)).toBe("paused");
    expect(await locked(page)).toBeNull();
    expect(await cine(page)).toBeNull();
    await expect(page.getByRole("dialog", { name: "Misi: Pulihkan Teluk" })).toBeVisible();
    await expect(page.locator(".crosshair")).toHaveCount(0);
    await expect(page.locator(".hud")).toHaveCount(0);
    await expect(page.locator(".pause-screen")).toHaveCount(0);
    // In the middle of the screen.
    const viewport = page.viewportSize()!;
    const box = (await page.locator(".panel.mission").boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
    // Nothing moves behind it.
    const start = await position(page);
    expect(start).toEqual([rov.start.x, rov.start.y, rov.start.z]);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(700);
    await page.keyboard.up("KeyW");
    expect(await position(page)).toEqual(start);
    await page.screenshot({ path: "test-results/req-029-card.png" });

    // Mulai menyelam: the card closes, the cursor is locked again, the HUD is there and the submarine answers the keys.
    await startButton(page).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect.poll(() => locked(page)).toBe("scene");
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator(".crosshair")).toBeVisible();
    await expect(page.locator(".hud-goals")).toBeVisible();
    await expect(page.locator(".cine")).toBeHidden();
    await page.keyboard.down("KeyW");
    await expect.poll(async () => Math.hypot(...(await position(page)).map((v, i) => v - start[i])), { timeout: 15_000 }).toBeGreaterThan(1.5);
    await page.keyboard.up("KeyW");
    expect(problems).toEqual([]);
  });

  test("a skipped opening gives the card too, and Enter closes it (AC-1, AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await reef(page, (h, a) => h.seekCinematic(a.seconds), { seconds: 6 });
    await page.mouse.click(400, 225);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => mode(page)).toBe("paused");
    expect(await locked(page)).toBeNull();
    // The picture behind the card is the player's view: the screen is not left black by the skip's fade.
    expect(await reef(page, (h) => h.screenFade())).toBe(0);

    await page.keyboard.press("Enter");
    await expect.poll(() => mode(page)).toBe("playing");
    await expect.poll(() => locked(page)).toBe("scene");
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator(".crosshair")).toBeVisible();
    // No black flash after it: the fade stays at zero.
    expect(await reef(page, (h) => h.screenFade())).toBe(0);
  });

  test("the browser refusing the cursor leaves the card with 'Klik tombolnya lagi'; the next click works (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await openingToCard(page);
    await page.evaluate(() => {
      const scene = document.getElementById("scene")!;
      (scene as any).requestPointerLock = () => void document.dispatchEvent(new Event("pointerlockerror"));
    });
    await startButton(page).click();
    await expect(page.getByRole("alert")).toHaveText("Kursor belum terkunci ke game. Klik tombolnya lagi.");
    await expect(card(page)).toBeVisible();
    expect(await mode(page)).toBe("paused");
    await page.evaluate(() => delete (document.getElementById("scene") as any).requestPointerLock);
    await startButton(page).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect.poll(() => locked(page)).toBe("scene");
    await expect(card(page)).toHaveCount(0);
  });

  test("the card names the bay's state and the four missions with the game's own numbers (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await openingToCard(page);
    await expect(page.locator(".panel.mission h1")).toHaveText("Misi: Pulihkan Teluk");
    await expect(page.locator(".panel.mission > p:not(.mission-sdg)").first()).toHaveText(
      `Teluk ini keruh dan karangnya memucat. Sekitar ${config.trash.count} sampah berserakan di dasar laut, mengapung di permukaan, dan tergeletak di pantai. Dua jaring hantu menjerat seekor penyu dan seekor hiu karang.`,
    );
    expect(config.phase1.nets).toBe(2); // the card says "Dua"
    await expect(page.locator(".panel.mission h2")).toHaveText("Misi");
    await expect(page.locator(".mission-list li")).toHaveText([
      `Bersihkan teluk sampai ${config.phase1.cleanTarget}%, lalu setor sampahnya di gudang daur ulang di darat.`,
      "Potong jaring hantu untuk membebaskan penyu dan hiu karang.",
      `Pasang ${config.reef.frames} rangka terumbu, tembakkan fragmen koral ke rangka, dan tanam biji lamun di ${config.reef.patches} petak.`,
      `Setelah teluk jernih kembali, pindai ${LOGBOOK_ENTRIES.length} satwa dan biota untuk Marine Logbook.`,
    ]);
    await expect(page.locator(".mission-controls")).toHaveText("WASD bergerak · Mouse mengarahkan · Spasi/Shift naik/turun · Klik kiri pakai alat · 1–4 pilih alat · E berinteraksi");
    await expect(page.locator(".mission-closing")).toHaveText("Bisakah kamu memulihkan teluk ini?");
    await expect(startButton(page)).toHaveText("Mulai menyelam");
    // The number is the game's: the bay really has that much trash lying in it.
    expect(((await reef(page, (h) => h.trash())) as Vec[]).length).toBe(config.trash.count);
    // No character, picture or portrait (D-114).
    await expect(page.locator(".panel.mission img, .panel.mission svg, .panel.mission canvas")).toHaveCount(0);
  });

  test("it only follows the opening: Main lagi plays at once without it, and after a refresh it comes with the opening again (AC-6)", async ({ page }) => {
    test.setTimeout(240_000);
    await startWithCinematics(page);
    await openingToCard(page);
    await startButton(page).click();
    await expect.poll(() => mode(page)).toBe("playing");
    // To the end screen, with no other cinematic in the way (they belong to REQ-028).
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
    await expect(page.locator(".crosshair")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(await cine(page)).toBeNull();

    // Refreshed, the game has forgotten it (nothing is saved, D-021): the opening plays and the card follows it.
    await page.reload();
    await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
    await reef(page, (h) => h.cinematics(true));
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(async () => (await cine(page))?.kind).toBe("opening");
    await expect(card(page)).toHaveCount(0);
    await openingToCard(page);
    const storage = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    expect(storage.filter((key) => /mission|card|intro|opening/i.test(key))).toEqual([]);
  });

  test("while it is open the play time stands still, the music is quiet, and Esc, L, M and the movement keys change nothing (AC-7)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page);
    await openingToCard(page);
    expect(await playSeconds(page)).toBe(0);
    await expect.poll(async () => ((await reef(page, (h) => h.audio())) as { phase: string }).phase).toBe("quiet");
    const start = await position(page);
    for (const key of ["Escape", "KeyL", "KeyM", "KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "Digit1", "KeyE"]) {
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
    await page.waitForTimeout(1500);
    // Still the card: no pause menu, no Logbook, no HUD tag for the mute, the same place, the same (zero) time.
    await expect(card(page)).toBeVisible();
    await expect(page.locator(".pause-screen, .logbook-screen, .hud")).toHaveCount(0);
    expect(await mode(page)).toBe("paused");
    expect(await position(page)).toEqual(start);
    expect(await playSeconds(page)).toBe(0);
    expect(((await reef(page, (h) => h.audio())) as { muted: boolean; phase: string })).toMatchObject({ muted: false, phase: "quiet" });

    // Back in the dive the time runs and the music is back.
    await startButton(page).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect.poll(async () => ((await reef(page, (h) => h.audio())) as { phase: string }).phase).toBe("playing");
    await expect.poll(() => playSeconds(page)).toBeGreaterThan(0.5);
  });

  for (const [width, height] of [
    [800, 450],
    [1280, 720],
    [1920, 1080],
  ] as const) {
    test(`it is whole and readable at ${width}x${height}, scrolling inside the panel if it has to (AC-8)`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await startWithCinematics(page);
      await openingToCard(page);
      const panel = page.locator(".panel.mission");
      const metrics = await panel.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
          scrolls: el.scrollHeight > el.clientHeight + 1,
          overflowY: style.overflowY,
          sideways: el.scrollWidth > el.clientWidth + 1,
          // Every line of text is inside the panel's width.
          wide: [...el.querySelectorAll("h1, h2, p, li, button")].filter((child) => child.getBoundingClientRect().right > box.right + 0.5).length,
          font: [...el.querySelectorAll("p, li")].map((child) => parseFloat(getComputedStyle(child).fontSize)),
        };
      });
      // The panel is inside the window, on every side, and nothing sticks out sideways.
      expect(metrics.box.x).toBeGreaterThanOrEqual(0);
      expect(metrics.box.y).toBeGreaterThanOrEqual(0);
      expect(metrics.box.right).toBeLessThanOrEqual(width);
      expect(metrics.box.bottom).toBeLessThanOrEqual(height);
      expect(metrics.sideways).toBe(false);
      expect(metrics.wide).toBe(0);
      expect(Math.min(...metrics.font)).toBeGreaterThanOrEqual(13);
      if (metrics.scrolls) expect(metrics.overflowY).toMatch(/auto|scroll/);
      if (width >= 1280) expect(metrics.scrolls).toBe(false);
      await page.screenshot({ path: `test-results/req-029-card-${width}x${height}.png` });

      // Everything can be reached: the last line and the button come into the panel's view.
      await panel.evaluate((el) => (el.scrollTop = el.scrollHeight));
      const last = (await page.locator(".mission-closing").boundingBox())!;
      const button = (await startButton(page).boundingBox())!;
      expect(button.y + button.height).toBeLessThanOrEqual(height);
      expect(last.y).toBeGreaterThanOrEqual(0);
      await startButton(page).click();
      await expect.poll(() => mode(page)).toBe("playing");
    });
  }
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the whole card is in English, with Start diving (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startWithCinematics(page, /Start/);
    await openingToCard(page);
    await expect(page.getByRole("dialog", { name: "Mission: Restore the Bay" })).toBeVisible();
    await expect(page.locator(".panel.mission h1")).toHaveText("Mission: Restore the Bay");
    await expect(page.locator(".panel.mission > p:not(.mission-sdg)").first()).toHaveText(
      `The bay is murky and its corals are bleaching. About ${config.trash.count} pieces of trash lie on the sea floor, float on the surface and litter the beach. Two ghost nets have trapped a turtle and a reef shark.`,
    );
    await expect(page.locator(".panel.mission h2")).toHaveText("Mission");
    await expect(page.locator(".mission-list li")).toHaveText([
      `Clean the bay to ${config.phase1.cleanTarget}%, then drop the trash off at the recycling shed on land.`,
      "Cut the ghost nets to free the turtle and the reef shark.",
      `Set up ${config.reef.frames} reef frames, shoot coral fragments onto them, and plant seagrass seeds in ${config.reef.patches} patches.`,
      `Once the bay is clear again, scan ${LOGBOOK_ENTRIES.length} kinds of sea life for the Marine Logbook.`,
    ]);
    await expect(page.locator(".mission-controls")).toHaveText("WASD move · Mouse steer · Space/Shift up/down · Left click use tool · 1–4 choose tool · E interact");
    await expect(page.locator(".mission-closing")).toHaveText("Can you bring this bay back to life?");
    await expect(startButton(page)).toHaveText("Start diving");
    await page.screenshot({ path: "test-results/req-029-card-en.png" });
    // Refused cursor: the message is English too.
    await page.evaluate(() => {
      (document.getElementById("scene") as any).requestPointerLock = () => void document.dispatchEvent(new Event("pointerlockerror"));
    });
    await startButton(page).click();
    await expect(page.getByRole("alert")).toHaveText("The game couldn't capture the mouse. Click the button again.");
  });
});
