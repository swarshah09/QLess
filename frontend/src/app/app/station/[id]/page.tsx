'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Bell,
  Bookmark,
  Clock3,
  Fuel,
  Gauge,
  History,
  MapPin,
  Navigation2,
  Users,
} from 'lucide-react';
import type { Station } from '@/types';
import { StationService } from '@/services/StationService';
import { SavedStationService } from '@/services/SavedStationService';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfidenceBadge } from '@/components/ui/ConfidenceBadge';
import { FreshnessIndicator } from '@/components/ui/FreshnessIndicator';
import { RecommendationBanner } from '@/features/stations/RecommendationBanner';
import { BetterOptions } from '@/features/stations/BetterOptions';
import { ReportSheet } from '@/features/reports/ReportSheet';
import { ImHereSheet } from '@/features/reports/ImHereSheet';
import { ReportService } from '@/services/ReportService';
import { useSheets } from '@/hooks/SheetsContext';
import { useToast } from '@/hooks/ToastContext';
import { useLocation } from '@/hooks/LocationContext';
import {
  formatDistance,
  formatWait,
  getFreshness,
  isStale,
  relativeTime,
} from '@/lib/status';

export default function StationDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { openNotify, openNavigate } = useSheets();
  const { toast } = useToast();
  const { coords } = useLocation();

  const [station, setStation] = useState<Station | null | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [imHereOpen, setImHereOpen] = useState(false);
  const [communityAt, setCommunityAt] = useState<string | null>(null);

  const refreshCommunity = () =>
    ReportService.getLatestReport(id).then((r) => setCommunityAt(r?.reportedAt ?? null));

  useEffect(() => {
    StationService.getStation(id, coords ?? undefined).then((s) => {
      setStation(s ?? null);
      setSaved(SavedStationService.isSaved(id));
    });
    refreshCommunity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, coords?.lat, coords?.lng]);

  async function toggleSave() {
    const now = await SavedStationService.toggle(id);
    setSaved(now);
    toast(now ? 'Saved to your stations' : 'Removed from saved');
  }

  if (station === undefined) {
    return (
      <div style={{ padding: 16 }}>
        <Skeleton height={28} width="50%" />
        <Skeleton height={180} radius={16} style={{ marginTop: 16 }} />
        <Skeleton height={120} radius={16} style={{ marginTop: 12 }} />
      </div>
    );
  }

  if (station === null) {
    return (
      <ErrorState
        title="Station not found"
        text="This station may no longer be available."
        onRetry={() => router.push('/app/home')}
      />
    );
  }

  const stale = isStale(station.lastUpdated);
  const freshness = getFreshness(station.lastUpdated);

  return (
    <div data-testid="station-details">
      <header className="app-header">
        <button
          className="icon-btn"
          onClick={() => router.back()}
          aria-label="Back"
          data-testid="details-back"
          style={{ marginLeft: -10 }}
        >
          <ArrowLeft size={22} />
        </button>
        <button
          className="icon-btn"
          onClick={toggleSave}
          aria-label={saved ? 'Remove from saved' : 'Save station'}
          data-testid="details-save"
        >
          <Bookmark size={22} fill={saved ? 'var(--primary)' : 'none'} color={saved ? 'var(--primary)' : 'currentColor'} />
        </button>
      </header>

      <div style={{ padding: 16 }} className="stack">
        <div>
          <h1 style={{ fontSize: 24 }}>{station.name}</h1>
          <div className="station-card__meta" style={{ marginTop: 4 }}>
            <MapPin size={14} /> {formatDistance(station.distanceKm)} · {station.address}
          </div>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <StatusBadge availability={station.availability} />
          <ConfidenceBadge confidence={station.confidence} />
          {communityAt && (
            <span className="badge badge--recent" data-testid="community-update">
              Community update • {relativeTime(communityAt)}
            </span>
          )}
        </div>

        <RecommendationBanner station={station} />

        {/* Live stats */}
        <Card className="stack" style={{ gap: 16 }}>
          <div className="station-card__grid">
            <Detail
              icon={<Users size={16} />}
              label="Queue"
              value={
                stale || station.queue === 'UNKNOWN'
                  ? '—'
                  : `${station.queue}`
              }
              hint={station.queue !== 'UNKNOWN' && !stale ? 'cars' : undefined}
            />
            <Detail
              icon={<Clock3 size={16} />}
              label="Est. wait"
              value={stale || !station.wait ? '—' : formatWait(station.wait)}
            />
            <Detail
              icon={<Gauge size={16} />}
              label="Pressure"
              value={
                station.pressure.value === null
                  ? '—'
                  : `${station.pressure.value}`
              }
              hint={station.pressure.value !== null ? station.pressure.unit : undefined}
            />
          </div>
          <div className="divider" style={{ margin: 0 }} />
          <div className="station-card__grid">
            <Detail
              icon={<MapPin size={16} />}
              label="Distance"
              value={formatDistance(station.distanceKm)}
            />
            <Detail
              icon={<Fuel size={16} />}
              label="Dispensers"
              value={
                station.activeDispensers === null
                  ? '—'
                  : `${station.activeDispensers}/${station.totalDispensers}`
              }
            />
            <Detail
              icon={<Clock3 size={16} />}
              label="Updated"
              value={relativeTime(station.lastUpdated).replace(' ago', '')}
            />
          </div>
          <div className="station-card__foot" style={{ paddingTop: 12 }}>
            <FreshnessIndicator lastUpdated={station.lastUpdated} />
          </div>
        </Card>

        {/* Stale handling — never present old data as live */}
        {stale && (
          <Card style={{ borderColor: 'var(--tone-stale)' }} data-testid="stale-card">
            <div style={{ fontWeight: 700, color: 'var(--tone-stale)' }}>
              Live queue unavailable
            </div>
            <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
              Last confirmed {relativeTime(station.lastUpdated)}.
            </p>
            {station.historicalHint && (
              <div
                className="hint"
                style={{ marginTop: 12 }}
                data-testid="historical-estimate"
              >
                <History size={16} />
                <div>
                  <span className="badge badge--outline" style={{ marginBottom: 6, display: 'inline-flex' }}>
                    HISTORICAL ESTIMATE
                  </span>
                  <div>{station.historicalHint}.</div>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Primary CTAs */}
        <div className="btn-row">
          <Button size="lg" onClick={() => openNavigate(station)} data-testid="details-navigate">
            <Navigation2 size={18} /> Navigate
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => openNotify(station)}
            data-testid="details-notify"
          >
            <Bell size={18} /> Notify me
          </Button>
        </div>

        {/* Secondary — community contribution, visible but not competing */}
        <div className="btn-row">
          <Button variant="outline" onClick={() => setImHereOpen(true)} data-testid="details-imhere">
            I&apos;m here
          </Button>
          <Button
            variant="outline"
            onClick={() => setReportOpen(true)}
            data-testid="details-update-status"
          >
            <Users size={16} /> Update status
          </Button>
        </div>

        <BetterOptions station={station} />
      </div>

      <ReportSheet
        open={reportOpen}
        station={station}
        onClose={() => setReportOpen(false)}
        onSubmitted={refreshCommunity}
      />
      <ImHereSheet open={imHereOpen} station={station} onClose={() => setImHereOpen(false)} />
    </div>
  );
}

function Detail({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <span className="stat__label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
      </span>
      <span className="stat__value" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ color: 'var(--text-tertiary)', alignSelf: 'center' }}>{icon}</span>
        {value}
        {hint && <small>{hint}</small>}
      </span>
    </div>
  );
}
