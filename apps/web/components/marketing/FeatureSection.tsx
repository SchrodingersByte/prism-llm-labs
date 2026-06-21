import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { FEATURES, type FeatureGroup } from "@/lib/marketing/content";
import { ACCENT_VAR } from "./Section";
import { cn } from "@/lib/utils";

export function FeatureCard({ feature }: { feature: FeatureGroup }) {
  const Icon = feature.icon;
  const color = ACCENT_VAR[feature.accent];
  return (
    <div className="mk-card mk-card-hover group flex flex-col p-6">
      <div
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border"
        style={{
          color,
          borderColor: "var(--mk-border)",
          background: "color-mix(in srgb, currentColor 12%, transparent)",
        }}
      >
        <Icon className="h-5 w-5" />
      </div>

      <h3 className="mt-5 text-lg font-semibold text-[var(--mk-fg)]">{feature.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--mk-muted)]">{feature.tagline}</p>

      <ul className="mt-4 space-y-2">
        {feature.bullets.map((b) => (
          <li key={b} className="flex gap-2 text-sm text-[var(--mk-muted)]">
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      {feature.href && (
        <Link
          href={feature.href}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--mk-fg)] transition-colors hover:text-[var(--mk-violet)]"
        >
          Learn more
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

export function FeatureGrid({ features = FEATURES }: { features?: FeatureGroup[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f) => (
        <FeatureCard key={f.id} feature={f} />
      ))}
    </div>
  );
}

/** Wide alternating spotlight — feature copy beside a custom visual. */
export function FeatureSpotlight({
  feature,
  visual,
  flip = false,
}: {
  feature: FeatureGroup;
  visual: React.ReactNode;
  flip?: boolean;
}) {
  const Icon = feature.icon;
  const color = ACCENT_VAR[feature.accent];
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2">
      <div className={cn(flip && "lg:order-2")}>
        <div
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ color, background: "color-mix(in srgb, currentColor 12%, transparent)" }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="mt-5 font-playfair text-2xl font-semibold text-[var(--mk-fg)] sm:text-3xl">
          {feature.title}
        </h3>
        <p className="mt-3 text-base leading-relaxed text-[var(--mk-muted)]">{feature.tagline}</p>
        <ul className="mt-5 space-y-2.5">
          {feature.bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-sm text-[var(--mk-muted)]">
              <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={cn(flip && "lg:order-1")}>{visual}</div>
    </div>
  );
}
