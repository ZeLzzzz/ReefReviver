import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

type Vec = [number, number, number];
type Site = { x: number; y: number; z: number };
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** Where this dive put things: the reef sites, the seagrass patches, the nets and the trash. */
async function layoutOf(page: Page) {
  const sites = await reef(page, (h) => h.reefSites());
  const nets = await reef(page, (h) => h.nets());
  const trash = await reef(page, (h) => h.trash());
  return {
    frames: (sites.frames as Site[]).map((s) => `${s.x},${s.z}`),
    patches: (sites.patches as Site[]).map((s) => `${s.x},${s.z}`),
    nets: (nets as { center: Vec }[]).map((n) => `${n.center[0]},${n.center[2]}`),
    trash: (trash as Vec[]).map((t) => `${t[0].toFixed(2)},${t[2].toFixed(2)}`),
  };
}

const spotKeys = (spots: readonly { x: number; z: number }[]) => new Set(spots.map((s) => `${s.x},${s.z}`));
/** The minimap is 200 units for 300 metres, centred on the bay (REQ-011). */
const mapTransform = (x: number, z: number) => `translate(${(((x + 150) * 200) / 300).toFixed(1)} ${(((z + 150) * 200) / 300).toFixed(1)})`;

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("a dive picks 2 nets, 3 reef sites and 2 seagrass patches from the candidate spots, and 60 trash; a new dive moves them, but not the shed or the start (AC-1, AC-2)", async ({ page }) => {
    await startDive(page);
    const first = await layoutOf(page);
    const frameSpots = spotKeys(config.reef.frameSpots);
    const patchSpots = spotKeys(config.reef.patchSpots);
    const netSpots = spotKeys(config.nets.spots);
    expect(first.frames).toHaveLength(3);
    expect(first.patches).toHaveLength(2);
    expect(first.nets).toHaveLength(2);
    expect(first.trash).toHaveLength(60);
    for (const f of first.frames) expect(frameSpots.has(f)).toBe(true);
    for (const p of first.patches) expect(patchSpots.has(p)).toBe(true);
    for (const n of first.nets) expect(netSpots.has(n)).toBe(true);
    const shed = await reef(page, (h) => h.station());

    await reef(page, (h) => h.newDive());
    const second = await layoutOf(page);
    expect(second.trash).toHaveLength(60);
    expect([...second.frames, ...second.patches, ...second.nets]).not.toEqual([...first.frames, ...first.patches, ...first.nets]);
    expect(second.trash).not.toEqual(first.trash);
    expect(await reef(page, (h) => h.station())).toEqual(shed);
    const [x, , z] = await reef(page, (h) => h.rovPosition());
    expect([x, z]).toEqual([config.rov.start.x, config.rov.start.z]);
  });

  test("the minimap's marks and the site markers follow the new layout, and after the Bloom the clownfish live by the new frames (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await reef(page, (h) => h.newDive());
    const sites = await reef(page, (h) => h.reefSites());
    const frames = page.locator('.hud-minimap [data-kind="frame"]');
    const patches = page.locator('.hud-minimap [data-kind="patch"]');
    for (const [i, s] of (sites.frames as Site[]).entries()) await expect(frames.nth(i)).toHaveAttribute("transform", mapTransform(s.x, s.z));
    for (const [i, s] of (sites.patches as Site[]).entries()) await expect(patches.nth(i)).toHaveAttribute("transform", mapTransform(s.x, s.z));
    const nets = (await reef(page, (h) => h.nets())) as { center: Vec }[];
    const marks = page.locator('.hud-minimap [data-kind="net"]');
    for (const [i, n] of nets.entries()) await expect(marks.nth(i)).toHaveAttribute("transform", mapTransform(n.center[0], n.center[2]));

    await reef(page, (h) => {
      h.removeTrash(50);
      h.plantAll();
    });
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
    const life = await reef(page, (h) => h.seaLife());
    (life.anemones as Site[]).forEach((anemone, i) => {
      const frame = (sites.frames as Site[])[i];
      expect(Math.hypot(anemone.x - frame.x, anemone.z - frame.z)).toBeLessThan(config.reef.interactRadius);
    });
  });
});
