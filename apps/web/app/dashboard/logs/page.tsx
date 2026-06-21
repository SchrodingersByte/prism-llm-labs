import { PageHeader } from "@/components/patterns/PageHeader";
import { LogsExplorer } from "@/components/observability/LogsExplorer";

export default function LogsPage() {
  return (
    <div>
      <PageHeader title="Logs" description="Request log explorer — captured for keys with prompt logging enabled." />
      <div className="p-5"><LogsExplorer /></div>
    </div>
  );
}
