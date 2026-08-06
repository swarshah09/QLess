'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, MapPin, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { Availability, QueueRange, Station } from '@/types';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ReportService } from '@/services/ReportService';
import { LocationService } from '@/services/LocationService';
import { useToast } from '@/hooks/ToastContext';

interface Props {
  open: boolean;
  station: Station | null;
  onClose: () => void;
  onSubmitted?: () => void;
}

const QUEUE_OPTS: { v: QueueRange; label: string }[] = [
  { v: '0-3', label: '0–3' },
  { v: '4-7', label: '4–7' },
  { v: '8-15', label: '8–15' },
  { v: '16-25', label: '16–25' },
  { v: '25+', label: '25+' },
  { v: 'UNKNOWN', label: 'Not sure' },
];

const AVAIL_OPTS: { v: Availability; label: string }[] = [
  { v: 'AVAILABLE', label: 'Available' },
  { v: 'LOW_SUPPLY', label: 'Low supply' },
  { v: 'UNAVAILABLE', label: 'Unavailable' },
  { v: 'UNKNOWN', label: 'Not sure' },
];

type Verify = 'checking' | 'verified' | 'unverified';

// "Update Status" — a <10s community report. Reports are never presented as
// authoritative live data; the backend will handle consensus/confidence.
export function ReportSheet({ open, station, onClose, onSubmitted }: Props) {
  const { toast } = useToast();
  const [queue, setQueue] = useState<QueueRange | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [pressure, setPressure] = useState('');
  const [verify, setVerify] = useState<Verify>('checking');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !station) return;
    setQueue(null);
    setAvailability(null);
    setPressure('');
    setSaving(false);
    setVerify('checking');
    // Attempt to obtain location and mock-verify proximity. Never blocks.
    (async () => {
      await LocationService.getCurrentLocation();
      const res = await LocationService.verifyNearby(station.id);
      setVerify(res.nearby ? 'verified' : 'unverified');
    })();
  }, [open, station]);

  async function submit() {
    if (!station || !queue || !availability) return;
    setSaving(true);
    await ReportService.submitStationReport({
      stationId: station.id,
      queueRange: queue,
      availability,
      pressureValue: pressure ? Number(pressure) : null,
      verifiedNearby: verify === 'verified',
    });
    toast('Thanks! Your update helps other drivers.', 'success');
    setSaving(false);
    onSubmitted?.();
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Update status"
      description="Takes less than 10 seconds"
      testId="update-status-sheet"
      footer={
        <Button
          block
          size="lg"
          onClick={submit}
          disabled={!queue || !availability || saving}
          data-testid="report-submit"
        >
          {saving ? 'Submitting…' : 'Submit update'}
        </Button>
      }
    >
      {/* Location verification badge (does not block reporting) */}
      <div
        className="hint"
        style={{
          alignItems: 'center',
          background:
            verify === 'verified' ? 'var(--tint-available)' : 'var(--surface)',
          color: verify === 'verified' ? 'var(--tone-available)' : 'var(--text-secondary)',
        }}
        data-testid={`verify-${verify}`}
      >
        {verify === 'checking' ? (
          <>
            <MapPin size={16} /> Checking your location…
          </>
        ) : verify === 'verified' ? (
          <>
            <ShieldCheck size={16} /> Location verified · you&apos;re near this station
          </>
        ) : (
          <>
            <ShieldAlert size={16} /> Location not verified · you can still report
          </>
        )}
      </div>

      {/* Step 1 — Queue */}
      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Step 1 · How many vehicles are waiting?
        </div>
        <div className="chip-group">
          {QUEUE_OPTS.map((o) => (
            <Chip
              key={o.v}
              selected={queue === o.v}
              onClick={() => setQueue(o.v)}
              data-testid={`report-queue-${o.v}`}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Step 2 — Availability */}
      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Step 2 · Is CNG available right now?
        </div>
        <div className="chip-group">
          {AVAIL_OPTS.map((o) => (
            <Chip
              key={o.v}
              selected={availability === o.v}
              onClick={() => setAvailability(o.v)}
              data-testid={`report-avail-${o.v}`}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Optional pressure */}
      <div className="field">
        <label htmlFor="report-pressure">Pressure shown at pump (optional)</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            id="report-pressure"
            className="input"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 205"
            value={pressure}
            onChange={(e) => setPressure(e.target.value)}
            data-testid="report-pressure"
            style={{ maxWidth: 140 }}
          />
          <span className="muted">bar</span>
        </div>
      </div>

      <div className="hint">
        <CheckCircle2 size={16} />
        Community reports help other drivers. They&apos;re combined with other
        updates before affecting a station&apos;s confidence.
      </div>
    </BottomSheet>
  );
}
