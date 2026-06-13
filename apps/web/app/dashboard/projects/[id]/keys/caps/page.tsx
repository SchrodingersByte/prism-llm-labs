import { Gauge } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function ProjectCapsPage() {
  return <SectionStub title="Caps" description="Per-key spend caps (daily / weekly / monthly, rolling or calendar)." icon={Gauge} phase="Phase 4" />;
}
