import { Navbar } from "@/components/marketing/Navbar";
import { Footer } from "@/components/marketing/Footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing marketing-bg min-h-screen antialiased">
      <Navbar />
      <main className="pt-[60px]">{children}</main>
      <Footer />
    </div>
  );
}
