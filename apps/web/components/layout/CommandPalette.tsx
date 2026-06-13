"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sun, Moon, Search } from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useTheme } from "@/components/theme-provider";
import { ORG_NAV, canSee, type NavRole } from "@/lib/nav";

/** Self-contained: renders the search trigger AND the ⌘K dialog. Drop into the topbar. */
export function CommandPalette({ role }: { role: NavRole }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const navItems = ORG_NAV.filter((n) => canSee(role, n));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-[200px] items-center gap-2 rounded-md border border-border bg-transparent px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search…</span>
        <span className="flex items-center gap-0.5">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search or jump to…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {navItems.map((n) => (
              <CommandItem key={n.href} value={n.label} onSelect={() => run(() => router.push(n.href))}>
                <n.icon className="h-4 w-4" />
                {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Theme">
            <CommandItem value="light theme" onSelect={() => run(() => setTheme("light"))}>
              <Sun className="h-4 w-4" />
              Light theme
            </CommandItem>
            <CommandItem value="dark theme" onSelect={() => run(() => setTheme("dark"))}>
              <Moon className="h-4 w-4" />
              Dark theme
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
