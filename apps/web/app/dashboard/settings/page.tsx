import { Settings } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function OrgSettingsPage() {
  return (
    <SectionStub
      title="Settings"
      description="Data residency, gateway mode, governance defaults, audit, and compliance."
      icon={Settings}
      phase="Phase 5–6"
    />
  );
}
