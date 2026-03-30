'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PaginationResponse } from '@/types';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

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
  const widths = ['w-24', 'w-32', 'w-20', 'w-16', 'w-28', 'w-36'];

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="border-b">
          {columns.map((col, colIndex) => (
            <td key={col.key} className="px-4 py-3">
              <Skeleton variant="text" className={`h-4 ${widths[colIndex % widths.length]}`} />
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
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`text-muted-foreground px-4 py-3 text-left font-medium ${col.className ?? ''}`}
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
                    className="text-muted-foreground px-4 py-12 text-center"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={`hover:bg-muted/50 border-b transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                    onClick={
                      onRowClick
                        ? () => {
                            onRowClick(row);
                          }
                        : undefined
                    }
                  >
                    {columns.map((col) => (
                      <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
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
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-muted-foreground text-sm">
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
