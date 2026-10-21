import { defineConfig, devices } from "@playwright/test";

// Plays the production build, served from a sub-path like a static host does (REQ-009 AC-1).
// `npm run test:e2e:dist` builds first, so the folder it serves is always the current code.
const port = Number(process.env.DIST_PORT ?? 5222);

export default defineConfig({
  testDir: "tests/e2e-dist",
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 800, height: 450 },
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: {
    command: `npm run build && node scripts/serve-dist.mjs ${port} game`,
    url: `http://localhost:${port}/game/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
