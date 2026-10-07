import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/**
 * One definition, two layouts: a real <table> from tablet width up, and stacked labelled cards on a phone,
 * so wide admin data never forces sideways scrolling at 360px.
 */
export function DataTable<T>({ rows, columns, rowKey, caption }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string | number; caption: string }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-sunken text-muted">
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={cn("px-4 py-2.5 font-semibold", c.className)}>{c.header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={rowKey(r)} className="align-top">
                {columns.map((c) => <td key={c.key} className={cn("px-4 py-3", c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="space-y-2 rounded-xl border border-line bg-surface p-4">
            {columns.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-4 text-sm">
                <span className="shrink-0 text-muted">{c.header}</span>
                <span className="min-w-0 text-right">{c.cell(r)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
