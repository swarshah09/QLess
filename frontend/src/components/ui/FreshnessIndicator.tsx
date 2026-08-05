import { getFreshness, relativeTime, FRESHNESS_LABEL } from '@/lib/status';

const TONE: Record<string, string> = {
  LIVE: 'live',
  RECENT: 'recent',
  AGING: 'aging',
  STALE: 'stale',
};

export function FreshnessIndicator({ lastUpdated }: { lastUpdated: string }) {
  const freshness = getFreshness(lastUpdated);
  const tone = TONE[freshness];
  return (
    <span
      className="station-card__freshness"
      style={{ color: `var(--tone-${tone})` }}
      data-testid={`freshness-${freshness}`}
    >
      {freshness === 'LIVE' ? (
        <span className="dot-live" />
      ) : (
        <span className={`badge__dot dot--${tone}`} />
      )}
      {FRESHNESS_LABEL[freshness]} · {relativeTime(lastUpdated)}
    </span>
  );
}
