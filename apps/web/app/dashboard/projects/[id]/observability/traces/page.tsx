import { GitBranch } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function ProjectTracesPage() {
  return (
    <SectionStub
      hideHeader
      title="Traces"
      icon={GitBranch}
      note="Trace waterfall lands here"
      description="Distributed trace tree across gateway, cache, and guardrail spans — needs the shared trace-waterfall surface."
      phase="Stage S3"
    />
  );
}
