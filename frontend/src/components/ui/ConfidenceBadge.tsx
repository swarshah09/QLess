import type { Confidence } from '@/types';
import { CONFIDENCE_LABEL } from '@/lib/status';

const TONE: Record<Confidence, string> = {
  HIGH: 'available',
  MEDIUM: 'aging',
  LOW: 'unavailable',
  STALE: 'stale',
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`badge badge--${TONE[confidence]}`}
      data-testid={`confidence-${confidence}`}
    >
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}
