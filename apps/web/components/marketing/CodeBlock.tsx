"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border mk-hairline bg-black/40", className)}>
      <div className="flex items-center justify-between border-b mk-hairline px-4 py-2">
        <span className="text-xs text-[var(--mk-faint)]">{label ?? "shell"}</span>
        <button
          type="button"
          onClick={copy}
          className="mk-nav-link inline-flex items-center gap-1.5 text-xs"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--mk-emerald)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className="font-mono text-[var(--mk-fg)]">{code}</code>
      </pre>
    </div>
  );
}
