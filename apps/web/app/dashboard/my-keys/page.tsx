import { KeyRound } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      title="My keys"
      description="Your personal API keys and the SDK setup snippet."
      icon={KeyRound}
      phase="Stage S2"
    />
  );
}
