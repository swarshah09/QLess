'use client';

import Link from 'next/link';
import { Bell, Fuel, MapPin, Navigation2, Sparkles } from 'lucide-react';
import type { Station } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfidenceBadge } from '@/components/ui/ConfidenceBadge';
import { FreshnessIndicator } from '@/components/ui/FreshnessIndicator';
import {
  formatDistance,
  formatWait,
  isStale,
  queueLabel,
} from '@/lib/status';

interface Props {
  station: Station;
  onNotify: (s: Station) => void;
  onNavigate: (s: Station) => void;
  recommended?: boolean;
}

export function StationCard({ station, onNotify, onNavigate, recommended }: Props) {
  const stale = isStale(station.lastUpdated);
  return (
    <Card tappable className="station-card" data-testid={`station-card-${station.id}`}>
      <Link
        href={`/app/station/${station.id}`}
        className="station-card__top"
        data-testid={`station-link-${station.id}`}
      >
        <span className="station-card__icon" aria-hidden>
          <Fuel size={18} />
        </span>

        <div className="station-card__heading">
          <div className="station-card__name">{station.name}</div>
          <div className="station-card__meta">
            <span className="station-card__distance">
              {formatDistance(station.distanceKm)}
            </span>
            <span className="station-card__address">{station.address}</span>
          </div>
        </div>

        <StatusBadge availability={station.availability} />
      </Link>

      {recommended && (
        <span className="reco-tag" data-testid={`recommended-${station.id}`}>
          <Sparkles size={11} /> Recommended
        </span>
      )}

      {!station.hasLiveData ? (
        // Nothing has ever been reported here — usually a station just
        // discovered from the map provider. The badge above already says
        // UNKNOWN, so this only needs to explain what to do about it, not
        // repeat that the data is missing in a second, heavier block.
        <div className="station-card__nodata" data-testid={`no-live-data-${station.id}`}>
          Be the first to report queue, availability or pressure here.
        </div>
      ) : (
        <div className="station-card__grid">
          <div className="stat">
            <span className="stat__label">Queue</span>
            <span className="stat__value">
              {station.queue === 'UNKNOWN' ? (
                <small>Unknown</small>
              ) : (
                <>
                  {station.queue} <small>cars</small>
                </>
              )}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Est. wait</span>
            <span className="stat__value">
              {stale || !station.wait ? <small>—</small> : formatWait(station.wait)}
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Pressure</span>
            <span className="stat__value">
              {station.pressure.value === null ? (
                <small>Unknown</small>
              ) : (
                <>
                  {station.pressure.value} <small>{station.pressure.unit}</small>
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {station.hasLiveData && stale ? (
        <div className="hint" data-testid="stale-note">
          Live queue unavailable · last confirmed{' '}
          {queueLabel(station.queue).toLowerCase()} earlier
        </div>
      ) : null}

      {/* Freshness and confidence describe reported data. With no reports at
          all there is nothing to be fresh or confident about, and the epoch
          fallback timestamp would render as a misleading "updated" age. */}
      {station.hasLiveData && (
        <div className="station-card__foot">
          <FreshnessIndicator lastUpdated={station.lastUpdated} />
          <ConfidenceBadge confidence={station.confidence} />
        </div>
      )}

      <div className="btn-row">
        <Button
          size="sm"
          onClick={() => onNavigate(station)}
          data-testid={`go-now-${station.id}`}
        >
          <Navigation2 size={16} /> Go now
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onNotify(station)}
          data-testid={`notify-me-${station.id}`}
        >
          <Bell size={16} /> Notify me
        </Button>
      </div>
    </Card>
  );
}
