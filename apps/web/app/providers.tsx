"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

/**
 * Global client providers, mounted once at the root. Order matters:
 * ThemeProvider owns the `.dark` class (read by Sonner), nuqs owns URL state,
 * react-query owns the widget/metrics data layer.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,        // matches the Tinybird edge cache window
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
