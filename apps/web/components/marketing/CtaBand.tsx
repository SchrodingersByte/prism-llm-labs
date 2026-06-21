import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function CtaBand({
  title = "Start seeing your LLM spend today.",
  description = "Free forever within quota. Install the SDK, swap one import, and watch your first events land in real time.",
  primary = { label: "Start for free", href: "/signup" },
  secondary = { label: "Talk to us", href: "/contact" },
}: {
  title?: string;
  description?: string;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border mk-hairline px-6 py-14 text-center sm:px-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side,rgba(139,92,246,0.18),transparent_70%)]" />
      <div className="relative mx-auto max-w-2xl">
        <h2 className="font-playfair text-3xl font-semibold tracking-tight text-[var(--mk-fg)] sm:text-4xl">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--mk-muted)]">
          {description}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={primary.href}
            className="mk-btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold"
          >
            {primary.label} <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={secondary.href}
            className="mk-btn-ghost inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold"
          >
            {secondary.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
