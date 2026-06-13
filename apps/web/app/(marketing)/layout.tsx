import Link from "next/link";

const NAV_LINKS = [
  { label: "Home",     href: "/"          },
  { label: "Features", href: "/#features" },
  { label: "Pricing",  href: "/#pricing"  },
  { label: "Docs",     href: "/docs"      },
  { label: "Contact",  href: "/#contact"  },
];

function Navbar() {
  return (
    <header
      className="fixed top-0 inset-x-0 z-50 h-[60px] flex items-center px-6 lg:px-10"
      style={{
        background:           "var(--nav-bg)",
        borderBottom:         "1px solid var(--nav-border)",
        backdropFilter:       "blur(var(--nav-blur))",
        WebkitBackdropFilter: "blur(var(--nav-blur))",
      }}
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 shrink-0 mr-10">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-white text-sm font-black"
          style={{ background: "var(--ink-900)" }}
        >
          P
        </span>
        <span className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ink-900)" }}>
          Prism
        </span>
      </Link>

      {/* Nav links */}
      <nav className="hidden md:flex items-center gap-7 flex-1">
        {NAV_LINKS.map(link => (
          <Link key={link.href} href={link.href} className="nav-link text-sm">
            {link.label}
          </Link>
        ))}
      </nav>

      {/* CTA */}
      <div className="ml-auto flex items-center gap-3">
        <Link href="/login" className="nav-link-muted hidden sm:inline-block text-sm font-medium">
          Sign in
        </Link>
        <Link
          href="/login"
          className="btn-primary inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold"
        >
          Get Started
        </Link>
      </div>
    </header>
  );
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-gradient min-h-screen">
      <Navbar />
      <main className="pt-[60px]">{children}</main>
    </div>
  );
}
