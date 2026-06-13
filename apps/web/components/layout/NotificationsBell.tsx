"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Phase 0 placeholder. The full notifications system (data from /api/notifications,
 * read tracking, real-time) is built in Phase 6 — this ships the drawer shell + a
 * proper empty state so the topbar affordance is real, not dead.
 */
export function NotificationsBell() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications">
          <Bell className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full p-0 sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <Bell className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
