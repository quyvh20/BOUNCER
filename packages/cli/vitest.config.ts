import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against core's TypeScript sources so the suite never runs on a stale build.
    alias: { "@bouncer/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
