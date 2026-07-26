'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PaginationResponse } from '@/types';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  /**
   * Pin this column to the right edge of the scroll container so it stays
   * visible while the rest of the table scrolls horizontally underneath.
   * Use for the trailing "Actions" column on wide admin tables so the
   * Approve/Reject/Suspend/Ban buttons are always reachable.
   */
  sticky?: boolean;
  render: (row: T) => React.ReactNode;
}

/**
 * Opaque backgrounds for pinned cells. They MUST be fully opaque — a
 * semi-transparent sticky cell lets the horizontally-scrolled content bleed
 * through. These values are the effective (flattened) card colors:
 *   - card glass: rgba(13,17,32,0.92) over --background #07080b ≈ #0d111f
 *   - header row: bg-white/[0.03] layered over that ≈ #141826
 */
const STICKY_BODY_BG = 'bg-[#0d111f]';
const STICKY_HEADER_BG = 'bg-[#141826]';
const STICKY_SHADOW = 'shadow-[-8px_0_12px_-8px_rgba(0,0,0,0.6)]';

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  pagination?: PaginationResponse;
  page?: number;
  onPageChange?: (page: number) => void;
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

function SkeletonRows({ columns, count }: { columns: Column<unknown>[]; count: number }) {
  const widths = ['w-24', 'w-32', 'w-20', 'w-16', 'w-28', 'w-36'] as const;

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="border-b border-white/[0.04]">
          {columns.map((col, colIndex) => (
            <td key={col.key} className="px-4 py-3">
              <Skeleton variant="text" className={`h-4 ${widths[colIndex % widths.length] ?? 'w-24'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  pagination,
  page = 1,
  onPageChange,
  loading = false,
  emptyMessage = 'No results found.',
  onRowClick,
}: DataTableProps<T>) {
  return (
    <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.03]">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 ${
                      col.sticky
                        ? `sticky right-0 z-20 border-l border-white/[0.06] ${STICKY_HEADER_BG} ${STICKY_SHADOW}`
                        : ''
                    } ${col.className ?? ''}`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows columns={columns as Column<unknown>[]} count={5} />
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={`border-b border-white/[0.04] transition-colors hover:bg-white/[0.04] ${onRowClick ? 'cursor-pointer' : ''}`}
                    onClick={
                      onRowClick
                        ? () => {
                            onRowClick(row);
                          }
                        : undefined
                    }
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${
                          col.sticky
                            ? `sticky right-0 z-10 border-l border-white/[0.06] ${STICKY_BODY_BG} ${STICKY_SHADOW}`
                            : ''
                        } ${col.className ?? ''}`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3">
            <span className="text-sm text-zinc-400">
              Showing page {String(page)} of {String(pagination.totalPages)} (
              {String(pagination.totalCount)} total)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                disabled={page <= 1}
                onClick={() => {
                  onPageChange?.(page - 1);
                }}
                aria-label="Go to previous page"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                disabled={!pagination.hasNext}
                onClick={() => {
                  onPageChange?.(page + 1);
                }}
                aria-label="Go to next page"
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
