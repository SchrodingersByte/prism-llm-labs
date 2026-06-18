import { redirect } from "next/navigation";

// Legacy duplicate — the canonical per-model view is /dashboard/models.
export default function Page() {
  redirect("/dashboard/models");
}
