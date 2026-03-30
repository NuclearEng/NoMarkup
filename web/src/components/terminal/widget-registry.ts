import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  DollarSign,
  FileText,
  Info,
  LineChart,
  List,
  PiggyBank,
  TrendingDown,
  Users,
} from 'lucide-react';

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

export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'price-hero',
    label: 'Current Price',
    icon: DollarSign,
    category: WIDGET_CATEGORY.MARKET,
    defaultSize: { w: 12, h: 4 },
    minSize: { w: 6, h: 3 },
  },
  {
    id: 'savings',
    label: 'Savings Hero',
    icon: PiggyBank,
    category: WIDGET_CATEGORY.MARKET,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
  {
    id: 'order-book',
    label: 'Order Book',
    icon: List,
    category: WIDGET_CATEGORY.MARKET,
    defaultSize: { w: 4, h: 10 },
    minSize: { w: 3, h: 5 },
  },
  {
    id: 'price-chart',
    label: 'Price History',
    icon: LineChart,
    category: WIDGET_CATEGORY.CHART,
    defaultSize: { w: 6, h: 7 },
    minSize: { w: 4, h: 5 },
  },
  {
    id: 'depth-chart',
    label: 'Depth Chart',
    icon: BarChart3,
    category: WIDGET_CATEGORY.CHART,
    defaultSize: { w: 6, h: 7 },
    minSize: { w: 4, h: 5 },
  },
  {
    id: 'bid-trend',
    label: 'Bid Trend',
    icon: TrendingDown,
    category: WIDGET_CATEGORY.CHART,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  {
    id: 'activity-feed',
    label: 'Live Activity',
    icon: Activity,
    category: WIDGET_CATEGORY.ACTIVITY,
    defaultSize: { w: 3, h: 10 },
    minSize: { w: 3, h: 5 },
  },
  {
    id: 'top-providers',
    label: 'Top Providers',
    icon: Users,
    category: WIDGET_CATEGORY.ACTIVITY,
    defaultSize: { w: 4, h: 6 },
    minSize: { w: 3, h: 4 },
  },
  {
    id: 'market-intel',
    label: 'Market Intelligence',
    icon: Info,
    category: WIDGET_CATEGORY.INFO,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },
  {
    id: 'social-proof',
    label: 'Social Proof',
    icon: Users,
    category: WIDGET_CATEGORY.INFO,
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 3 },
  },
  {
    id: 'job-details',
    label: 'Job Details',
    icon: FileText,
    category: WIDGET_CATEGORY.INFO,
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
  },
];

// ── Lookup maps ──

/** Record of widget definitions keyed by id */
export const WIDGET_MAP: Record<string, WidgetDefinition> = Object.fromEntries(
  WIDGETS.map((w) => [w.id, w]),
);

/** Widgets grouped by category */
export const WIDGET_CATEGORIES: Record<WidgetCategory, WidgetDefinition[]> =
  WIDGETS.reduce<Record<string, WidgetDefinition[]>>((acc, w) => {
    const cat = w.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(w);
    return acc;
  }, {}) as Record<WidgetCategory, WidgetDefinition[]>;

/** Category display labels */
export const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  market: 'Market Data',
  chart: 'Charts',
  activity: 'Activity',
  info: 'Information',
};

/** Backward-compatible helper — prefer WIDGET_MAP[id] for O(1) lookup */
export function getWidgetById(id: string): WidgetDefinition | undefined {
  return WIDGET_MAP[id];
}
