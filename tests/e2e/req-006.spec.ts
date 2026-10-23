import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
type Hook = {
  rovPosition(): Vec;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
  removeTrash(n: number): number;
  plantAll(what?: "all" | "frames" | "patches"): void;
  clock(): number;
  mode(): string;
  hud(): { tool: string; scanProgress?: number; notice: { key: string; entry?: string } | null; unlocked?: string[] } | null;
  bloom(): { state: string; scannerOpen: boolean };
  seaLife(): { scale: number; creatures: { id: number; species: string; position: Vec }[] };
  animals(): { id: number; species: string; state: string; position: Vec }[];
  reefSites(): { frames: { x: number; y: number; z: number }[]; patches: { x: number; y: number; z: number }[] };
  freeAnimals(): void;
  unlocked(): string[];
  unlockEntries(ids: string[]): void;
  newDive(): void;
};

const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const unlocked = (page: Page) => reef(page, (h) => h.unlocked());
const scanProgress = (page: Page) => reef(page, (h) => h.hud()?.scanProgress ?? 0);
const gameClock = (page: Page) => reef(page, (h) => h.clock());
const goals = (page: Page) => page.locator(".goal:visible .goal-text");
const pointerLocked = (page: Page) => page.evaluate(() => document.pointerLockElement !== null);
const mode = (page: Page) => reef(page, (h) => h.mode());

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => mode(page)).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position, which would turn
  // the ROV at every click. Park the cursor at (0, 0), where that movement is zero, before aiming.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/**
 * Two little helpers that run inside the page, once per animation frame: one keeps the ROV where the crosshair
 * points at a moving target (`track`), the other records every distinct notice, so a short message is not missed.
 */
