"use client";

import { useState } from "react";
import { Check } from "lucide-react";

const CONTACT_EMAIL = "hello@useprism.dev";

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`Prism inquiry — ${name || email}`);
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\nCompany: ${company}\n\n${message}`
    );
    // Open the user's mail client with everything pre-filled (no backend needed).
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mk-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#34d399]/15">
          <Check className="h-6 w-6 text-[var(--mk-emerald)]" />
        </div>
        <h3 className="font-playfair text-xl font-semibold text-[var(--mk-fg)]">Thanks — almost there</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--mk-muted)]">
          Your email draft should have opened. If it didn&apos;t, reach us directly at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="mk-link">{CONTACT_EMAIL}</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mk-card space-y-4 p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--mk-muted)]">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mk-input w-full px-3 py-2.5 text-sm"
            placeholder="Ada Lovelace"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--mk-muted)]">Work email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mk-input w-full px-3 py-2.5 text-sm"
            placeholder="you@company.com"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--mk-muted)]">Company</label>
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="mk-input w-full px-3 py-2.5 text-sm"
          placeholder="Acme Inc. (optional)"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--mk-muted)]">How can we help?</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          rows={5}
          className="mk-input w-full resize-y px-3 py-2.5 text-sm"
          placeholder="Tell us about your stack and what you're trying to track…"
        />
      </div>

      <button
        type="submit"
        className="mk-btn-primary inline-flex w-full items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold"
      >
        Send message
      </button>
    </form>
  );
}
