import { Users2 } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="Customers"
      description="Customer P&L — cost-to-serve, revenue, gross margin %, and at-risk flags."
      icon={Users2}
      phase="Stage S5"
    />
  );
}
