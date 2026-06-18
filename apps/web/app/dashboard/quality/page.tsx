import { ShieldCheck } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      hideHeader
      title="Quality overview"
      icon={ShieldCheck}
      note="Quality scores land here"
      description="Score trend, pass-rate & avg-score KPIs, by-model and by-scorer breakdowns."
      phase="Stage S4"
    />
  );
}
