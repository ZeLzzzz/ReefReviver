import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
type NetInfo = { id: number; species: string; cut: boolean; center: Vec; yaw: number; size: Vec };
type AnimalInfo = { id: number; species: string; state: string; position: Vec; yaw: number };
type Hook = {
  nets(): NetInfo[];
  animals(): AnimalInfo[];
  clock(): number;
  trash(): Vec[];
  rocks(): [number, number, number, number][];
  rovPosition(): Vec;
  station(): Vec;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
};
const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);

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

/**
 * Puts the ROV `distance` m from a point (on the side given by the horizontal direction `from`, by default toward
 * the bay's centre) and aims so the crosshair ray, which starts 6 m behind and 2 m above the ROV, passes through it.
 */
async function aimThrough(page: Page, target: Vec, distance = 3.5, from: [number, number] | null = null) {
  await reef(
    page,
    (hook, a) => {
      const len = Math.hypot(a.target[0], a.target[2]) || 1;
      const sx = a.from ? a.from[0] : -a.target[0] / len;
      const sz = a.from ? a.from[1] : -a.target[2] / len;
      const px = a.target[0] + sx * a.distance;
      const pz = a.target[2] + sz * a.distance;
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
    { target, distance, from },
  );
}

/** Aims at the top of a net's dome (the species: 0 = turtle, 1 = shark). */
async function aimAtNet(page: Page, id: number) {
  const net = (await reef(page, (h) => h.nets()))[id];
  await aimThrough(page, [net.center[0], net.center[1] + net.size[1] * 0.85, net.center[2]]);
}

const cutProgress = (page: Page) => page.evaluate(() => (window as any).__reef.hud()?.cutProgress as number);
const clock = (page: Page) => page.evaluate(() => (window as any).__reef.clock() as number);

/** Waits until `seconds` of game time have passed (the game runs slowly in software rendering). */
async function gameSeconds(page: Page, seconds: number) {
  const start = await clock(page);
  await expect.poll(() => clock(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(start + seconds);
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("key 1 selects the Cutter and the pause controls list it", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await expect(page.locator(".tool-name")).toHaveText("2 Vacuum");
    await page.keyboard.press("Digit1");
    await expect(page.locator(".tool-name")).toHaveText("1 Cutter");
    await expect(page.locator(".tool-hint")).toHaveText("Tahan klik kiri pada jaring untuk memotongnya");
    await page.keyboard.press("Digit2");
    await expect(page.locator(".tool-name")).toHaveText("2 Vacuum");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Kontrol" }).click();
    const rows = await page.locator(".controls dt").evaluateAll((els) => els.map((el) => `${el.textContent} = ${el.nextElementSibling?.textContent}`));
    expect(rows).toContain("1 = Pilih Cutter");
  });

  test("the nets stand out in the bay with a trapped turtle and shark that struggle in place (AC-6)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    const nets = await reef(page, (h) => h.nets());
    const station = await reef(page, (h) => h.station());
    expect(nets.map((n) => n.species).sort()).toEqual(["reefShark", "turtle"]);
    for (const net of nets) {
      // REQ-011: out in the bay, well away from the station on the shore, in water deeper than 6 m.
      expect(Math.hypot(net.center[0] - station[0], net.center[2] - station[2])).toBeGreaterThan(40);
      expect(net.center[1]).toBeLessThan(-6);
      expect(net.cut).toBe(false);
    }
    const first = await reef(page, (h) => h.animals());
    expect(first.map((a) => a.state)).toEqual(["trapped", "trapped"]);
    await aimAtNet(page, 0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: "test-results/req-003-trapped.png" });
    // They keep moving, but never leave the net.
    let moved = false;
    for (let i = 0; i < 6; i++) {
      await gameSeconds(page, 0.4);
      const now = await reef(page, (h) => h.animals());
      now.forEach((a, k) => {
        const d = Math.hypot(a.position[0] - nets[k].center[0], a.position[2] - nets[k].center[2]);
        expect(d).toBeLessThan(0.6);
        if (a.position.some((v, n) => Math.abs(v - first[k].position[n]) > 0.02)) moved = true;
      });
    }
    expect(moved).toBe(true);
  });

  test("hold left click on the turtle's net: ray and progress show, after 2 s it is cut and the turtle is free (AC-1, AC-2)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await page.keyboard.press("Digit1");
    await aimAtNet(page, 0);
    await expect(page.locator(".cut-progress")).toBeHidden();
    await page.mouse.down();
    await expect(page.locator(".cut-progress")).toBeVisible();
    await expect.poll(() => cutProgress(page), { timeout: 30_000 }).toBeGreaterThan(0.3);
    await expect(page.locator(".cut-label")).toContainText("Memotong jaring");
    await page.screenshot({ path: "test-results/req-003-cutting.png" });
    await expect(page.locator(".message-notice")).toHaveText("Penyu hijau dibebaskan! +100", { timeout: 30_000 });
    await page.mouse.up();
    await expect(stat(page, "score")).toHaveText("100");
    await expect(stat(page, "cleanliness")).toHaveText("1%"); // 1 of 60 trash and 2 nets
    await expect(page.locator('.goal[data-goal="free"] .goal-text')).toHaveText("Bebaskan satwa 1/2");
    await expect(page.locator(".cut-progress")).toBeHidden();
    const [net] = await reef(page, (h) => h.nets());
    expect(net.cut).toBe(true);
    const animals = await reef(page, (h) => h.animals());
    expect(animals[0].state).not.toBe("trapped");
    expect(animals[1].state).toBe("trapped");
    await page.screenshot({ path: "test-results/req-003-freed.png" });
  });

  test("freeing both animals completes the goal, and they keep wandering in the bay (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(150_000);
    await startDive(page);
    await page.keyboard.press("Digit1");
    for (const id of [0, 1]) {
      await aimAtNet(page, id);
      await page.mouse.down();
      await expect.poll(async () => (await reef(page, (h) => h.nets()))[id].cut, { timeout: 40_000 }).toBe(true);
      await page.mouse.up();
    }
    await expect(page.locator('.goal[data-goal="free"]')).toHaveClass(/done/);
    await expect(page.locator('.goal[data-goal="free"] .goal-text')).toHaveText("Bebaskan satwa 2/2");
    await expect(stat(page, "score")).toHaveText("200");
    await expect(stat(page, "cleanliness")).toHaveText("3%"); // 2 of 62
    await expect(page.locator(".message-notice")).toHaveText("Hiu sirip hitam karang dibebaskan! +100");

    // They swim off, then wander for good: always inside the bay, always moving.
    await gameSeconds(page, 5);
    const states = (await reef(page, (h) => h.animals())).map((a) => a.state);
    expect(states).toEqual(["wandering", "wandering"]);
    let before = await reef(page, (h) => h.animals());
    let travelled = 0;
    for (let i = 0; i < 5; i++) {
      await gameSeconds(page, 2);
      const now = await reef(page, (h) => h.animals());
      now.forEach((a, k) => {
        // Inside the bay's water, short of the dive area's edge and the shore (REQ-011: about 300 m across).
        expect(Math.max(Math.abs(a.position[0]), Math.abs(a.position[2]))).toBeLessThan(140);
        expect(a.position[1]).toBeLessThan(0);
        travelled += Math.hypot(a.position[0] - before[k].position[0], a.position[2] - before[k].position[2]);
      });
      before = now;
    }
    expect(travelled).toBeGreaterThan(5);
    await page.screenshot({ path: "test-results/req-003-wandering.png" });
  });

  test("letting go before 2 s empties the progress and the net stays whole (AC-4)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await page.keyboard.press("Digit1");
    await aimAtNet(page, 0);
    await page.mouse.down();
    await expect.poll(() => cutProgress(page), { timeout: 30_000 }).toBeGreaterThan(0.25);
    await page.mouse.up();
    await expect.poll(() => cutProgress(page), { timeout: 30_000 }).toBe(0);
    await expect(page.locator(".cut-progress")).toBeHidden();
    await gameSeconds(page, 3);
    expect((await reef(page, (h) => h.nets()))[0].cut).toBe(false);
    await expect(stat(page, "score")).toHaveText("0");

    // Holding again starts from zero; turning the aim away from the net before 2 s also empties it.
    await page.mouse.down();
    await expect.poll(() => cutProgress(page), { timeout: 30_000 }).toBeGreaterThan(0.25);
    await reef(page, (h) => {
      const [x, y, z] = h.rovPosition();
      h.placeRov(x, y, z, Math.PI, 0);
    });
    await expect.poll(() => cutProgress(page), { timeout: 30_000 }).toBe(0);
    await gameSeconds(page, 3);
    await page.mouse.up();
    expect((await reef(page, (h) => h.nets()))[0].cut).toBe(false);
    expect(await reef(page, (h) => h.animals().map((a) => a.state))).toEqual(["trapped", "trapped"]);
  });

  test("aimed at an animal, trash or a rock, or with the Vacuum selected, the cutter does nothing (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);

    // With the Vacuum selected (the start tool), holding on a net does nothing.
    await aimAtNet(page, 0);
    await page.mouse.down();
    await gameSeconds(page, 3);
    await page.mouse.up();
    expect((await reef(page, (h) => h.nets()))[0].cut).toBe(false);
    await expect(page.locator(".cut-progress")).toBeHidden();

    await page.keyboard.press("Digit1");

    // Trash: the cutter neither sucks it nor does anything else.
    const bottle = (await reef(page, (h) => h.trash()))[0];
    await aimThrough(page, bottle, 3);
    const trashBefore = await reef(page, (h) => h.trash().length);
    await page.mouse.down();
    await gameSeconds(page, 3);
    expect(await cutProgress(page)).toBe(0);
    await page.mouse.up();
    expect(await reef(page, (h) => h.trash().length)).toBe(trashBefore);
    await expect(stat(page, "tank")).toHaveText("0/12");

    // A rock.
    await reef(page, (h) => {
      const [x, y, z, size] = h.rocks()[0];
      const len = Math.hypot(x, z) || 1;
      const px = x - (x / len) * (size + 3);
      const pz = z - (z / len) * (size + 3);
      h.placeRov(px, y + 0.5, pz, Math.atan2(x - px, z - pz), 0);
    });
    await page.mouse.down();
    await gameSeconds(page, 3);
    expect(await cutProgress(page)).toBe(0);
    await page.mouse.up();

    // Nothing was cut, nobody was freed or hurt, and no points were given.
    expect((await reef(page, (h) => h.nets())).every((n) => !n.cut)).toBe(true);
    expect((await reef(page, (h) => h.animals())).map((a) => a.state)).toEqual(["trapped", "trapped"]);
    await expect(stat(page, "score")).toHaveText("0");

    // A free animal: the crosshair on it does nothing, and it is not hurt or caught (it keeps swimming).
    await aimAtNet(page, 0);
    await page.mouse.down();
    await expect(page.locator(".message-notice")).toHaveText("Penyu hijau dibebaskan! +100", { timeout: 40_000 });
    await page.mouse.up();
    await gameSeconds(page, 4);
    for (let i = 0; i < 4; i++) {
      const [turtle] = await reef(page, (h) => h.animals());
      await aimThrough(page, turtle.position, 4, [1, 0]);
      await page.mouse.down();
      await gameSeconds(page, 0.8);
      expect(await cutProgress(page)).toBe(0);
      await page.mouse.up();
    }
    expect((await reef(page, (h) => h.nets())).map((n) => n.cut)).toEqual([true, false]);
    expect((await reef(page, (h) => h.animals())).map((a) => a.state)).toEqual(["wandering", "trapped"]);
    await expect(stat(page, "score")).toHaveText("100");
    await expect(stat(page, "tank")).toHaveText("0/12");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the Cutter, its progress and the notices are in English (G-004)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await page.keyboard.press("Digit1");
    await expect(page.locator(".tool-name")).toHaveText("1 Cutter");
    await expect(page.locator(".tool-hint")).toHaveText("Hold left click on a net to cut it");
    await aimAtNet(page, 0);
    await page.mouse.down();
    await expect(page.locator(".cut-label")).toContainText("Cutting the net");
    await expect(page.locator(".message-notice")).toHaveText("Green turtle freed! +100", { timeout: 40_000 });
    await page.mouse.up();
    await expect(page.locator('.goal[data-goal="free"] .goal-text')).toHaveText("Free the animals 1/2");
    await page.screenshot({ path: "test-results/req-003-english.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Controls" }).click();
    const rows = await page.locator(".controls dt").evaluateAll((els) => els.map((el) => `${el.textContent} = ${el.nextElementSibling?.textContent}`));
    expect(rows).toContain("1 = Select Cutter");
  });
});
