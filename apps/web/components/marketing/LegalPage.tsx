export interface LegalSection { heading: string; body: string[] }

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-20 lg:px-8">
      <p className="mk-eyebrow">Legal</p>
      <h1 className="mt-3 font-playfair text-4xl font-semibold tracking-tight text-[var(--mk-fg)]">
        {title}
      </h1>
      <p className="mt-2 text-xs text-[var(--mk-faint)]">Last updated {updated}</p>
      <p className="mt-6 text-sm leading-relaxed text-[var(--mk-muted)]">{intro}</p>

      <div className="mt-10 space-y-10">
        {sections.map((s, i) => (
          <section key={s.heading} className="scroll-mt-24">
            <h2 className="font-playfair text-xl font-semibold text-[var(--mk-fg)]">
              {i + 1}. {s.heading}
            </h2>
            {s.body.map((p, j) => (
              <p key={j} className="mt-3 text-sm leading-relaxed text-[var(--mk-muted)]">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
