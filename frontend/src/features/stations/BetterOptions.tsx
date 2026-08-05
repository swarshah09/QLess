'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Station } from '@/types';
import { StationService } from '@/services/StationService';
import { formatDistance, queueUpperBound } from '@/lib/status';

export function BetterOptions({ station }: { station: Station }) {
  const [options, setOptions] = useState<Station[]>([]);

  useEffect(() => {
    StationService.getBetterOptions(station.id).then(setOptions);
  }, [station.id]);

  if (options.length === 0) return null;

  const baseQ = queueUpperBound(station.queue) ?? 0;

  return (
    <section data-testid="better-options">
      <div className="section-head">
        <h2>Better options nearby</h2>
      </div>
      <div className="list">
        {options.map((opt) => {
          const optQ = queueUpperBound(opt.queue) ?? 0;
          const shorter = Math.max(0, baseQ - optQ);
          const extraDist =
            (opt.distanceKm ?? 0) - (station.distanceKm ?? 0);
          const saveMin = Math.round(shorter * 2.2 - Math.max(0, extraDist) * 2);
          return (
            <Link
              key={opt.id}
              href={`/app/station/${opt.id}`}
              className="alt"
              data-testid={`better-option-${opt.id}`}
            >
              <div>
                <div style={{ fontWeight: 700, fontFamily: 'var(--font-heading)' }}>
                  {opt.name}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {extraDist > 0
                    ? `${extraDist.toFixed(1)} km farther · ${shorter}+ shorter queue`
                    : `${formatDistance(opt.distanceKm)} away · shorter queue`}
                </div>
                {saveMin > 2 && (
                  <div className="alt__save" style={{ marginTop: 4 }}>
                    May save ~{saveMin} minutes
                  </div>
                )}
              </div>
              <ArrowRight size={18} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
