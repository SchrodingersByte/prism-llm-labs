import { FileText } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="Prompts"
      description="Prompts used in this project, with versions and which label is in production."
      icon={FileText}
      phase="Stage S4"
    />
  );
}
