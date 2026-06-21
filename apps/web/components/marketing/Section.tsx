import { cn } from "@/lib/utils";
import type { Accent } from "@/lib/marketing/content";

/** Accent → CSS custom property, shared across feature/pricing/showcase surfaces. */
export const ACCENT_VAR: Record<Accent, string> = {
  violet: "var(--mk-violet)",
  sky: "var(--mk-sky)",
  emerald: "var(--mk-emerald)",
  gold: "var(--mk-gold)",
  coral: "var(--mk-coral)",
};

export function Section({
  id,
  className,
  containerClassName,
  children,
}: {
  id?: string;
  className?: string;
  containerClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 py-20 sm:py-28", className)}>
      <div className={cn("mx-auto max-w-7xl px-5 lg:px-8", containerClassName)}>
        {children}
      </div>
    </section>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mk-eyebrow", className)}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left",
        className
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-3 font-playfair text-3xl font-semibold leading-tight tracking-tight text-[var(--mk-fg)] sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-relaxed text-[var(--mk-muted)]">{description}</p>
      )}
    </div>
  );
}
