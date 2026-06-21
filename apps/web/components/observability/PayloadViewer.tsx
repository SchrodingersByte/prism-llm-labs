"use client";

import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchContent } from "@/lib/api/traces";

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="dash-scroll max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-secondary p-3 text-xs leading-relaxed">{value}</pre>
    </div>
  );
}

/**
 * Shared payload viewer — captured prompt/completion/context/tool-IO for an event,
 * with redaction + PII badges. Renders a "not captured" note when content is absent
 * or access isn't granted (content capture is off by default per project).
 */
export function PayloadViewer({ eventId, open, onOpenChange }: { eventId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["content", eventId],
    queryFn: ({ signal }) => fetchContent(eventId!, signal),
    enabled: open && !!eventId,
    staleTime: 30_000,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="dash-scroll w-full overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader><SheetTitle>Span payload</SheetTitle></SheetHeader>
        <div className="space-y-4 p-4">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !data ? (
            <p className="text-sm text-muted-foreground">
              No captured payload for this span. Content capture may be off for this project, or this span has no stored payload.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-muted px-2 py-0.5 capitalize">{data.provider} · {data.model}</span>
                {data.redaction_level && <span className="rounded bg-muted px-2 py-0.5">redaction: {data.redaction_level}</span>}
                {data.pii_found && <span className="signal-chip rounded px-2 py-0.5">PII detected</span>}
              </div>
              <Field label="Prompt" value={data.prompt} />
              <Field label="Completion" value={data.completion} />
              <Field label="Retrieved context" value={data.context} />
              <Field label="Tool I/O" value={data.tool_io} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
