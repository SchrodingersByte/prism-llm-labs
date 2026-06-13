"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}

export function DataTable<T>({ columns, data, onRowClick, empty }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="hover:bg-transparent">
            {hg.headers.map((header) => {
              const canSort = header.column.getCanSort();
              const sorted = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  className={cn(canSort && "cursor-pointer select-none")}
                  onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {canSort &&
                      (sorted === "asc" ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : sorted === "desc" ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      ))}
                  </span>
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">
              {empty ?? "No data"}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(onRowClick && "cursor-pointer")}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
