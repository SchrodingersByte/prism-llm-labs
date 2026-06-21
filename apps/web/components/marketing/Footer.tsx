import Link from "next/link";
import { Github, Linkedin } from "lucide-react";
import { Logo } from "./Logo";
import { FOOTER_COLUMNS } from "@/lib/marketing/content";

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="relative mt-24 border-t mk-hairline">
      <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          {/* Brand */}
          <div className="col-span-2 md:col-span-2">
            <Logo href="/" wordmarkClassName="text-[var(--mk-fg)]" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--mk-muted)]">
              AI FinOps observability. Track, govern, and optimize LLM spend across
              every model, provider, and project.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="GitHub"
                className="mk-nav-link inline-flex h-9 w-9 items-center justify-center rounded-lg border mk-hairline"
              >
                <Github className="h-4 w-4" />
              </a>
              <a
                href="https://x.com"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="X"
                className="mk-nav-link inline-flex h-9 w-9 items-center justify-center rounded-lg border mk-hairline"
              >
                <XIcon />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="LinkedIn"
                className="mk-nav-link inline-flex h-9 w-9 items-center justify-center rounded-lg border mk-hairline"
              >
                <Linkedin className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--mk-faint)]">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label + l.href}>
                    <Link href={l.href} className="mk-nav-link text-sm">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t pt-6 mk-hairline sm:flex-row">
          <p className="text-xs text-[var(--mk-faint)]">
            © {new Date().getFullYear()} Prism Labs. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="mk-nav-link text-xs">Privacy</Link>
            <Link href="/terms" className="mk-nav-link text-xs">Terms</Link>
            <span className="mk-chip px-2.5 py-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--mk-emerald)]" />
              All systems operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
