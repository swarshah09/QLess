import type { Station } from '@/types';
import { getRecommendation } from '@/lib/status';
import { Clock, ThumbsUp, TriangleAlert, HelpCircle } from 'lucide-react';

export function RecommendationBanner({ station }: { station: Station }) {
  const reco = getRecommendation(station);
  const icon = {
    good: <ThumbsUp size={20} />,
    busy: <Clock size={20} />,
    avoid: <TriangleAlert size={20} />,
    unknown: <HelpCircle size={20} />,
  }[reco.tone];

  return (
    <div className={`reco reco--${reco.tone}`} data-testid="recommendation-banner">
      <div className="reco__icon">{icon}</div>
      <div>
        <div className="reco__title">{reco.title.toUpperCase()}</div>
        <div className="reco__detail">{reco.detail}</div>
      </div>
    </div>
  );
}
