import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative paths, so the build runs from any folder of a static host, e.g. itch.io's sub-path (D-053).
  base: "./",
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
  },
});
