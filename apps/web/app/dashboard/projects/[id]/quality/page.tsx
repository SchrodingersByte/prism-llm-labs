import { ShieldCheck } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="Quality"
      description="Quality scores for this project's traffic, drilling into failing traces."
      icon={ShieldCheck}
      phase="Stage S4"
    />
  );
}
