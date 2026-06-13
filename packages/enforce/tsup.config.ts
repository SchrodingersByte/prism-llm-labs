import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry:     ["src/index.ts"],
    format:    ["cjs", "esm"],
    dts:       true,
    clean:     true,
    sourcemap: true,
  },
  {
    // register.ts is CJS-only — loaded via node --require, must be CommonJS
    entry:     ["src/register.ts"],
    format:    ["cjs"],
    dts:       true,
    sourcemap: true,
  },
]);
