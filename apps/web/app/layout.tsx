import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Prism — LLM Cost & Usage Observability",
  description: "Track, analyze, and optimize your LLM spend across every model and project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('prism-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()` }} />
      </head>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
