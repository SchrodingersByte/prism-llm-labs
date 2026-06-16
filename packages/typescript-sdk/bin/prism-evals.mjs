#!/usr/bin/env node
/**
 * CLI wrapper for the Prism offline-eval gate (PRD-2).
 * Reads a JSON config and exits non-zero on a failing gate / regression.
 *
 *   npx prism-evals ./prism.eval.json
 *   PRISM_EVAL_CONFIG=./prism.eval.json npx prism-evals
 */
import { runEvalCli } from "../dist/index.mjs";

runEvalCli().catch((e) => {
  console.error(`[prism-evals] fatal: ${e?.message ?? e}`);
  process.exit(2);
});
