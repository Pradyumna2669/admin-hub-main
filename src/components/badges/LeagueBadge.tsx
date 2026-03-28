import React from 'react';
import { cn } from '@/lib/utils';
import { League, LEAGUE_LABELS, normalizeLeague } from '@/lib/workerLeagues';

// Serve from public/badges/* (Vite copies /public to root)
const leagueAsset: Record<League, { src: string; animated?: boolean }> = {
  bronze: { src: '/badges/bronze.png' },
  silver: { src: '/badges/silver.png' },
  gold: { src: '/badges/gold.png' },
  platinum: { src: '/badges/platinum.gif', animated: true },
  diamond: { src: '/badges/diamond.gif', animated: true },
};

type Props = {
  league?: string | null;
  showLabel?: boolean;
  className?: string;
};

export function LeagueBadge({ league, showLabel = false, className }: Props) {
  const normalized = normalizeLeague(league);
  if (!normalized) return null;
  const asset = leagueAsset[normalized];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold',
        className
      )}
      title={LEAGUE_LABELS[normalized]}
    >
      <span className="h-4 w-4 rounded-full overflow-hidden">
        <img
          src={asset.src}
          alt={`${LEAGUE_LABELS[normalized]} badge`}
          className={cn('h-full w-full object-cover')}
        />
      </span>
      {showLabel && <span className="leading-none">{LEAGUE_LABELS[normalized]}</span>}
    </span>
  );
}
