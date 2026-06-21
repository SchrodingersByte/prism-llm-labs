import { HOW_IT_WORKS, type HowItWorksStep } from "@/lib/marketing/content";

export function StepFlow({ steps = HOW_IT_WORKS }: { steps?: HowItWorksStep[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {steps.map((s, i) => (
        <div key={s.step} className="mk-card relative p-6">
          <div className="flex items-center gap-3">
            <span className="font-playfair text-3xl font-semibold mk-grad-text">{s.step}</span>
            {i < steps.length - 1 && (
              <span className="hidden h-px flex-1 bg-gradient-to-r from-[#a78bfa]/50 to-transparent md:block" />
            )}
          </div>
          <h3 className="mt-4 text-lg font-semibold text-[var(--mk-fg)]">{s.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[var(--mk-muted)]">{s.body}</p>
        </div>
      ))}
    </div>
  );
}
