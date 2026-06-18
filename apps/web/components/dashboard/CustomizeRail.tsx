"use client";

import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, EyeOff, Plus, Sparkles, RotateCcw } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { REGISTRY, getWidget } from "@/components/widgets/registry";
import { TEMPLATES } from "@/lib/dashboard/templates";
import { useRole } from "@/components/layout/role-context";
import { canSee } from "@/lib/nav";
import { cn } from "@/lib/utils";

function SortableRow({ id, onRemove }: { id: string; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const def = getWidget(id);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm", isDragging && "opacity-60")}
    >
      <span className="flex min-w-0 items-center gap-2">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground" aria-label="Drag to reorder">
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="truncate">{def?.title ?? id}</span>
      </span>
      <button onClick={() => onRemove(id)} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${def?.title ?? id}`}>
        <EyeOff className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The self-serve widget palette: reorder/remove on-canvas widgets, add new ones,
 * or seed from a role template. All changes flow through `onChange`/`onReset`
 * (persisted by useDashboardLayout). Role-gated widgets are filtered out here too.
 */
export function CustomizeRail({ ids, onChange, onReset }: {
  ids: string[];
  onChange: (ids: string[]) => void;
  onReset: () => void;
}) {
  const role = useRole();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onCanvas = ids.filter((id) => { const d = getWidget(id); return !!d && canSee(role, d); });
  const available = REGISTRY.filter((w) => canSee(role, w) && !ids.includes(w.id));

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const oldI = ids.indexOf(String(active.id));
    const newI = ids.indexOf(String(over.id));
    if (oldI >= 0 && newI >= 0) onChange(arrayMove(ids, oldI, newI));
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" className="gap-1.5"><Sparkles className="h-4 w-4" />Customize</Button>
      </SheetTrigger>
      <SheetContent className="w-full p-0 sm:max-w-md">
        <SheetHeader><SheetTitle>Customize</SheetTitle></SheetHeader>
        <ScrollArea className="h-[calc(100vh-4rem)]">
          <div className="space-y-6 p-4">
            <section>
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">On your canvas</h4>
              {onCanvas.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing here yet — add widgets below.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={onCanvas} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1.5">
                      {onCanvas.map((id) => <SortableRow key={id} id={id} onRemove={(rid) => onChange(ids.filter((x) => x !== rid))} />)}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Add a widget</h4>
              {available.length === 0 ? (
                <p className="text-xs text-muted-foreground">Everything&apos;s on your canvas.</p>
              ) : (
                <div className="space-y-1.5">
                  {available.map((w) => (
                    <button key={w.id} onClick={() => onChange([...ids, w.id])}
                      className="flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent">
                      <Plus className="h-4 w-4 text-[hsl(var(--positive))]" />
                      <span className="min-w-0 flex-1 truncate">{w.title}</span>
                      {w.description && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{w.description}</span>}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Start from a template</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {TEMPLATES.map((t) => (
                  <button key={t.id} onClick={() => onChange(t.ids)}
                    className="rounded-md border border-border px-2.5 py-2 text-center text-sm transition-colors hover:bg-accent">
                    {t.label}
                  </button>
                ))}
              </div>
            </section>

            <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5 text-muted-foreground">
              <RotateCcw className="h-3.5 w-3.5" />Reset to default
            </Button>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
