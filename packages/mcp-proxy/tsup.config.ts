import { defineConfig } from "tsup";

export default defineConfig([
  // Library entry — consumed programmatically
  {
    entry:     ["src/index.ts"],
    format:    ["cjs", "esm"],
    dts:       true,
    clean:     true,
    sourcemap: true,
    external:  ["@modelcontextprotocol/sdk"],
  },
  // CLI entry — executable bin; shebang added via banner
  {
    entry:     { cli: "src/cli.ts" },
    format:    ["cjs"],
    dts:       false,
    clean:     false,
    sourcemap: false,
    external:  ["@modelcontextprotocol/sdk"],
    banner:    { js: "#!/usr/bin/env node" },
  },
]);
