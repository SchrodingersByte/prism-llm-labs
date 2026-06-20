import { SessionDetail } from "@/components/observability/SessionDetail";

export default function SessionDetailPage({ params }: { params: { id: string } }) {
  return <SessionDetail sessionId={params.id} />;
}
