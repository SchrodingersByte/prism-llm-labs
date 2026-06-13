import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { createServerClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email || !isPlatformAdmin(user.email)) {
    redirect("/login");
  }

  return <>{children}</>;
}
