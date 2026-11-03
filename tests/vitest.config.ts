import path from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = path.resolve(__dirname, "..");

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "apps/web/src"),
    },
  },
  // The web tsconfig keeps JSX for Next ("preserve"); tests that render a
  // component need it compiled.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    // Node 26's host Web Storage shadows jsdom's per-window storage. Browser
    // tests must exercise jsdom storage, including its blocked-access behavior.
    execArgv: ["--no-experimental-webstorage"],
    include: ["tests/unit/**/*.test.ts"],
  },
});
