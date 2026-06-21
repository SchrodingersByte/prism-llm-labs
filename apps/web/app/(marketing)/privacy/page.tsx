import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Prism",
  description: "How Prism collects, uses, retains, and protects your data and your customers' telemetry.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Information we collect",
    body: [
      "Account information you provide — name, email, organization, and authentication identifiers from your identity provider when you sign in with GitHub or Google.",
      "Billing information processed by our payment provider. We do not store full card details on our systems.",
      "Product usage and diagnostic data about how you interact with the dashboard, used to operate and improve the service.",
    ],
  },
  {
    heading: "Telemetry and customer data",
    body: [
      "When you instrument your applications, Prism ingests telemetry events describing your LLM and tool calls — model, token counts, cost, latency, and metadata tags you attach.",
      "Prompt and response payload capture is off by default. You may enable metadata-only, redacted, or full-content capture per project, with a retention window you control. Built-in PII detection can mask sensitive content before storage.",
      "In SDK mode, your provider traffic is not routed through Prism. In gateway mode, requests transit our gateway solely to apply your policies and record the event before being proxied to the upstream provider.",
    ],
  },
  {
    heading: "How we use information",
    body: [
      "To provide, secure, and improve the service; to compute the analytics, budgets, and governance features you configure; to communicate with you about your account; and to comply with legal obligations.",
      "We do not sell your data, and we do not use your prompts, completions, or telemetry to train models.",
    ],
  },
  {
    heading: "Data retention",
    body: [
      "Analytics data is retained according to your plan's retention window. Captured payloads honor the per-project TTL you set. You can request deletion of your workspace data at any time.",
    ],
  },
  {
    heading: "Subprocessors and sharing",
    body: [
      "We share data with infrastructure subprocessors strictly to operate the service — including cloud hosting, our analytics pipeline, authentication, and payment processing. Each is bound by data-protection obligations.",
      "We may disclose information if required by law, or to protect the rights, safety, and security of Prism and its users.",
    ],
  },
  {
    heading: "Security",
    body: [
      "We apply encryption in transit and at rest, role-based access control, and least-privilege access to production systems. Provider keys are stored encrypted. No method of transmission or storage is perfectly secure, but we work continuously to protect your data.",
    ],
  },
  {
    heading: "International transfers and residency",
    body: [
      "Data may be processed in regions where we or our subprocessors operate. Gateway data-residency policies let you pin LLM traffic to a chosen region where supported.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal data, and to object to or restrict certain processing. Contact us to exercise these rights.",
    ],
  },
  {
    heading: "Cookies",
    body: [
      "We use strictly necessary cookies for authentication and session management, and limited analytics to understand product usage. You can control non-essential cookies through your browser.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: [
      "We may update this policy from time to time. Material changes will be communicated through the product or by email, and the effective date above will be revised.",
    ],
  },
  {
    heading: "Contact",
    body: [
      "Questions about this policy or your data? Reach us through the contact page and we'll respond promptly.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="June 21, 2026"
      intro="This Privacy Policy explains what information Prism collects, how we use it, and the choices you have. It covers both your account data and the telemetry your applications send to Prism."
      sections={SECTIONS}
    />
  );
}
