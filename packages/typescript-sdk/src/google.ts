import { GoogleGenerativeAI } from "@google/generative-ai";
import { EventTracker } from "./tracker";
import { BudgetChecker } from "./budget";
import type { PrismOptions } from "./types";

interface PrismGoogleOptions extends PrismOptions {
  apiKey: string;
}

export class PrismGoogleGenerativeAI extends GoogleGenerativeAI {
  private _tracker: EventTracker | null = null;
  private _budget:  BudgetChecker | null = null;
  private _project: string;
  private _team:    string;
  private _env:     string;

  constructor(options: PrismGoogleOptions) {
    const { prismKey, project, team, environment, ingestUrl, apiKey } = options;
    super(apiKey);

    const key     = prismKey ?? process.env["PRISM_API_KEY"];
    this._project = project     ?? process.env["PRISM_PROJECT"]     ?? "";
    this._team    = team        ?? process.env["PRISM_TEAM"]        ?? "";
    this._env     = environment ?? process.env["PRISM_ENVIRONMENT"] ?? "production";

    if (key) {
      this._tracker = new EventTracker(key, ingestUrl);
      this._tracker.capturePayloads = options.capturePayloads ?? "off";
      this._tracker.redact          = options.redact;
      this._budget  = new BudgetChecker(key);
    } else {
      console.warn("[prism] PRISM_API_KEY not set — observability disabled.");
    }
  }

  /** Flush all queued telemetry events immediately. Call before a serverless function returns. */
  async flush(): Promise<void> {
    await this._tracker?.flush();
  }

  /** Wraps getGenerativeModel so every model's generateContent is instrumented. */
  getGenerativeModel(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelParams: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestOptions?: any,
  ) {
    const model   = super.getGenerativeModel(modelParams, requestOptions);
    const tracker = this._tracker;
    const budget  = this._budget;
    const project = this._project;
    const team    = this._team;
    const env     = this._env;
    const modelName: string = modelParams.model ?? "";

    model.generateContent = new Proxy(model.generateContent, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apply: async (target, thisArg, argArray: any[]) => {
        if (budget) await budget.checkOrThrow();

        const start     = Date.now();
        const res       = await Reflect.apply(target, thisArg, argArray);
        const latencyMs = Date.now() - start;

        if (tracker) {
          const meta         = res.response?.usageMetadata ?? {};
          const inputTokens  = meta.promptTokenCount     ?? 0;
          const outputTokens = meta.candidatesTokenCount ?? 0;

          tracker.captureRaw(
            { id: "", model: modelName },
            latencyMs,
            project,
            team,
            env,
            "google",
            inputTokens,
            outputTokens,
            0,
          ).catch(() => {});
        }

        return res;
      },
    });

    return model;
  }
}
