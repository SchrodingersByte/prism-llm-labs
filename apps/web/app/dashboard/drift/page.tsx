import { Radar } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="Drift"
      description="Drift trend by segment/metric (PSI/JS/centroid), cluster/topic explorer, and drift alerts."
      icon={Radar}
      phase="Stage S4"
    />
  );
}
