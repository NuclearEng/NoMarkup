'use client';

import { memo } from 'react';
import type { WidgetProps } from './types';
import { PriceHeroWidget } from './widgets/price-hero-widget';
import { SavingsWidget } from './widgets/savings-widget';
import { OrderBookWidget } from './widgets/order-book-widget';
import { PriceChartWidget } from './widgets/price-chart-widget';
import { DepthChartWidget } from './widgets/depth-chart-widget';
import { BidTrendWidget } from './widgets/bid-trend-widget';
import { ActivityFeedWidget } from './widgets/activity-feed-widget';
import { TopProvidersWidget } from './widgets/top-providers-widget';
import { MarketIntelWidget } from './widgets/market-intel-widget';
import { VelocityWidget } from './widgets/velocity-widget';
import { SocialProofWidget } from './widgets/social-proof-widget';
import { JobDetailsWidget } from './widgets/job-details-widget';

const WIDGET_COMPONENTS: Record<string, (props: WidgetProps) => React.ReactNode> = {
  'price-hero': PriceHeroWidget,
  savings: SavingsWidget,
  'order-book': OrderBookWidget,
  'price-chart': PriceChartWidget,
  'depth-chart': DepthChartWidget,
  'bid-trend': BidTrendWidget,
  'activity-feed': ActivityFeedWidget,
  'top-providers': TopProvidersWidget,
  'market-intel': MarketIntelWidget,
  velocity: VelocityWidget,
  'social-proof': SocialProofWidget,
  'job-details': JobDetailsWidget,
};

interface WidgetRendererProps {
  widgetId: string;
  widgetProps: WidgetProps;
}

export const WidgetRenderer = memo(function WidgetRenderer({ widgetId, widgetProps }: WidgetRendererProps) {
  const Component = WIDGET_COMPONENTS[widgetId];
  if (!Component) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Unknown widget: {widgetId}</p>
      </div>
    );
  }
  return <Component {...widgetProps} />;
});
