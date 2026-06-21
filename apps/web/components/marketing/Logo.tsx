import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Prism mark — a triangle dispersing a white beam into a violet→gold
 * spectrum. Tone-agnostic: the spectrum reads on both the dark marketing
 * surfaces and the white auth panel, so the same mark is reused everywhere.
 */
export function PrismMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-6 w-6 shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="prism-edge" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c4b5fd" />
          <stop offset="0.55" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#facc15" />
        </linearGradient>
      </defs>
      {/* incoming beam */}
      <path d="M1.5 11.4 H8.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />
      {/* prism body */}
      <path
        d="M12.4 3.2 L20.6 18.4 H4.2 Z"
        stroke="url(#prism-edge)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="rgba(167,139,250,0.10)"
      />
      {/* dispersed spectrum */}
      <path d="M13.6 11 L22.5 7.6" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13.9 12 L22.5 11" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 13 L22.5 14.4" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13.9 14 L22.5 17.8" stroke="#facc15" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface LogoProps {
  /** Wrap in a link to this href. Pass null to render a plain span (e.g. inside another link). */
  href?: string | null;
  withWordmark?: boolean;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}

export function Logo({
  href = "/",
  withWordmark = true,
  className,
  markClassName,
  wordmarkClassName,
}: LogoProps) {
  const inner = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <PrismMark className={markClassName} />
      {withWordmark && (
        <span className={cn("text-[15px] font-semibold tracking-tight", wordmarkClassName)}>
          Prism
        </span>
      )}
    </span>
  );

  if (href === null) return inner;
  return (
    <Link href={href} className="inline-flex items-center" aria-label="Prism home">
      {inner}
    </Link>
  );
}
