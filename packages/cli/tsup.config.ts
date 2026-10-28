import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Ship a single self-contained binary: @bouncer/core is bundled in.
  noExternal: ["@bouncer/core"],
  banner: { js: "#!/usr/bin/env node" },
});
