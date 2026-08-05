'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, MapPin, XCircle } from 'lucide-react';
import type { Station } from '@/types';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { LocationService } from '@/services/LocationService';
import { useToast } from '@/hooks/ToastContext';

interface Props {
  open: boolean;
  station: Station | null;
  onClose: () => void;
}

type Phase = 'checking' | 'nearby' | 'far' | 'in-queue' | 'done';

export function ImHereSheet({ open, station, onClose }: Props) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    if (open && station) {
      setPhase('checking');
      LocationService.verifyNearby(station.id).then((r) =>
        setPhase(r.nearby ? 'nearby' : 'far'),
      );
    }
  }, [open, station]);

  return (
    <BottomSheet open={open} onClose={onClose} testId="imhere-sheet">
      {phase === 'checking' && (
        <div className="state" style={{ padding: '24px 0' }}>
          <Spinner />
          <div className="state__title">Checking your location…</div>
          <p className="state__text">Making sure you&apos;re at the station.</p>
        </div>
      )}

      {phase === 'far' && (
        <div className="state" style={{ padding: '24px 0' }}>
          <div className="state__icon" style={{ color: 'var(--tone-aging)' }}>
            <XCircle size={28} />
          </div>
          <div className="state__title">You don&apos;t seem to be here yet</div>
          <p className="state__text">
            We couldn&apos;t confirm you&apos;re at {station?.name}. Try again when you
            arrive.
          </p>
          <Button variant="secondary" onClick={onClose} data-testid="imhere-close">
            Close
          </Button>
        </div>
      )}

      {phase === 'nearby' && (
        <div className="stack" style={{ gap: 16, padding: '8px 0 4px' }}>
          <div className="state" style={{ padding: '8px 0' }}>
            <div className="state__icon" style={{ color: 'var(--tone-available)' }}>
              <CheckCircle2 size={28} />
            </div>
            <div className="state__title">You&apos;re at {station?.name}.</div>
          </div>
          <div className="overline" style={{ textAlign: 'center' }}>
            Joining the queue?
          </div>
          <div className="btn-row">
            <Button
              variant="secondary"
              onClick={() => {
                toast('No problem.', 'default');
                onClose();
              }}
              data-testid="imhere-queue-no"
            >
              No
            </Button>
            <Button onClick={() => setPhase('in-queue')} data-testid="imhere-queue-yes">
              Yes
            </Button>
          </div>
        </div>
      )}

      {phase === 'in-queue' && (
        <div className="stack" style={{ gap: 16, padding: '8px 0 4px' }}>
          <div className="hint">
            <MapPin size={16} />
            You&apos;re in the queue. We&apos;ll ask when you&apos;re done — leaving the
            area doesn&apos;t automatically mean you refuelled.
          </div>
          <div className="overline" style={{ textAlign: 'center' }}>
            Done refuelling?
          </div>
          <Button
            block
            onClick={() => {
              toast('Thanks for confirming!', 'success');
              onClose();
            }}
            data-testid="imhere-done"
          >
            Yes, done refuelling
          </Button>
        </div>
      )}
    </BottomSheet>
  );
}
