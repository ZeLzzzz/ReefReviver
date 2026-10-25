import { expect, test } from "@playwright/test";

// REQ-009 AC-1: the folder `vite build` makes is plain static files. Here it is served from /game/, the way
// itch.io serves a game from a sub-path, and the server answers 404 for everything outside that folder.
test.use({ locale: "id-ID" });

test("the server really only serves the sub-path", async ({ request }) => {
  expect((await request.get("/game/")).status()).toBe(200);
  expect((await request.get("/")).status()).toBe(404);
  expect((await request.get("/assets/manifest.json")).status()).toBe(404);
  expect((await request.get("/game/../package.json")).status()).toBe(404);
});

test("the build starts from a sub-path with relative requests only, and a dive begins (AC-1)", async ({ page }) => {
  const requests: string[] = [];
  const failures: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => response.status() >= 400 && failures.push(`${response.status()} ${response.url()}`));
  page.on("requestfailed", (request) => failures.push(`failed ${request.url()}`));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));

  await page.goto("/game/");
  await expect(page.getByRole("heading", { name: "ReefReviver" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
  await page.screenshot({ path: "test-results/req-009-dist-title.png" });

  // Everything the page asked for is inside /game/, including the manifest the loader fetches.
  expect(requests.every((url) => new URL(url).pathname.startsWith("/game/"))).toBe(true);
  expect(requests.some((url) => url.endsWith("/game/assets/manifest.json"))).toBe(true);

  await page.getByRole("button", { name: "Mulai" }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe("scene");
  // REQ-027: the build for players opens with the cinematic; Space skips it, as a player can.
  await expect(page.locator(".cine-skip")).toBeVisible();
  await page.keyboard.press("Space");
  // REQ-029: the mission card follows the opening; a player closes it with its button.
  await page.getByRole("button", { name: "Mulai menyelam" }).click({ timeout: 10_000 });
  await expect(page.locator(".crosshair")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".stat-tank .stat-value")).toHaveText("0/12");
  await page.screenshot({ path: "test-results/req-009-dist-playing.png" });

  // The test hooks are stripped from the production build.
  expect(await page.evaluate(() => "__reef" in window)).toBe(false);
  expect(requests.every((url) => new URL(url).pathname.startsWith("/game/"))).toBe(true);
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

test("the credits screen is part of the build (AC-5)", async ({ page }) => {
  await page.goto("/game/");
  await page.getByRole("button", { name: "Kredit" }).click();
  await expect(page.getByText("three.js", { exact: true })).toBeVisible();
  await expect(page.getByText("Nama anggota tim belum diisi.")).toBeVisible();
});

test("a model listed in the manifest loads from the sub-path, with the glTF loader chunk (AC-1, AC-2)", async ({ page }) => {
  // The smallest valid GLB: a header and one JSON chunk describing an empty scene.
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 }).padEnd(104));
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.write("JSON", 16, "ascii");
  await page.route("**/game/assets/manifest.json", (route) => route.fulfill({ json: { files: [{ id: "rov", url: "models/rov.glb" }] } }));
  await page.route("**/game/assets/models/rov.glb", (route) => route.fulfill({ body: Buffer.concat([header, json]), contentType: "model/gltf-binary" }));

  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/game/");
  await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
  expect(requests).toContain("/game/assets/models/rov.glb");
  expect(requests.some((path) => /^\/game\/assets\/GLTFLoader-.*\.js$/.test(path))).toBe(true);
});

test("a refresh starts a new dive with the nets and reef sites somewhere else (REQ-012 AC-2)", async ({ page }) => {
  // The production build has no test hooks and no fixed seed: the layout shows in the minimap's marks.
  const marks = async () => {
    await page.goto("/game/");
    await page.getByRole("button", { name: "Mulai" }).click();
    // REQ-027: every refresh opens with the cinematic again; Space skips it.
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe("scene");
    await expect(page.locator(".cine-skip")).toBeVisible();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Mulai menyelam" }).click({ timeout: 10_000 }); // REQ-029
    await expect(page.locator(".hud-minimap")).toBeVisible({ timeout: 10_000 });
    return page.locator('.hud-minimap [data-kind="frame"], .hud-minimap [data-kind="patch"], .hud-minimap [data-kind="net"]').evaluateAll((els) => els.map((el) => el.getAttribute("transform")));
  };
  const first = await marks();
  expect(first).toHaveLength(7);
  // Two random layouts can match by chance (a few in a thousand); a third try makes a false failure very unlikely.
  const others = [await marks(), await marks()];
  expect(others.some((other) => JSON.stringify(other) !== JSON.stringify(first))).toBe(true);
});
