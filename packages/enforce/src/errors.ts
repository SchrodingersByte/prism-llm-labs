export class PrismEnforceError extends Error {
  constructor(moduleName: string) {
    super(
      `[prism-enforce] Blocked import of raw SDK "${moduleName}". ` +
      `Use the Prism wrapper instead:\n` +
      `  import { OpenAI } from "@prism-llm-labs/sdk"         (TypeScript/Node.js)\n` +
      `  from prism import OpenAI                              (Python)\n\n` +
      `To allow untracked imports, set PRISM_ENFORCE_MODE=warn or remove the --require hook.`,
    );
    this.name = "PrismEnforceError";
  }
}
