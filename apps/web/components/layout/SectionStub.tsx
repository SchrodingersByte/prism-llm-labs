import { type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { EmptyState } from "@/components/patterns/EmptyState";

/** Placeholder for routes whose real content lands in a later rebuild phase. */
export function SectionStub({
  title,
  description,
  icon,
  note,
  phase,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  note?: string;
  phase?: string;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <div className="p-5">
        <EmptyState
          icon={icon}
          title={note ?? `${title} is coming together`}
          description={phase ? `This view lands in ${phase} of the rebuild.` : "This view lands in a later phase of the rebuild."}
        />
      </div>
    </div>
  );
}
