import type { Availability } from '@/types';
import { AVAILABILITY_LABEL, AVAILABILITY_TONE } from '@/lib/status';

// Status is never communicated by color alone — always with a label + dot/icon.
export function StatusBadge({ availability }: { availability: Availability }) {
  const tone = AVAILABILITY_TONE[availability];
  return (
    <span
      className={`badge badge--${tone}`}
      data-testid={`status-badge-${availability}`}
    >
      <span className="badge__dot" />
      {AVAILABILITY_LABEL[availability].toUpperCase()}
    </span>
  );
}
