import { expect, test, type Page } from "@playwright/test";

type Hook = {
  mode(): string;
  clock(): number;
  rovPosition(): [number, number, number];
  hud(): { score: number; notice: { key: string; entry?: string } | null } | null;
  trash(): unknown[];
  removeTrash(n: number): number;
  plantAll(what?: "all" | "frames" | "patches"): void;
  freeAnimals(): void;
  bloom(): { state: string };
  unlocked(): string[];
  scanEntry(id: string): void;
  playSeconds(): number;
};

const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const mode = (page: Page) => reef(page, (h) => h.mode());
const playSeconds = (page: Page) => reef(page, (h) => h.playSeconds());
const gameClock = (page: Page) => reef(page, (h) => h.clock());
const endScreen = (page: Page) => page.locator(".end-screen");
const goals = (page: Page) => page.locator(".goal:visible .goal-text");
const stats = (page: Page) =>
  page.locator(".end-stats > div").evaluateAll((rows) => rows.map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
const asPlayTime = (seconds: number) => `${Math.floor(Math.floor(seconds) / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;

/** The first six entries in Logbook order; the seventh (seagrass) is scanned by each test. */
const FIRST_SIX = ["turtle", "reefShark", "clownfish", "mantaRay", "dolphin", "coral"];

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => mode(page)).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  await page.mouse.move(0, 0);
}

/** Frees both animals, cleans to 80 % and plants every site, then waits for the Bloom to finish. */
async function reachBloom(page: Page) {
  await reef(page, (h) => {
    h.freeAnimals();
    h.removeTrash(50);
    h.plantAll();
  });
  await expect.poll(async () => (await reef(page, (h) => h.bloom())).state, { timeout: 200_000 }).toBe("done");
}

/** Waits until the game has simulated `seconds` more, so a check covers real play and not one frame. */
async function playFor(page: Page, seconds: number) {
  const from = await gameClock(page);
  await expect.poll(() => gameClock(page), { timeout: 120_000 }).toBeGreaterThan(from + seconds);
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the 7th entry brings the end screen with the session's numbers; the time leaves out pauses; explore on; refresh starts over (AC-1, 2, 4, 5, 6)", async ({ page }) => {
    test.setTimeout(400_000);
    const started = Date.now();
    await startDive(page);
    await reachBloom(page);
    for (const id of FIRST_SIX) await reef(page, (h, entry) => h.scanEntry(entry), id);
    await expect(goals(page)).toHaveText(["Pindai 6/7"]);

    // AC-4: the time stands still in the pause menu and in the Logbook.
    await page.keyboard.press("Escape");
    await expect.poll(() => mode(page)).toBe("paused");
    const paused = await playSeconds(page);
    await page.waitForTimeout(2500);
    expect(await playSeconds(page)).toBe(paused);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await page.keyboard.press("KeyL");
    await expect(page.locator(".logbook")).toBeVisible();
    const inLogbook = await playSeconds(page);
    await page.waitForTimeout(2500);
    expect(await playSeconds(page)).toBe(inLogbook);
    await page.keyboard.press("KeyL");
    await expect.poll(() => mode(page)).toBe("playing");
    await expect.poll(() => playSeconds(page)).toBeGreaterThan(inLogbook);

    // AC-1: the 7th entry; its notice shows first, then the end screen.
    const score = (await reef(page, (h) => h.hud()))!.score;
    await reef(page, (h) => h.scanEntry("seagrass"));
    await expect(page.locator(".message-notice")).toHaveText("Entri baru: Lamun");
    await expect(endScreen(page)).toHaveCount(0);
    await expect(endScreen(page)).toBeVisible({ timeout: 60_000 });
    expect(await mode(page)).toBe("paused");
    await expect(page.locator(".hud")).toHaveCount(0);
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.screenshot({ path: "test-results/req-008-end.png" });

    // AC-2 and AC-4: the numbers of this dive; the play time stopped at the 7th entry and leaves out the 5 s of pauses.
    const seconds = await playSeconds(page);
    expect(seconds).toBeLessThan((Date.now() - started) / 1000 - 4.5);
    await expect(page.getByRole("heading", { name: "Teluk sudah pulih!" })).toBeVisible();
    expect(await stats(page)).toEqual([
      ["Sampah terangkat", "50/60"],
      ["Satwa diselamatkan", "2/2"],
      ["Rangka koral ditanami", "3/3"],
      ["Petak lamun ditanami", "2/2"],
      ["Waktu bermain", asPlayTime(seconds)],
      ["Skor", String(score)],
    ]);
    expect(score).toBeGreaterThan(0);

    // AC-5: explore on in the restored bay; the clock stays stopped and the end screen does not come back.
    await page.getByRole("button", { name: "Lanjut menjelajah" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(endScreen(page)).toHaveCount(0);
    await page.mouse.move(0, 0);
    const from = await reef(page, (h) => h.rovPosition());
    await page.keyboard.down("KeyW");
    await playFor(page, 4);
    await page.keyboard.up("KeyW");
    const to = await reef(page, (h) => h.rovPosition());
    expect(Math.hypot(to[0] - from[0], to[2] - from[2])).toBeGreaterThan(2);
    expect(await reef(page, (h) => h.bloom().state)).toBe("done");
    expect(await playSeconds(page)).toBe(seconds);
    await expect(endScreen(page)).toHaveCount(0);

    // AC-6: a refresh goes back to the title and the dive is gone.
    await page.reload();
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
    expect(await mode(page)).toBe("title");
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    expect(await reef(page, (h) => h.unlocked())).toEqual([]);
    expect(await reef(page, (h) => h.trash().length)).toBe(60);
    expect(await reef(page, (h) => h.bloom().state)).toBe("idle");
    await expect(goals(page)).toHaveText(["Bersihkan teluk 0%/80%", "Bebaskan satwa 0/2", "Setor sampah ke stasiun"]);
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the end screen is in English and Play again starts a new murky dive in English (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(300_000);
    await startDive(page);
    await reachBloom(page);
    for (const id of [...FIRST_SIX, "seagrass"]) await reef(page, (h, entry) => h.scanEntry(entry), id);
    await expect(endScreen(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "The bay is healthy again!" })).toBeVisible();
    expect((await stats(page)).map(([label]) => label)).toEqual(["Trash removed", "Animals rescued", "Coral frames planted", "Seagrass patches planted", "Play time", "Score"]);

    await page.getByRole("button", { name: "Play again" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(endScreen(page)).toHaveCount(0);
    expect(await reef(page, (h) => h.unlocked())).toEqual([]);
    expect(await reef(page, (h) => h.trash().length)).toBe(60);
    expect(await reef(page, (h) => h.bloom().state)).toBe("idle");
    await expect.poll(async () => (await reef(page, (h) => h.hud()))?.score).toBe(0);
    expect(await playSeconds(page)).toBeLessThan(5);
    await expect(goals(page)).toHaveText(["Clean the bay 0%/80%", "Free the animals 0/2", "Deposit trash at the station"]);
  });
});
