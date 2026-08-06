'use client';

import Link from 'next/link';
import { Bell, Navigation2 } from 'lucide-react';
import type { Station } from '@/types';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FreshnessIndicator } from '@/components/ui/FreshnessIndicator';
import { formatDistance, formatWait, isStale, queueLabel } from '@/lib/status';

interface Props {
  station: Station;
  onNotify: (s: Station) => void;
  onNavigate: (s: Station) => void;
}

export function StationPreview({ station, onNotify, onNavigate }: Props) {
  const stale = isStale(station.lastUpdated);
  return (
    <Card data-testid={`map-preview-${station.id}`}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <Link
          href={`/app/station/${station.id}`}
          style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16 }}
        >
          {station.name}
        </Link>
        <StatusBadge availability={station.availability} />
      </div>
      <div className="muted" style={{ fontSize: 13, margin: '6px 0' }}>
        {formatDistance(station.distanceKm)} ·{' '}
        {stale ? 'Queue unavailable' : queueLabel(station.queue)} ·{' '}
        {stale ? '—' : formatWait(station.wait)}
      </div>
      <div style={{ marginBottom: 12 }}>
        <FreshnessIndicator lastUpdated={station.lastUpdated} />
      </div>
      <div className="btn-row">
        <button
          className="btn btn--primary btn--sm"
          onClick={() => onNavigate(station)}
          data-testid={`preview-go-${station.id}`}
        >
          <Navigation2 size={16} /> Go now
        </button>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => onNotify(station)}
          data-testid={`preview-notify-${station.id}`}
        >
          <Bell size={16} /> Notify me
        </button>
      </div>
      <Link
        href={`/app/station/${station.id}`}
        className="btn btn--outline btn--sm btn--block"
        style={{ marginTop: 8 }}
        data-testid={`preview-view-${station.id}`}
      >
        View station
      </Link>
    </Card>
  );
}
