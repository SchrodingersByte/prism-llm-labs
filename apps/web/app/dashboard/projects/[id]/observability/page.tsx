import { redirect } from "next/navigation";

export default function ObservabilityIndex({ params }: { params: { id: string } }) {
  redirect(`/dashboard/projects/${params.id}/observability/logs`);
}
