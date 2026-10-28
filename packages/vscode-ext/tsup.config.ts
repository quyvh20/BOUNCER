import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  // VS Code loads extensions as CommonJS; the ESM-only @bouncer/core is bundled and down-converted.
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  target: "node18",
  platform: "node",
  clean: true,
  sourcemap: true,
  noExternal: ["@bouncer/core"],
  external: ["vscode"],
});
