import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PerformanceChart } from '@/components/seller/PerformanceChart';
import type { SellerAnalyticsDailyPoint } from '@/types';

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function stat(label: string): string | null {
  return screen.getByText(label).nextElementSibling?.textContent ?? null;
}

function bars(): Element[] {
  return Array.from(screen.getByRole('img').children);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PerformanceChart', () => {
  it('server-renders a skeleton instead of date-dependent stats (hydration safety)', () => {
    const html = renderToString(
      <PerformanceChart data={[{ date: '2026-03-15', gross_cents: 5000, order_count: 1 }]} rangeDays={7} />,
    );
    expect(html).toContain('Revenue');
    expect(html).not.toContain('Gross');
    expect(html).not.toContain('$50.00');
  });

  it('shows zeroed stats and an empty state when there are no sales in range', () => {
    const { container } = render(<PerformanceChart data={[]} rangeDays={7} className="col-span-2" />);
    expect(container.firstElementChild).toHaveClass('col-span-2');
    expect(screen.getByText('Revenue').parentElement).toHaveTextContent('Last 7 days');
    expect(stat('Gross')).toBe('$0.00');
    expect(stat('Orders')).toBe('0');
    expect(stat('Avg / day')).toBe('$0.00');
    expect(screen.getByText(/No sales yet in the last/)).toHaveTextContent('No sales yet in the last 7 days.');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('ignores points that fall outside the selected range', () => {
    const data: SellerAnalyticsDailyPoint[] = [{ date: '2026-01-01', gross_cents: 99900, order_count: 4 }];
    render(<PerformanceChart data={data} rangeDays={7} />);
    expect(stat('Gross')).toBe('$0.00');
    expect(screen.getByText(/No sales yet/)).toBeInTheDocument();
  });

  it('totals the range, fills missing days with empty bars, and describes the chart', () => {
    const data: SellerAnalyticsDailyPoint[] = [
      { date: '2026-03-15', gross_cents: 10000, order_count: 2 },
      { date: '2026-03-12', gross_cents: 4000, order_count: 1 },
    ];
    render(<PerformanceChart data={data} rangeDays={7} />);
    expect(stat('Gross')).toBe('$140.00');
    expect(stat('Orders')).toBe('3');
    expect(stat('Avg / day')).toBe('$20.00');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Daily revenue for the last 7 days, total $140.00',
    );

    const columns = bars();
    expect(columns).toHaveLength(7);
    // Oldest → newest: 03-09 … 03-15. Only 03-12 (index 3) and 03-15 (index 6) sold.
    const withTooltip = columns.filter((c) => c.children.length === 2);
    expect(withTooltip).toHaveLength(2);

    const mar12 = columns[3];
    const mar15 = columns[6];
    if (!(mar12 instanceof HTMLElement) || !(mar15 instanceof HTMLElement)) {
      throw new Error('expected bar columns');
    }
    expect(within(mar12).getByText(dayLabel('2026-03-12'))).toBeInTheDocument();
    expect(within(mar12).getByText('$40.00')).toBeInTheDocument();
    expect(within(mar12).getByText('1 order')).toBeInTheDocument();
    expect(within(mar15).getByText('2 orders')).toBeInTheDocument();

    // Bar heights are relative to the best day; empty days keep a 1% sliver.
    expect(mar15.lastElementChild).toHaveStyle({ height: '100%' });
    expect(mar12.lastElementChild).toHaveStyle({ height: '40%' });
    expect(columns[0]?.lastElementChild).toHaveStyle({ height: '1%' });
    expect(columns[0]?.lastElementChild).toHaveClass('bg-muted');
    expect(mar15.lastElementChild).toHaveClass('bg-emerald-500');
  });

  it('labels only the first and last day on short ranges', () => {
    render(
      <PerformanceChart data={[{ date: '2026-03-15', gross_cents: 100, order_count: 1 }]} rangeDays={7} />,
    );
    const axis = screen.getByRole('img').nextElementSibling;
    expect(axis?.children).toHaveLength(2);
    expect(axis?.firstElementChild).toHaveTextContent(dayLabel('2026-03-09'));
    expect(axis?.lastElementChild).toHaveTextContent(dayLabel('2026-03-15'));
  });

  it('adds a middle axis label from 14 days up', () => {
    render(
      <PerformanceChart data={[{ date: '2026-03-15', gross_cents: 100, order_count: 1 }]} rangeDays={14} />,
    );
    const axis = screen.getByRole('img').nextElementSibling;
    expect(axis?.children).toHaveLength(3);
    expect(axis?.firstElementChild).toHaveTextContent(dayLabel('2026-03-02'));
    expect(axis?.children[1]).toHaveTextContent(dayLabel('2026-03-09'));
    expect(bars()).toHaveLength(14);
  });

  it('does not divide by zero for an empty range', () => {
    render(<PerformanceChart data={[]} rangeDays={0} />);
    expect(stat('Avg / day')).toBe('$0.00');
    expect(screen.getByText(/No sales yet/)).toHaveTextContent('No sales yet in the last 0 days.');
  });
});
