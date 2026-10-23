import { defineConfig, devices } from "@playwright/test";
import { webglArgs } from "./tests/webgl-args";

const port = Number(process.env.E2E_PORT ?? 5179);

export default defineConfig({
  testDir: "tests/e2e",
  reporter: "list",
  // More browsers at once than this slow every page of the big bay (REQ-011) enough for timing-based tests to fail.
  workers: 4,
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
    // REQ-012: the same layouts every run, so the tests are repeatable; players get a new one every dive.
    env: { VITE_TEST_SEED: "1" },
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
