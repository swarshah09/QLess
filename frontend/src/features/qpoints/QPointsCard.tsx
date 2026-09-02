'use client';

import { useEffect, useState } from 'react';
import { Award, Fuel, Gauge, List } from 'lucide-react';
import { QPointsService } from '@/services/QPointsService';
import type { QPointsSummary } from '@/types';

// Only rendered when the caller already knows the viewer is logged in (see
// profile/page.tsx's `{user && <QPointsCard />}` guard) — a guest never has a
// ledger to fetch, so this component itself does not re-check auth state.
export function QPointsCard() {
  const [summary, setSummary] = useState<QPointsSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QPointsService.getMyTotal()
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        // Fails quiet, matching ReportService.getStationReports' convention:
        // a QPoints fetch failure should never break the rest of the profile
        // page — the card just doesn't render.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;

  return (
    <div className="qpoints-card" data-testid="qpoints-card">
      <div className="qpoints-card__icon">
        <Award size={22} />
      </div>
      <div className="qpoints-card__body">
        <div className="qpoints-card__label">QPoints</div>
        <div className="qpoints-card__total" data-testid="qpoints-total">
          {summary.total}
        </div>
        <div className="qpoints-card__breakdown">
          <span>
            <List size={13} /> Queue {summary.byKind.queue}
          </span>
          <span>
            <Fuel size={13} /> Availability {summary.byKind.availability}
          </span>
          <span>
            <Gauge size={13} /> Pressure {summary.byKind.pressure}
          </span>
        </div>
      </div>
    </div>
  );
}
