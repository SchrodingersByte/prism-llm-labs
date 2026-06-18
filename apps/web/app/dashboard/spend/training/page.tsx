import { GraduationCap } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      hideHeader
      title="Training spend"
      icon={GraduationCap}
      note="Training & fine-tune costs land here"
      description="Per-run training and fine-tune costs by provider and type. The full view lives under Operations → Training."
      phase="Stage S3"
    />
  );
}
