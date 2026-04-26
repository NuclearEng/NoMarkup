import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type Column } from '@/components/admin/DataTable';

interface Row {
  id: string;
  name: string;
  count: number;
}

function makeColumns(): Column<Row>[] {
  return [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'count', header: 'Count', render: (r) => String(r.count) },
  ];
}

describe('DataTable', () => {
  it('renders headers and rows', () => {
    render(
      createElement(DataTable<Row>, {
        columns: makeColumns(),
        data: [
          { id: '1', name: 'Alice', count: 5 },
          { id: '2', name: 'Bob', count: 9 },
        ],
        rowKey: (r) => r.id,
      }),
    );
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Count')).toBeDefined();
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
  });

  it('shows the empty message when there is no data', () => {
    render(
      createElement(DataTable<Row>, {
        columns: makeColumns(),
        data: [],
        rowKey: (r) => r.id,
        emptyMessage: 'Nothing here',
      }),
    );
    expect(screen.getByText('Nothing here')).toBeDefined();
  });

  it('renders skeleton rows when loading', () => {
    const { container } = render(
      createElement(DataTable<Row>, {
        columns: makeColumns(),
        data: [],
        rowKey: (r) => r.id,
        loading: true,
      }),
    );
    // Skeleton rows render as <tr>; in loading mode there should be 5
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(5);
  });

  it('calls onRowClick when a row is clicked', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(
      createElement(DataTable<Row>, {
        columns: makeColumns(),
        data: [{ id: '1', name: 'Alice', count: 5 }],
        rowKey: (r) => r.id,
        onRowClick,
      }),
    );
    await user.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith({ id: '1', name: 'Alice', count: 5 });
  });

  it('renders pagination controls and triggers page change', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(
      createElement(DataTable<Row>, {
        columns: makeColumns(),
        data: [{ id: '1', name: 'Alice', count: 5 }],
        rowKey: (r) => r.id,
        page: 2,
        pagination: {
          page: 2,
          pageSize: 10,
          totalCount: 30,
          totalPages: 3,
          hasNext: true,
        },
        onPageChange,
      }),
    );
    expect(screen.getByText(/Showing page 2 of 3/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
