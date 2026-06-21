import type { Metadata } from "next";
import Link from "next/link";
import { DocsNav, type DocSection } from "@/components/marketing/DocsNav";
import { CodeBlock } from "@/components/marketing/CodeBlock";
import { PROVIDERS } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "Documentation — Prism",
  description:
    "Install the Prism SDK, capture LLM telemetry, route through the gateway, enforce budgets, and track MCP tool costs. TypeScript, Python, and cURL examples.",
};

const SECTIONS: DocSection[] = [
  { id: "getting-started", label: "Getting started" },
  { id: "install", label: "Install" },
  { id: "quickstart", label: "Quickstart" },
  { id: "env", label: "Environment variables" },
  { id: "telemetry", label: "Telemetry paths" },
  { id: "gateway", label: "Gateway mode" },
  { id: "budgets", label: "Budgets & caps" },
  { id: "mcp", label: "MCP & tools" },
  { id: "providers", label: "Providers & models" },
  { id: "packages", label: "Packages" },
];

const ENV_VARS: { name: string; effect: string }[] = [
  { name: "PRISM_API_KEY", effect: "Required. Authenticates the SDK." },
  { name: "PRISM_GATEWAY_URL", effect: "Auto-enables gateway mode (e.g. https://useprism.dev)." },
  { name: "PRISM_COST_CENTER", effect: "GL code stamped as tags['cost_center'] on all events." },
  { name: "PRISM_SERVICE_NAME", effect: "Service name for Shadow IT detection." },
  { name: "PRISM_PROJECT", effect: "Project attribution tag." },
  { name: "PRISM_ENVIRONMENT", effect: "production | staging | development." },
];

