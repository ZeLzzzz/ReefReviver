import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5179);

export default defineConfig({
  testDir: "tests/e2e",
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Software rendering is slow; a small window keeps the frame rate usable.
        viewport: { width: 800, height: 450 },
        // Headless Chromium has no GPU; SwiftShader renders WebGL 2 in software.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
