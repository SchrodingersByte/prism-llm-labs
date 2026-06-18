import { GraduationCap } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="Training"
      description="Fine-tuning and training run costs, with sync from provider training APIs."
      icon={GraduationCap}
      phase="Stage S3"
    />
  );
}
