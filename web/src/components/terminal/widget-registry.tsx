'use client';

import {
  Activity,
  BarChart3,
  DollarSign,
  FileText,
  Gauge,
  Info,
  LineChart,
  List,
  PiggyBank,
  TrendingDown,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Widget category ──
const WIDGET_CATEGORY = {
  MARKET: 'market',
  CHART: 'chart',
  ACTIVITY: 'activity',
  INFO: 'info',
} as const;
type WidgetCategory = (typeof WIDGET_CATEGORY)[keyof typeof WIDGET_CATEGORY];

// ── Widget definition ──
export interface WidgetDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  category: WidgetCategory;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize?: { w: number; h: number };
}

// ── Registry ──
export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    id: 'price-hero',
    label: 'Current Price',
    icon: DollarSign,
    category: WIDGET_CATEGORY.MARKET,
    defaultSize: { w: 12, h: 5 },
    minSize: { w: 6, h: 4 },
    maxSize: { w: 12, h: 8 },
  },
  {
    id: 'savings',
    label: 'Savings Hero',
    icon: PiggyBank,
    category: WIDGET_CATEGORY.MARKET,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 6 },
  },
  {
    id: 'order-book',
    label: 'Order Book',
    icon: List,
    category: WIDGET_CATEGORY.MARKET,
    defaultSize: { w: 4, h: 10 },
    minSize: { w: 3, h: 6 },
    maxSize: { w: 6, h: 16 },
  },
  {
    id: 'price-chart',
    label: 'Price History',
    icon: LineChart,
    category: WIDGET_CATEGORY.CHART,
    defaultSize: { w: 6, h: 7 },
    minSize: { w: 4, h: 5 },
    maxSize: { w: 12, h: 12 },
  },
  {
    id: 'depth-chart',
    label: 'Depth Chart',
    icon: BarChart3,
    category: WIDGET_CATEGORY.CHART,
    defaultSize: { w: 6, h: 7 },
    minSize: { w: 4, h: 5 },
    maxSize: { w: 12, h: 12 },
  },
  {
    id: 'bid-trend',
    label: 'Bid Trend',
    icon: TrendingDown,
    category: WIDGET_CATEGORY.CHART,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 3 },
    maxSize: { w: 12, h: 10 },
  },
  {
    id: 'activity-feed',
    label: 'Live Activity',
    icon: Activity,
    category: WIDGET_CATEGORY.ACTIVITY,
    defaultSize: { w: 4, h: 10 },
    minSize: { w: 3, h: 5 },
    maxSize: { w: 6, h: 16 },
  },
  {
    id: 'top-providers',
    label: 'Top Providers',
    icon: Users,
    category: WIDGET_CATEGORY.ACTIVITY,
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 4 },
    maxSize: { w: 6, h: 10 },
  },
  {
    id: 'market-intel',
    label: 'Market Intelligence',
    icon: Info,
    category: WIDGET_CATEGORY.INFO,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
    maxSize: { w: 12, h: 8 },
  },
  {
    id: 'velocity',
    label: 'Bid Velocity',
    icon: Gauge,
    category: WIDGET_CATEGORY.ACTIVITY,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 3 },
    maxSize: { w: 6, h: 6 },
  },
  {
    id: 'social-proof',
    label: 'Social Proof',
    icon: Users,
    category: WIDGET_CATEGORY.INFO,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 3 },
    maxSize: { w: 6, h: 6 },
  },
  {
    id: 'job-details',
    label: 'Job Details',
    icon: FileText,
    category: WIDGET_CATEGORY.INFO,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 10 },
  },
];

export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  market: 'Market Data',
  chart: 'Charts',
  activity: 'Activity',
  info: 'Information',
};

export function getWidgetById(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === id);
}
