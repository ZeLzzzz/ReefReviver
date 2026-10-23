import { expect, type Page } from "@playwright/test";

// Shared by the specs that deposit trash, since REQ-016 the shed's counter on the land: go ashore by the dock,
// walk to the counter, and get back in the submarine.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

/** Brings the submarine a few metres off the beach at z, facing the land, and presses E to go ashore. */
export async function goAshore(page: Page, z = 8) {
  await reef(
    page,
    (h, a) => {
      let x = -100;
      while (!h.ashoreSpot(x, a.z)) x -= 0.5;
      h.placeRov(x - 2, -2, a.z, -Math.PI / 2, 0.1);
    },
    { z },
  );
  await expect.poll(() => reef(page, (h) => h.hud()?.land?.canGoAshore)).toBe(true);
  await page.keyboard.press("KeyE");
  await expect.poll(() => reef(page, (h) => h.onLand() && !h.inTransition())).toBe(true);
}

/** On the land: stands at the shed's counter, facing it, until the HUD says E deposits there. */
export async function standAtCounter(page: Page) {
  await reef(page, (h) => {
    const [x, z] = h.counter();
    h.placeWalker(x + 1, z, -Math.PI / 2, 0);
  });
  await expect.poll(() => reef(page, (h) => h.hud()?.inStationZone)).toBe(true);
}

/** On the land: walks from the beach to the water's edge by the submarine, and gets back in with E. */
export async function boardAgain(page: Page) {
  await reef(page, (h) => {
    const [x, , z] = h.subPosition();
    h.placeWalker(x - 6, z, Math.PI / 2, 0);
  });
  await page.keyboard.down("KeyW");
  await expect.poll(() => reef(page, (h) => h.hud()?.land?.canBoard), { timeout: 10_000 }).toBe(true);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("KeyE");
  await expect.poll(() => reef(page, (h) => !h.onLand() && !h.inTransition())).toBe(true);
}
