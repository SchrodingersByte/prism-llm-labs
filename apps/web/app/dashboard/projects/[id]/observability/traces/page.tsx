import { GitBranch } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function ProjectTracesPage() {
  return <SectionStub title="Traces" description="Distributed trace tree across gateway, cache, and guardrail spans." icon={GitBranch} phase="Phase 4" />;
}
