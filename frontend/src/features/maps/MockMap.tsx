'use client';

import { useMemo, useState } from 'react';
import { Check, HelpCircle, Minus, TriangleAlert, X } from 'lucide-react';
import type { Station } from '@/types';
import { getMarkerTone, type MarkerTone } from '@/lib/status';
import { StationPreview } from './StationPreview';

const TONE_ICON: Record<MarkerTone, React.ReactNode> = {
  good: <Check size={14} strokeWidth={3} />,
  moderate: <Minus size={14} strokeWidth={3} />,
  busy: <TriangleAlert size={13} strokeWidth={3} />,
  unavailable: <X size={14} strokeWidth={3} />,
  unknown: <HelpCircle size={13} strokeWidth={3} />,
};

interface Props {
  stations: Station[];
  onNotify: (s: Station) => void;
  onNavigate: (s: Station) => void;
}

export function MockMap({ stations, onNotify, onNavigate }: Props) {
  const [selected, setSelected] = useState<Station | null>(null);

  const positioned = useMemo(() => {
    const lats = stations.map((s) => s.lat);
    const lngs = stations.map((s) => s.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latSpan = maxLat - minLat || 1;
    const lngSpan = maxLng - minLng || 1;
    return stations.map((s) => ({
      station: s,
      left: 12 + ((s.lng - minLng) / lngSpan) * 76,
      top: 16 + ((maxLat - s.lat) / latSpan) * 64,
      tone: getMarkerTone(s),
    }));
  }, [stations]);

  return (
    <div className="mockmap" data-testid="mock-map" onClick={() => setSelected(null)}>
      <div className="mockmap__note">
        <HelpCircle size={14} />
        Demo map — connect a maps provider later to see live streets.
      </div>

      {positioned.map(({ station, left, top, tone }) => (
        <button
          key={station.id}
          className="map-marker"
          style={{ left: `${left}%`, top: `${top}%` }}
          onClick={(e) => {
            e.stopPropagation();
            setSelected(station);
          }}
          data-testid={`map-marker-${station.id}`}
          aria-label={`${station.name} — ${tone}`}
        >
          <span className={`map-marker__pin marker--${tone}`}>
            <span>{TONE_ICON[tone]}</span>
          </span>
        </button>
      ))}

      {selected && (
        <div className="map-preview" onClick={(e) => e.stopPropagation()}>
          <StationPreview
            station={selected}
            onNotify={onNotify}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  );
}