// ── tiny prose helpers (scoped to docs) ───────────────────────────────────────
function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 font-playfair text-2xl font-semibold text-[var(--mk-fg)]">
      {children}
    </h2>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-[var(--mk-muted)]">{children}</p>;
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[13px] text-[var(--mk-fg)]">{children}</code>
  );
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 pb-24 pt-20 lg:px-8">
      <header className="max-w-2xl">
        <p className="mk-eyebrow">Documentation</p>
        <h1 className="mt-3 font-playfair text-4xl font-semibold tracking-tight text-[var(--mk-fg)]">
          Ship telemetry in minutes
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[var(--mk-muted)]">
          Add the Prism SDK, set one environment variable, and swap a single import. Everything
          below works in both direct (SDK) and gateway modes.
        </p>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[220px_1fr]">
        {/* Sticky nav */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <DocsNav sections={SECTIONS} />
          </div>
        </aside>

        {/* Content */}
        <div className="min-w-0 max-w-3xl space-y-16">
          <section>
            <H2 id="getting-started">Getting started</H2>
            <P>
              Prism captures every LLM and tool call your application makes, then turns it into
              cost, usage, and governance analytics. There are three steps: install the SDK,
              authenticate with <Code>PRISM_API_KEY</Code>, and swap your provider import.
            </P>
            <P>
              You can run in <strong className="text-[var(--mk-fg)]">SDK mode</strong> (telemetry
              ships directly; provider traffic never touches Prism) or{" "}
              <strong className="text-[var(--mk-fg)]">gateway mode</strong> (calls are proxied and
              governed inline). The same code works for both — gateway mode is enabled just by
              setting <Code>PRISM_GATEWAY_URL</Code>.
            </P>
          </section>

          <section>
            <H2 id="install">Install</H2>
            <P>Install the SDK for your language:</P>
            <div className="mt-4 space-y-4">
              <CodeBlock label="TypeScript · npm" code={`npm install @prism-llm-labs/sdk`} />
              <CodeBlock label="Python · pip" code={`pip install prism-llm-labs`} />
            </div>
            <P>
              Then point the SDK at your workspace. Grab a key from{" "}
              <Code>Settings → Access → API Keys</Code>:
            </P>
            <div className="mt-4">
              <CodeBlock
                label="shell"
                code={`export PRISM_API_KEY="prism_sk_..."
# optional: route through the gateway for inline policy
export PRISM_GATEWAY_URL="https://useprism.dev"`}
              />
            </div>
          </section>

          <section>
            <H2 id="quickstart">Quickstart</H2>
            <P>
              Swap one import — your existing call sites stay exactly the same. Prism wraps the
              official client, so every method behaves identically.
            </P>
            <div className="mt-4 space-y-4">
              <CodeBlock
                label="TypeScript"
                code={`// Before:  import OpenAI from "openai";
import { OpenAI } from "@prism-llm-labs/sdk";

const openai = new OpenAI();

const res = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello, Prism!" }],
});`}
              />
              <CodeBlock
                label="Python"
                code={`# Before:  from openai import OpenAI
from prism import OpenAI

client = OpenAI()

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello, Prism!"}],
)`}
              />
              <CodeBlock
                label="cURL · gateway"
                code={`curl https://useprism.dev/api/gateway/openai/v1/chat/completions \\
  -H "Authorization: Bearer $PRISM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'`}
              />
            </div>
            <P>Your first events appear on the dashboard in real time.</P>
          </section>

          <section>
            <H2 id="env">Environment variables</H2>
            <P>The SDK is configured entirely through the environment:</P>
            <div className="mt-4 overflow-x-auto rounded-xl border mk-hairline">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b mk-hairline">
                    <th className="px-4 py-3 text-left font-medium text-[var(--mk-muted)]">Variable</th>
                    <th className="px-4 py-3 text-left font-medium text-[var(--mk-muted)]">Effect</th>
                  </tr>
                </thead>
                <tbody>
                  {ENV_VARS.map((v) => (
                    <tr key={v.name} className="border-b mk-hairline last:border-0">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Code>{v.name}</Code>
                      </td>
                      <td className="px-4 py-3 text-[var(--mk-muted)]">{v.effect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <H2 id="telemetry">Telemetry paths</H2>
            <P>
              <strong className="text-[var(--mk-fg)]">SDK mode (default).</strong> The SDK wraps the
              client in-process, checks your budget, captures the response, and ships telemetry
              directly. Your provider traffic never routes through Prism.
            </P>
            <P>
              <strong className="text-[var(--mk-fg)]">Gateway mode.</strong> Set{" "}
              <Code>PRISM_GATEWAY_URL</Code> and all calls route through the Prism gateway, which
              authenticates your key, enforces policy, proxies to the upstream provider, and records
              the event. No <Code>mode</Code> flag needed — it&apos;s auto-detected.
            </P>
          </section>

          <section>
            <H2 id="gateway">Gateway mode</H2>
            <P>
              The gateway exposes one OpenAI-compatible endpoint per provider at{" "}
              <Code>/api/gateway/&lt;provider&gt;</Code>. It applies rate limits, key-level spend
              caps, model governance, data-residency policy, fallback chains, and content
              guardrails — all before the call reaches the provider.
            </P>
            <div className="mt-4">
              <CodeBlock
                label="TypeScript · gateway"
                code={`// Just set the env var — no code change.
process.env.PRISM_GATEWAY_URL = "https://useprism.dev";

import { OpenAI } from "@prism-llm-labs/sdk";
const openai = new OpenAI(); // now routed + governed`}
              />
            </div>
          </section>

          <section>
            <H2 id="budgets">Budgets & caps</H2>
            <P>
              Set monthly budgets per org or project, and multi-period spend caps per key (daily /
              weekly / monthly, rolling or calendar). Free plans hard-stop ingestion at quota; paid
              plans bill predictable overage so you&apos;re never cut off mid-request.
            </P>
            <P>
              Caps are evaluated on every request in gateway mode, and checked against Upstash Redis
              in SDK mode for low-latency enforcement.
            </P>
          </section>

          <section>
            <H2 id="mcp">MCP & tool tracking</H2>
            <P>
              Wrap your MCP tool calls to tie them to LLM sessions and attribute downstream
              infrastructure (vector DBs, etc.) via <Code>downstream_resource</Code>:
            </P>
            <div className="mt-4 space-y-4">
              <CodeBlock
                label="TypeScript"
                code={`await prismMcp.wrapToolCall("search", async (ctx) => {
  ctx.setDownstreamResource("pinecone:product-index");
  return pinecone.query(/* ... */);
});`}
              />
              <CodeBlock
                label="Python"
                code={`async with prism_mcp.wrap_tool("search", downstream_resource="qdrant:docs") as ctx:
    ...`}
              />
            </div>
            <P>
              These calls show up in session traces, the tool breakdown, agent loop detection, and
              the unified infrastructure cost view.
            </P>
          </section>

          <section>
            <H2 id="providers">Providers & models</H2>
            <P>
              Prism supports every major provider through a single API, plus local and self-hosted
              models via Ollama and any OpenAI-compatible endpoint:
            </P>
            <div className="mt-4 flex flex-wrap gap-2">
              {PROVIDERS.map((p) => (
                <span key={p} className="mk-chip px-3 py-1.5 text-[var(--mk-muted)]">
                  {p}
                </span>
              ))}
            </div>
          </section>

          <section>
            <H2 id="packages">Packages</H2>
            <P>The Prism ecosystem ships a few focused packages:</P>
            <ul className="mt-4 space-y-3 text-sm text-[var(--mk-muted)]">
              <li><Code>@prism-llm-labs/sdk</Code> — TypeScript drop-in client (also PrismAnthropic, PrismGoogleGenerativeAI).</li>
              <li><Code>prism-llm-labs</Code> — Python drop-in client.</li>
              <li><Code>mcp-sdk</Code> — MCP server wrapper with <Code>downstream_resource</Code> support.</li>
              <li><Code>enforce</Code> — import interceptor that detects SDK bypasses (Shadow IT).</li>
              <li><Code>mcp-proxy</Code> — zero-code MCP proxy CLI.</li>
              <li><Code>aws-helpers</Code> — <Code>withPrismCost()</Code> and <Code>withPrismTags()</Code> HOFs.</li>
            </ul>
            <P>
              Ready to go deeper? Head to your{" "}
              <Link href="/signup" className="mk-link">workspace</Link> or{" "}
              <Link href="/contact" className="mk-link">talk to us</Link>.
            </P>
          </section>
        </div>
      </div>
    </div>
  );
}
