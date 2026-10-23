import { defineConfig, devices } from "@playwright/test";
import { webglArgs } from "./tests/webgl-args";

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
        // A small window keeps the frame rate usable when rendering in software (E2E_SWIFTSHADER).
        viewport: { width: 800, height: 450 },
        launchOptions: { args: webglArgs },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
