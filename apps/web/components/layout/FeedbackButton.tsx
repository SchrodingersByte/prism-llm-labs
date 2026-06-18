"use client";

import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Topbar feedback entry. Stub — the capture flow is built later. */
export function FeedbackButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-muted-foreground"
      onClick={() => toast("Feedback", { description: "Feedback capture is coming soon." })}
    >
      <MessageSquarePlus className="h-4 w-4" />
      <span className="hidden xl:inline">Feedback</span>
    </Button>
  );
}