async function installHelpers(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__aimFn = null;
    w.__notices = [] as string[];
    let lastNotice = "";
    const tick = () => {
      const h = w.__reef;
      if (w.__aimFn) {
        const [tx, ty, tz, d, dy] = w.__aimFn(h) as number[];
        const len = Math.hypot(tx, tz) || 1;
        const px = tx - (tx / len) * d;
        const pz = tz - (tz / len) * d;
        const py = ty + dy;
        let yaw = 0;
        let pitch = 0;
        for (let i = 0; i < 40; i++) {
          const ax = Math.sin(yaw) * Math.cos(pitch);
          const ay = Math.sin(pitch);
          const az = Math.cos(yaw) * Math.cos(pitch);
          const v = [tx - (px - ax * 6), ty - (py - ay * 6 + 2), tz - (pz - az * 6)];
          yaw = Math.atan2(v[0], v[2]);
          pitch = Math.asin(v[1] / Math.hypot(v[0], v[1], v[2]));
        }
        h.placeRov(px, py, pz, yaw, pitch);
      }
      const n = h.hud()?.notice;
      const text = n ? `${n.key}${n.entry ? ":" + n.entry : ""}` : "";
      if (text && text !== lastNotice) w.__notices.push(text);
      lastNotice = text;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Keeps the crosshair on whatever `expr` returns: [x, y, z, distance, height of the ROV above the point]. */
const track = (page: Page, expr: string) =>
  page.evaluate((src) => {
    (window as any).__aimFn = new Function("h", `return (${src});`);
  }, expr);
const stopTracking = (page: Page) =>
  page.evaluate(() => {
    (window as any).__aimFn = null;
  });
const notices = (page: Page) => page.evaluate(() => (window as any).__notices as string[]);
const creature = (species: string, index = 0, dy = 0.8) =>
  `(() => { const c = h.seaLife().creatures.filter((c) => c.species === "${species}")[${index}]; return [...c.position, 4, ${dy}]; })()`;
const animal = (species: string) => `(() => { const a = h.animals().find((a) => a.species === "${species}"); return [...a.position, 4, 0.8]; })()`;

async function reachBloom(page: Page) {
  await reef(page, (h) => {
    h.removeTrash(50);
    h.plantAll();
  });
  await expect.poll(async () => (await reef(page, (h) => h.bloom())).state, { timeout: 200_000 }).toBe("done");
  await expect.poll(async () => (await reef(page, (h) => h.seaLife())).scale, { timeout: 100_000 }).toBe(1);
}

/** Lets go of the button and waits for a game frame, so the game sees it let go before the next press. */
async function release(page: Page) {
  await page.mouse.up();
  const from = await gameClock(page);
  await expect.poll(() => gameClock(page), { timeout: 30_000 }).toBeGreaterThan(from);
}

/** Holds the button until the entry is open, then lets go. */
async function scan(page: Page, entry: string) {
  await page.mouse.down();
  await expect.poll(() => unlocked(page), { timeout: 90_000 }).toContain(entry);
  await release(page);
}

const rect = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the Scanner is locked before the Bloom, and L opens a frozen Logbook of '???' slots and closes it again (AC-2, AC-4, REQ-010 AC-6)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await installHelpers(page);

    // AC-4: key 4 gives the message and selects nothing; the Vacuum stays.
    await expect(page.locator(".tool-name")).toHaveText("2 Vacuum");
    await page.keyboard.press("Digit4");
    await expect(page.locator(".message-notice")).toHaveText("Scanner aktif setelah laut pulih");
    await expect(page.locator(".tool-name")).toHaveText("2 Vacuum");

    // AC-2: L opens the Logbook. The game stops, the cursor is free, the HUD and the minimap are gone.
    await expect(page.locator(".hud-minimap")).toBeVisible();
    const minimap = await page.locator(".hud-minimap").evaluate((el) => el.outerHTML);
    await page.keyboard.press("KeyL");
    await expect(page.locator(".logbook")).toBeVisible();
    expect(await mode(page)).toBe("paused");
    expect(await pointerLocked(page)).toBe(false);
    await expect(page.locator(".hud")).toHaveCount(0);
    await expect(page.locator(".hud-minimap")).toHaveCount(0);
    await expect(page.locator(".pause-screen")).toHaveCount(0);
    await expect(page.locator(".slot")).toHaveCount(7);
    await expect(page.locator(".slot-name")).toHaveText(Array(7).fill("???"));
    await expect(page.locator('.slot[data-state="locked"]')).toHaveCount(7);
    await expect(page.locator(".logbook-count")).toHaveText("Entri terbuka 0/7");
    await page.screenshot({ path: "test-results/req-006-logbook-empty.png" });

    const frozen = await gameClock(page);
    await page.waitForTimeout(1500);
    expect(await gameClock(page)).toBe(frozen);

    // L closes it: the same game goes on, the cursor is locked again, the minimap comes back as it was.
    await page.keyboard.press("KeyL");
    await expect.poll(() => mode(page)).toBe("playing");
    expect(await pointerLocked(page)).toBe(true);
    await expect(page.locator(".logbook")).toHaveCount(0);
    await expect(page.locator(".hud-minimap")).toBeVisible();
    expect(await page.locator(".hud-minimap").evaluate((el) => el.outerHTML)).toBe(minimap);
    await expect.poll(() => gameClock(page)).toBeGreaterThan(frozen);

    // Esc closes it too. Whether Chrome lets the game lock the cursor from an Esc keypress is recorded below.
    await page.keyboard.press("KeyL");
    await expect(page.locator(".logbook")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".logbook")).toHaveCount(0);
    const afterEsc = (await pointerLocked(page)) ? "playing" : "pause menu";
    test.info().annotations.push({ type: "Esc closes the Logbook and goes to", description: afterEsc });
    if (afterEsc === "playing") {
      expect(await mode(page)).toBe("playing");
      await expect(page.locator(".hud")).toBeVisible();
    } else {
      await expect(page.locator(".pause-screen")).toBeVisible();
      await expect(page.locator('[role="alert"]')).toHaveText("Kursor belum terkunci ke game. Klik Lanjut lagi.");
      await page.getByRole("button", { name: "Lanjut" }).click();
      await expect.poll(() => mode(page)).toBe("playing");
    }

    // The close button works too.
    await page.keyboard.press("KeyL");
    await page.getByRole("button", { name: "Tutup" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    expect(await pointerLocked(page)).toBe(true);

    // The pause menu lists the two new controls.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Kontrol" }).click();
    const rows = await page.locator(".controls dt").evaluateAll((els) => els.map((el) => `${el.textContent} = ${el.nextElementSibling?.textContent}`));
    expect(rows).toContain("4 = Pilih Scanner");
    expect(rows).toContain("L = Buka atau tutup Marine Logbook");
    // Nothing was announced as a new entry.
    expect((await notices(page)).filter((n) => n.startsWith("scanner.newEntry"))).toEqual([]);
  });

  test("after the Bloom the crosshair scans all seven kinds in 1.5 s; trapped animals, lost aim and repeats behave (AC-1, 2, 3, 5, 6, 7)", async ({ page }) => {
    test.setTimeout(600_000);
    await startDive(page);
    await installHelpers(page);
    await reachBloom(page);

    // Key 4 now selects the Scanner, and the goal reads "Pindai 0/7".
    await page.keyboard.press("Digit4");
    await expect(page.locator(".tool-name")).toHaveText("4 Scanner");
    await expect(goals(page)).toHaveText(["Pindai 0/7"]);

    // AC-7: the trapped turtle gives the message and nothing is scanned, however long the aim stays.
    await track(page, animal("turtle"));
    await page.mouse.down();
    await expect.poll(async () => (await notices(page)).includes("scanner.trapped")).toBe(true);
    await expect(page.locator(".message-notice")).toHaveText("Bebaskan dulu satwa ini");
    const start = await gameClock(page);
    await expect.poll(() => gameClock(page), { timeout: 60_000 }).toBeGreaterThan(start + 2);
    expect(await unlocked(page)).not.toContain("turtle");
    expect(await scanProgress(page)).toBe(0);
    await expect(page.locator(".cut-progress")).toBeHidden();
    await page.mouse.up();
    await stopTracking(page);
    await reef(page, (h) => h.freeAnimals());

    // AC-5: the aim leaves a clownfish after a moment; the progress goes back to zero and nothing opens.
    await track(page, creature("clownfish"));
    await page.mouse.down();
    await expect.poll(() => scanProgress(page), { timeout: 30_000 }).toBeGreaterThan(0.2);
    await expect(page.locator(".cut-label")).toContainText("Memindai");
    await stopTracking(page);
    await reef(page, (h) => {
      const [x, y, z] = h.rovPosition();
      h.placeRov(x, y, z, Math.PI * 0.25, -1);
    });
    await expect.poll(() => scanProgress(page), { timeout: 30_000 }).toBe(0);
    await expect(page.locator(".cut-progress")).toBeHidden();
    const lostAt = await gameClock(page);
    await expect.poll(() => gameClock(page), { timeout: 60_000 }).toBeGreaterThan(lostAt + 2);
    expect(await unlocked(page)).not.toContain("clownfish");

    // AC-1: back on a clownfish for 1.5 s, the entry opens and the goal counts it. (A manta ray swims over the
    // east side of the bay and can cross the line of sight, so the lists below are checked for what matters.)
    await track(page, creature("clownfish"));
    await expect.poll(() => unlocked(page), { timeout: 90_000 }).toContain("clownfish");
    await expect.poll(async () => (await notices(page)).includes("scanner.newEntry:clownfish")).toBe(true);
    await expect(goals(page)).toHaveText([`Pindai ${(await unlocked(page)).length}/7`]);
    // Holding on after it opened does not say "Sudah tercatat" straight away.
    const held = await gameClock(page);
    await expect.poll(() => gameClock(page), { timeout: 60_000 }).toBeGreaterThan(held + 1);
    const afterOpen = (await notices(page)).indexOf("scanner.newEntry:clownfish") + 1;
    expect((await notices(page))[afterOpen]).not.toBe("scanner.known");
    await release(page);

    // AC-6: scanning a recorded kind again says so and the count stays. (Another clownfish is the same entry.)
    const before = await unlocked(page);
    // A manta ray crossing the aim above can already have said "Sudah tercatat"; the recorder only sees a change of
    // text, so wait for the HUD to clear before aiming again.
    await expect.poll(() => reef(page, (h) => h.hud()?.notice ?? null), { timeout: 30_000 }).toBeNull();
    const said = (await notices(page)).length;
    await track(page, creature("clownfish", 3));
    await page.mouse.down();
    await expect.poll(async () => (await notices(page)).slice(said).includes("scanner.known"), { timeout: 30_000 }).toBe(true);
    expect(await scanProgress(page)).toBe(0);
    expect(await unlocked(page)).toEqual(before);
    await expect(goals(page)).toHaveText([`Pindai ${before.length}/7`]);
    await release(page);

    // The rest: the freed turtle and shark, a manta ray, a dolphin, the coral and the seagrass.
    await track(page, animal("turtle"));
    await scan(page, "turtle");
    await track(page, animal("reefShark"));
    await scan(page, "reefShark");
    await track(page, creature("mantaRay", 0));
    await scan(page, "mantaRay");
    await track(page, creature("dolphin", 0, -0.5));
    await scan(page, "dolphin");
    await track(page, "(() => { const f = h.reefSites().frames[0]; return [f.x, f.y + 1, f.z, 4, 0.8]; })()");
    await scan(page, "coral");
    await track(page, "(() => { const p = h.reefSites().patches[0]; return [p.x, p.y + 0.9, p.z, 4, 0.8]; })()");
    await page.mouse.down();
    await expect.poll(() => scanProgress(page), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: "test-results/req-006-scanning.png" });
    await expect.poll(() => unlocked(page), { timeout: 90_000 }).toContain("seagrass");
    await page.mouse.up();
    await stopTracking(page);

    const log = await notices(page);
    for (const id of ["turtle", "reefShark", "clownfish", "mantaRay", "dolphin", "coral", "seagrass"]) expect(log).toContain(`scanner.newEntry:${id}`);
    expect((await unlocked(page)).length).toBe(7);
    await expect(goals(page)).toHaveText(["Pindai 7/7"]);
    await expect(page.locator('.goal[data-goal="scan"]')).toHaveClass(/done/);

    // AC-2, AC-3: the Logbook lists the seven names and opens an entry with its facts, SDG link and sources.
    await page.keyboard.press("KeyL");
    await expect(page.locator(".logbook")).toBeVisible();
    await expect(page.locator(".slot-name")).toHaveText(["Penyu hijau", "Hiu sirip hitam karang", "Ikan badut", "Pari manta karang", "Lumba-lumba spinner", "Karang", "Lamun"]);
    await expect(page.locator(".logbook-count")).toHaveText("Entri terbuka 7/7");
    await page.locator('.slot[data-entry="turtle"]').click();
    await expect(page.locator(".entry h3")).toHaveText("Penyu hijau");
    await expect(page.locator(".entry-facts")).toContainText("Penyu hijau makan lamun dan alga");
    await expect(page.locator(".entry-sdg")).toContainText("Target 14.1");
    const links = page.locator(".entry-sources a");
    expect(await links.count()).toBeGreaterThanOrEqual(2);
    await expect(links.first()).toHaveAttribute("target", "_blank");
    await expect(links.first()).toHaveAttribute("rel", /noopener/);
    await expect(links.first()).toHaveAttribute("href", /^https:\/\//);
    await page.screenshot({ path: "test-results/req-006-logbook-full.png" });
    await page.keyboard.press("KeyL");
    await expect.poll(() => mode(page)).toBe("playing");

    // A new dive starts with an empty Logbook and a locked Scanner.
    await reef(page, (h) => h.newDive());
    await page.mouse.move(0, 0);
    expect(await unlocked(page)).toEqual([]);
    await page.keyboard.press("Digit4");
    await expect(page.locator(".message-notice")).toHaveText("Scanner aktif setelah laut pulih");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the Logbook shows opened entries in English with sources, fits the text without scrolling at 1366x768 and still works at 800x450 (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await installHelpers(page);

    await page.keyboard.press("Digit4");
    await expect(page.locator(".message-notice")).toHaveText("The Scanner unlocks once the sea recovers");

    const all = ["turtle", "reefShark", "clownfish", "mantaRay", "dolphin", "coral", "seagrass"];
    await reef(page, (h, ids) => h.unlockEntries(ids), ["mantaRay", "seagrass", "turtle"]);
    await expect(goals(page).first()).toHaveText("Clean the bay 0%/80%");
    await page.keyboard.press("KeyL");
    await expect(page.locator(".logbook")).toBeVisible();
    await expect(page.locator(".slot-name")).toHaveText(["Green turtle", "???", "???", "Reef manta ray", "???", "???", "Seagrass"]);
    await expect(page.locator(".logbook-count")).toHaveText("Entries unlocked 3/7");
    await expect(page.locator(".entry h3")).toHaveText("Green turtle");
    await expect(page.locator(".entry h4")).toHaveText(["Facts", "Link to SDG 14", "Sources"]);

    // A locked slot cannot be opened.
    await expect(page.locator('.slot[data-entry="dolphin"]')).toBeDisabled();
    await page.locator('.slot[data-entry="seagrass"]').click();
    await expect(page.locator(".entry h3")).toHaveText("Seagrass");
    await expect(page.locator(".entry-facts")).toContainText("Seagrasses are flowering plants");

    // 1366x768: every entry's facts and SDG link are fully in view, with no scrolling, and the panel fits the window.
    await reef(page, (h, ids) => h.unlockEntries(ids), all);
    await page.keyboard.press("KeyL");
    await expect.poll(() => mode(page)).toBe("playing");
    await expect.poll(() => reef(page, (h) => h.hud()?.unlocked?.length)).toBe(7);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.keyboard.press("KeyL");
    await expect(page.locator(".logbook")).toBeVisible();
    for (const id of all) {
      await page.locator(`.slot[data-entry="${id}"]`).click();
      const entry = await rect(page, ".entry");
      const sdg = await rect(page, ".entry-sdg");
      const panel = await rect(page, ".logbook");
      expect(sdg.bottom, `${id} SDG text inside the entry area`).toBeLessThanOrEqual(entry.bottom + 1);
      expect(panel.top).toBeGreaterThanOrEqual(0);
      expect(panel.bottom).toBeLessThanOrEqual(768);
      await expect(page.locator(".entry-sources li").first()).toBeVisible();
    }
    await page.locator('.slot[data-entry="turtle"]').click();
    await page.screenshot({ path: "test-results/req-006-logbook-1366.png" });

    // 800x450: the panel still fits the window and the close button can be reached; the entry area scrolls if it must.
    await page.setViewportSize({ width: 800, height: 450 });
    for (const id of all) {
      await page.locator(`.slot[data-entry="${id}"]`).click();
      const panel = await rect(page, ".logbook");
      expect(panel.top).toBeGreaterThanOrEqual(0);
      expect(panel.bottom).toBeLessThanOrEqual(450);
      expect(panel.right).toBeLessThanOrEqual(800);
      const entry = await rect(page, ".entry");
      const sdg = await rect(page, ".entry-sdg");
      test.info().annotations.push({ type: `800x450 ${id}`, description: sdg.bottom <= entry.bottom + 1 ? "facts and SDG fit" : "SDG text needs scrolling" });
    }
    await page.locator('.slot[data-entry="turtle"]').click();
    await page.screenshot({ path: "test-results/req-006-logbook-800.png" });
    await expect(page.getByRole("button", { name: "Close" })).toBeInViewport();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(page.locator(".hud-minimap")).toBeVisible();
  });
});
