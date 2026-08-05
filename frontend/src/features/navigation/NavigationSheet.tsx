'use client';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { NavigationService } from '@/services/NavigationService';
import type { Station } from '@/types';
import { MapPin } from 'lucide-react';

interface Props {
  open: boolean;
  station: Station | null;
  onClose: () => void;
}

export function NavigationSheet({ open, station, onClose }: Props) {
  const providers = NavigationService.getProviders();

  function go(id: (typeof providers)[number]['id']) {
    if (!station) return;
    NavigationService.open(id, station.lat, station.lng, station.name);
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Open directions"
      description={station ? `Navigate to ${station.name}` : undefined}
      testId="nav-sheet"
    >
      <div className="list">
        {providers.map((p) => (
          <button
            key={p.id}
            className="alt"
            onClick={() => go(p.id)}
            data-testid={`nav-provider-${p.id}`}
            style={{ width: '100%', textAlign: 'left' }}
          >
            <div className="row" style={{ gap: 12 }}>
              <span
                className="state__icon"
                style={{ width: 40, height: 40, background: 'var(--primary-tint)', color: 'var(--primary-strong)' }}
              >
                <MapPin size={18} />
              </span>
              <span style={{ fontWeight: 700 }}>{p.label}</span>
            </div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
