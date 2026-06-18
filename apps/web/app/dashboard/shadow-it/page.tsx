import { Eye } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="Shadow IT"
      description="Unmanaged services, SDK-bypass coverage, and gateway-enforcement trends."
      icon={Eye}
      phase="Stage S3"
    />
  );
}
