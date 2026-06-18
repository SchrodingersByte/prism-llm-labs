import { Suspense } from "react";
import { ModelsOverview } from "@/components/models/ModelsOverview";

export default function ModelsPage() {
  return (
    <Suspense>
      <ModelsOverview />
    </Suspense>
  );
}
