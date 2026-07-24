import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

export default defineConfig({
  banner: {
    js: "#!/usr/bin/env node",
  },
  clean: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  entry: ["src/index.ts"],
  format: ["esm"],
  minify: true,
  platform: "node",
  sourcemap: true,
  target: "node18",
});
