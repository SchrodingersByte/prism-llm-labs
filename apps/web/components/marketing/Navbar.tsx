"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";
import { NAV_LINKS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 h-[60px] transition-colors duration-200",
        scrolled ? "mk-glass border-b" : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-full max-w-7xl items-center px-5 lg:px-8">
        <Logo href="/" wordmarkClassName="text-[var(--mk-fg)]" className="mr-10" />

        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="mk-nav-link text-sm">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-3 md:flex">
          <Link href="/login" className="mk-nav-link text-sm font-medium">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="mk-btn-primary inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mk-nav-link ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <div className="mk-glass border-t md:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-5 py-4">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="mk-nav-link rounded-lg px-2 py-2.5 text-sm"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2.5">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="mk-btn-ghost inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="mk-btn-primary inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold"
              >
                Get started
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
