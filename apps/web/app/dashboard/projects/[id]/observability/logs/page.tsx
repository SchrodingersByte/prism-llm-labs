import { ScrollText } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function ProjectLogsPage() {
  return (
    <SectionStub
      hideHeader
      title="Logs"
      icon={ScrollText}
      note="Project-scoped logs land here"
      description="Per-project request logs + payload viewer. The org-wide explorer is live at Observability → Logs."
      phase="Stage S3"
    />
  );
}
