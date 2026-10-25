import { expect, test, type Page } from "@playwright/test";

// The smallest valid GLB: a header and one JSON chunk describing an empty scene.
function minimalGlb(): Buffer {
  let json = JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 });
  while (json.length % 4) json += " ";
  const body = Buffer.from(json);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + body.length, 8);
  header.writeUInt32LE(body.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, body]);
}

const manifest = (...names: string[]) => ({ files: names.map((name) => ({ id: name, url: `${name}.glb` })) });

/** Serves a test manifest; each model waits at its gate until the test opens it, so progress can be looked at. */
async function serveModels(page: Page, names: string[]) {
  const gates = new Map<string, () => void>();
  await page.route("**/assets/manifest.json", (route) => route.fulfill({ json: manifest(...names) }));
  for (const name of names) {
    const open = new Promise<void>((resolve) => gates.set(name, resolve));
    await page.route(`**/assets/${name}.glb`, async (route) => {
      await open;
      await route.fulfill({ body: minimalGlb(), contentType: "model/gltf-binary" });
    });
  }
  return { open: (name: string) => gates.get(name)!() };
}

const progress = (page: Page) => page.getByRole("progressbar");

test.describe("Indonesian browser", () => {
  test.use({ locale: "id-ID" });

  test("the loading screen shows the progress, then the title (AC-2)", async ({ page }) => {
    const models = await serveModels(page, ["rov", "net"]);
    await page.goto("/");
    await expect(progress(page)).toBeVisible();
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
    await expect(page.locator(".loading-text")).toHaveText("Memuat game 0%");
    await expect(page.getByRole("button", { name: "Mulai" })).toHaveCount(0);

    models.open("rov");
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "50");
    await expect(page.locator(".loading-text")).toHaveText("Memuat game 50%");
    await expect.poll(async () => (await page.locator(".loading-fill").boundingBox())!.width).toBeGreaterThan(100); // past the bar's transition
    await page.screenshot({ path: "test-results/req-009-loading.png" });

    models.open("net");
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
    await expect(progress(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__reef.mode())).toBe("title");
  });

  test("a file that fails shows a message with a reload button that tries again (AC-3)", async ({ page }) => {
    await page.route("**/assets/manifest.json", (route) => route.fulfill({ json: manifest("rov", "net") }));
    await page.route("**/assets/rov.glb", (route) => route.fulfill({ body: minimalGlb(), contentType: "model/gltf-binary" }));
    await page.route("**/assets/net.glb", (route) => route.fulfill({ status: 404, body: "Not found" }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "File game gagal dimuat" })).toBeVisible();
    await expect(page.getByText("Periksa koneksi internetmu")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mulai" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/req-009-asset-error.png" });

    // The file is back (e.g. the connection recovered): the button reloads the page and the game starts.
    await page.unroute("**/assets/net.glb");
    await page.route("**/assets/net.glb", (route) => route.fulfill({ body: minimalGlb(), contentType: "model/gltf-binary" }));
    await page.getByRole("button", { name: "Muat ulang" }).click();
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
  });

  test("a network error and a broken manifest show the same message (AC-3)", async ({ page }) => {
    await page.route("**/assets/manifest.json", (route) => route.abort("failed"));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "File game gagal dimuat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Muat ulang" })).toBeVisible();

    await page.unroute("**/assets/manifest.json");
    await page.route("**/assets/manifest.json", (route) => route.fulfill({ body: "<html>not json</html>" }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "File game gagal dimuat" })).toBeVisible();
  });

  test("with the shipped, empty manifest the title appears and the manifest is fetched relative to the page (AC-1, AC-2)", async ({ page }) => {
    const manifestRequests: string[] = [];
    page.on("request", (request) => request.url().endsWith("manifest.json") && manifestRequests.push(request.url()));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
    expect(manifestRequests).toHaveLength(1);
    expect(new URL(manifestRequests[0]).pathname).toBe("/assets/manifest.json");
  });

  test("the credits screen opens from the title, shows the team marker and the licences, and goes back (AC-5)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Kredit" }).click();
    await expect(page.getByRole("heading", { name: "Kredit", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tim" })).toBeVisible();
    await expect(page.getByText("Nama anggota tim belum diisi.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Aset pihak ketiga" })).toBeVisible();
    // REQ-026: the one third-party asset is the music (G-005).
    await expect(page.getByText("Underwater Ambient Pad (musik latar)")).toBeVisible();
    await expect(page.getByText("Lisensi: CC0 1.0")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kode pihak ketiga" })).toBeVisible();
    await expect(page.getByText("three.js", { exact: true })).toBeVisible();
    await expect(page.getByText("Lisensi: MIT", { exact: false })).toBeVisible();
    await page.getByText("three.js (MIT)").click();
    await expect(page.getByText("Copyright © 2010-2026 three.js authors")).toBeVisible();
    await page.screenshot({ path: "test-results/req-009-credits.png" });

    await page.getByRole("button", { name: "Kembali" }).click();
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();

    await page.getByRole("button", { name: "Kredit" }).click();
    await expect(page.getByRole("heading", { name: "Kredit", level: 1 })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
    // The game behind the screens was not disturbed: it still starts.
    await expect.poll(() => page.evaluate(() => (window as any).__reef.mode())).toBe("title");
  });
});

test.describe("English browser", () => {
  test.use({ locale: "en-US" });

  test("loading, error and credits are in English (G-004)", async ({ page }) => {
    await page.route("**/assets/manifest.json", (route) => route.fulfill({ status: 500 }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "The game files couldn't load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

    await page.unroute("**/assets/manifest.json");
    await page.reload();
    await page.getByRole("button", { name: "Credits" }).click();
    await expect(page.getByRole("heading", { name: "Third-party code" })).toBeVisible();
    await expect(page.getByText("The team members' names have not been filled in yet.")).toBeVisible();
  });
});
