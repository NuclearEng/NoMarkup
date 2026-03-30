'use client';

import { Activity, Flame, Snowflake, Thermometer } from 'lucide-react';

import type { WidgetProps } from '../types';

function getVelocityConfig(velocity: number) {
  if (velocity >= 6)
    return {
      label: 'Hot',
      icon: Flame,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      barColor: 'bg-red-500',
    };
  if (velocity >= 3)
    return {
      label: 'Heating',
      icon: Thermometer,
      color: 'text-orange-500',
      bg: 'bg-orange-500/10',
      barColor: 'bg-orange-500',
    };
  if (velocity >= 1)
    return {
      label: 'Cooling',
      icon: Activity,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      barColor: 'bg-blue-400',
    };
  return {
    label: 'Quiet',
    icon: Snowflake,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    barColor: 'bg-slate-400',
  };
}

export function VelocityWidget({ sim }: WidgetProps) {
  const config = getVelocityConfig(sim.velocity);
  const Icon = config.icon;
  const maxBucket = Math.max(...sim.velocityBuckets, 1);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
      <div className={`rounded-full p-3 ${config.bg}`}>
        <Icon className={`h-6 w-6 ${config.color}`} />
      </div>
      <div className="text-center">
        <p className={`text-lg font-bold ${config.color}`}>{config.label}</p>
        <p className="text-muted-foreground text-xs">
          {String(sim.velocity)} bids / min
        </p>
      </div>
      {/* Mini sparkline bars */}
      <div className="flex items-end gap-1">
        {sim.velocityBuckets.map((count, idx) => (
          <div
            key={idx}
            className={`w-3 rounded-sm transition-all duration-300 ${config.barColor}`}
            style={{
              height: `${Math.max(4, (count / maxBucket) * 40)}px`,
              opacity: 0.4 + (count / maxBucket) * 0.6,
            }}
          />
        ))}
      </div>
    </div>
  );
}
