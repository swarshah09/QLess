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
  HelpCircle,
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
import { RealtimeService, applyStationUpdate } from '@/services/RealtimeService';
import { useSheets } from '@/hooks/SheetsContext';
import { useToast } from '@/hooks/ToastContext';
import { useLocation } from '@/hooks/LocationContext';
import {
  formatDistance,
  formatWait,
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

  // Live status while the station is on screen. The subscription is scoped to
  // this station only and torn down on navigate away.
  useEffect(() => {
    return RealtimeService.subscribe(id, (update) => {
      setStation((current) =>
        current ? applyStationUpdate(current, update) : current,
      );
    });
  }, [id]);

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

  // A station with no QLess reports yet has no real timestamp to judge
  // freshness against — `lastUpdated` falls back to the epoch, which reads as
  // "stale" and then as a fabricated "20684 days ago". `hasLiveData` is the
  // single source of truth here; every stale/freshness check below is gated
  // behind it so a never-reported station never gets treated as reported-but-old.
  const stale = station.hasLiveData && isStale(station.lastUpdated);

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

      <div className="page-inset stack" style={{ gap: 28 }}>
        <div className="details-title">
          <span className="details-title__icon" aria-hidden>
            <Fuel size={24} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 className="details-title__name">{station.name}</h1>
            <div className="station-card__meta" style={{ marginTop: 6 }}>
              <MapPin size={14} /> {formatDistance(station.distanceKm)} · {station.address}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <StatusBadge availability={station.availability} />
          {station.hasLiveData && <ConfidenceBadge confidence={station.confidence} />}
          {communityAt && (
            <span className="badge badge--recent" data-testid="community-update">
              Community update • {relativeTime(communityAt)}
            </span>
          )}
        </div>

        {station.hasLiveData ? (
          <RecommendationBanner station={station} />
        ) : (
          // Single explanation instead of three overlapping ones (a second
          // "UNKNOWN"/"stale" badge, a recommendation banner, and a stale card
          // all saying the same thing). One box, one call to action.
          <div className="reco reco--unknown" data-testid="no-live-info-banner">
            <div className="reco__icon">
              <HelpCircle size={20} />
            </div>
            <div>
              <div className="reco__title">No live info yet</div>
              <div className="reco__detail">
                Nobody has reported queue, availability or pressure here. Be the
                first — it takes a few seconds.
              </div>
            </div>
          </div>
        )}

        <Card className="stack details-stats" style={{ gap: 22 }}>
          {station.hasLiveData ? (
            <>
              <div className="station-card__grid details-stats__grid">
                <Detail
                  icon={<Users size={16} />}
                  label="Queue"
                  value={stale || station.queue === 'UNKNOWN' ? '—' : `${station.queue}`}
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
                  value={station.pressure.value === null ? '—' : `${station.pressure.value}`}
                  hint={station.pressure.value !== null ? station.pressure.unit : undefined}
                />
              </div>
              <div className="divider" style={{ margin: 0 }} />
            </>
          ) : null}

          <div className="station-card__grid details-stats__grid">
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
              value={station.hasLiveData ? relativeTime(station.lastUpdated).replace(' ago', '') : '—'}
            />
          </div>

          {station.hasLiveData && (
            <div className="station-card__foot" style={{ paddingTop: 14 }}>
              <FreshnessIndicator lastUpdated={station.lastUpdated} />
            </div>
          )}
        </Card>

        {/* Stale handling — never present old data as live. Only reachable
            when hasLiveData is true, so this is genuinely old real data, not
            the "never reported" case (handled by the banner above). */}
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

        {/* Primary + secondary CTAs read as one action group, so they keep a
            tighter gap between each other than the airier rhythm between the
            page's major sections. */}
        <div className="stack" style={{ gap: 12 }}>
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
