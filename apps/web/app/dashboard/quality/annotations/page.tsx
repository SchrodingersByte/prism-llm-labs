import { PenLine } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      hideHeader
      title="Annotations"
      icon={PenLine}
      note="Reviewer queue lands here"
      description="Prioritized annotation queue and the reviewer workspace (score + comment + accept/reject)."
      phase="Stage S4"
    />
  );
}
