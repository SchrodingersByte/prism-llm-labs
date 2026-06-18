import { TriangleAlert } from "lucide-react";
import { SectionStub } from "@/components/layout/SectionStub";

export default function Page() {
  return (
    <SectionStub
      hideHeader
      title="Errors"
      icon={TriangleAlert}
      note="Error clusters land here"
      description="Error clusters by signature/source with occurrences and last-seen, drilling to traces."
      phase="Stage S3/S4"
    />
  );
}
