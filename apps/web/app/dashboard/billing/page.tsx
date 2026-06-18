import { redirect } from "next/navigation";

// Canonical billing lives under Settings → Billing.
export default function Page() {
  redirect("/dashboard/settings/billing");
}
