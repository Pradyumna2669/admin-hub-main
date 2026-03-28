import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon: Icon,
  trend,
  className,
}) => {
  return (
    <div className={cn('stoic-card overflow-hidden p-6', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-heading font-semibold text-foreground mt-2">
            {value}
          </p>
          {trend && (
            <p
              className={cn(
                'text-sm mt-2',
                trend.isPositive ? 'text-green-400' : 'text-red-400'
              )}
            >
              {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}% from last week
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-primary/15 bg-primary/10 p-3 shadow-[0_0_24px_hsl(var(--primary)/0.12)]">
          <Icon className="h-6 w-6 text-primary" />
        </div>
      </div>
    </div>
  );
};
