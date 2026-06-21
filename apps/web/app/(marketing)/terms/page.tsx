import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — Prism",
  description: "The terms that govern your use of Prism.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Agreement to terms",
    body: [
      "By accessing or using Prism, you agree to be bound by these Terms of Service. If you are using Prism on behalf of an organization, you represent that you have authority to bind that organization.",
    ],
  },
  {
    heading: "Accounts",
    body: [
      "You are responsible for safeguarding your account credentials and API keys, and for all activity that occurs under your account. Notify us promptly of any unauthorized use.",
    ],
  },
  {
    heading: "Plans, billing, and events",
    body: [
      "Prism is metered on the telemetry events you ingest each month, not per seat. Each plan includes an event quota and a member cap. Paid plans bill predictable overage beyond quota; the Free plan stops ingestion at quota.",
      "Fees are billed in advance on a monthly basis and are non-refundable except as required by law. You authorize us to charge your payment method for all applicable fees.",
    ],
  },
  {
    heading: "Trials",
    body: [
      "Paid plans may include a trial period. Unless you cancel before the trial ends, your plan will convert to a paid subscription at the listed price.",
    ],
  },
  {
    heading: "Acceptable use",
    body: [
      "You agree not to misuse the service: no unlawful activity, no attempts to disrupt or reverse-engineer the platform, no circumventing usage limits, and no use that infringes the rights of others.",
    ],
  },
  {
    heading: "Customer data and ownership",
    body: [
      "You retain all rights to the data you submit to Prism. You grant us a limited license to process that data solely to provide and improve the service as described in our Privacy Policy.",
      "We do not use your prompts, completions, or telemetry to train models.",
    ],
  },
  {
    heading: "Third-party providers",
    body: [
      "Prism connects to third-party LLM and infrastructure providers using credentials you supply. Your use of those providers is governed by their respective terms, and you are responsible for the costs they charge.",
    ],
  },
  {
    heading: "Service availability",
    body: [
      "We strive for high availability but do not guarantee uninterrupted service except where a written service-level agreement applies (Enterprise). We may modify or discontinue features with reasonable notice.",
    ],
  },
  {
    heading: "Intellectual property",
    body: [
      "Prism, including its software, design, and documentation, is owned by Prism Labs and protected by intellectual-property laws. These Terms grant you no rights to our trademarks or branding.",
    ],
  },
  {
    heading: "Disclaimers",
    body: [
      "The service is provided “as is” without warranties of any kind, whether express or implied, including merchantability, fitness for a particular purpose, and non-infringement, to the maximum extent permitted by law.",
    ],
  },
  {
    heading: "Limitation of liability",
    body: [
      "To the maximum extent permitted by law, Prism Labs will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for lost profits or revenues. Our aggregate liability is limited to the amounts you paid in the twelve months preceding the claim.",
    ],
  },
  {
    heading: "Indemnification",
    body: [
      "You agree to indemnify and hold Prism Labs harmless from claims arising out of your data, your use of the service, or your violation of these Terms.",
    ],
  },
  {
    heading: "Termination",
    body: [
      "You may cancel at any time. We may suspend or terminate access for violation of these Terms or non-payment. Upon termination, your right to use the service ceases and we may delete your data after a reasonable period.",
    ],
  },
  {
    heading: "Governing law and changes",
    body: [
      "These Terms are governed by the laws of the jurisdiction in which Prism Labs is established, without regard to conflict-of-laws rules. We may update these Terms; material changes will be communicated and the effective date above revised. Continued use constitutes acceptance.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="June 21, 2026"
      intro="These Terms govern your access to and use of Prism. Please read them carefully — they include important provisions about billing, data, and liability."
      sections={SECTIONS}
    />
  );
}
