'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, MapPin, XCircle } from 'lucide-react';
import type { Station } from '@/types';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { LocationService } from '@/services/LocationService';
import { VisitService } from '@/services/VisitService';
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
  // Set by a successful check-in; needed to advance the visit afterwards.
  const [visitId, setVisitId] = useState<string | null>(null);

  useEffect(() => {
    if (open && station) {
      setPhase('checking');
      setVisitId(null);
      let cancelled = false;

      // The backend verifies proximity and opens the visit in one step.
      LocationService.verifyNearby(station.id).then((r) => {
        if (cancelled) return;
        setVisitId(r.visitId);
        setPhase(r.nearby ? 'nearby' : 'far');
      });

      return () => {
        cancelled = true;
      };
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
                // Not joining the queue ends the visit with no outcome claimed.
                if (station && visitId) {
                  void VisitService.complete(station.id, visitId, 'UNKNOWN');
                }
                toast('No problem.', 'default');
                onClose();
              }}
              data-testid="imhere-queue-no"
            >
              No
            </Button>
            <Button
              onClick={() => {
                if (station && visitId) {
                  void VisitService.joinQueue(station.id, visitId);
                }
                setPhase('in-queue');
              }}
              data-testid="imhere-queue-yes"
            >
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
              // Only an explicit confirmation records a successful refuel.
              if (station && visitId) {
                void VisitService.complete(station.id, visitId, 'REFUELLED');
              }
              toast('Thanks for confirming!', 'success');
              onClose();
            }}
            data-testid="imhere-done"
          >
            Yes, done refuelling
          </Button>
          <Button
            variant="secondary"
            block
            onClick={() => {
              // Leaving without refuelling is a distinct, recorded outcome.
              if (station && visitId) {
                void VisitService.complete(station.id, visitId, 'ABANDONED_QUEUE');
              }
              toast('Thanks — noted that you left the queue.', 'default');
              onClose();
            }}
            data-testid="imhere-left"
          >
            No, I left the queue
          </Button>
        </div>
      )}
    </BottomSheet>
  );
}
