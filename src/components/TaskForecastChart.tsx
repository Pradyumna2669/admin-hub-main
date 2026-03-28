import React, { useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { useTaskForecast } from '@/hooks/useTaskForecast';

const chartConfig = {
  posts: {
    label: 'Posts',
    color: '#5b8def',
  },
  replies: {
    label: 'Replies',
    color: '#67c587',
  },
  comments: {
    label: 'Comments',
    color: '#f0a23b',
  },
};

export const TaskForecastChart: React.FC = () => {
  const [view, setView] = useState<'daily' | 'hourly'>('daily');
  const { data, isLoading } = useTaskForecast();
  const points = view === 'daily' ? data?.daily || [] : data?.hourly || [];

  return (
    <Card className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <TrendingUp className="h-4 w-4" />
            Task Activity
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Showing real task creation counts from Supabase. Daily view shows the last 14
            days, and hourly view shows the last 48 hours.
          </p>
        </div>

        <div className="inline-flex rounded-2xl border border-border bg-muted/30 p-1">
          <Button
            type="button"
            size="sm"
            variant={view === 'daily' ? 'secondary' : 'ghost'}
            onClick={() => setView('daily')}
          >
            Daily
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'hourly' ? 'secondary' : 'ghost'}
            onClick={() => setView('hourly')}
          >
            Hourly
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Based on {data?.tasksAnalyzed || 0} tasks created in the last{' '}
        {data?.historyWindowDays || 45} days.
      </div>

      {isLoading ? (
        <div className="h-[320px] animate-pulse rounded-2xl bg-muted/30" />
      ) : points.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/10 p-8 text-sm text-muted-foreground">
          No task history is available for the selected time range yet.
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="h-[320px] w-full">
          <AreaChart data={points} margin={{ left: 4, right: 16, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="forecastPosts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-posts)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-posts)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="forecastReplies" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-replies)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-replies)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="forecastComments" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-comments)" stopOpacity={0.22} />
                <stop offset="95%" stopColor="var(--color-comments)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              minTickGap={view === 'daily' ? 24 : 48}
            />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={36} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.tooltipLabel || ''}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />

            <Area
              type="monotone"
              dataKey="posts"
              stroke="var(--color-posts)"
              fill="url(#forecastPosts)"
              strokeWidth={2}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="replies"
              stroke="var(--color-replies)"
              fill="url(#forecastReplies)"
              strokeWidth={2}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="comments"
              stroke="var(--color-comments)"
              fill="url(#forecastComments)"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </Card>
  );
};
