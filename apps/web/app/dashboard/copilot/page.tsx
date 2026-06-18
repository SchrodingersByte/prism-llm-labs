import { Bot } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="Copilot"
      description="Natural-language chat over your data, with provenance, investigation/RCA, and explain-this."
      icon={Bot}
      phase="Stage S5"
    />
  );
}
