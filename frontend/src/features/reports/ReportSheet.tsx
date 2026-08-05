'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { QueueRange, ReportAvailability, Station } from '@/types';
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
}

const QUEUE_OPTIONS: QueueRange[] = ['0-3', '4-7', '8-15', '16-25', '25+'];
const AVAIL: { value: ReportAvailability; label: string }[] = [
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'NOT_SURE', label: 'Not sure' },
];

export function ReportSheet({ open, station, onClose }: Props) {
  const { toast } = useToast();
  const [available, setAvailable] = useState<ReportAvailability | null>(null);
  const [queue, setQueue] = useState<QueueRange | null>(null);
  const [pressure, setPressure] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAvailable(null);
      setQueue(null);
      setPressure('');
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    if (!station || !available || !queue) return;
    setSaving(true);
    const verify = await LocationService.verifyNearby(station.id);
    await ReportService.submitQueueReport({
      stationId: station.id,
      available,
      queue,
      pressure: pressure ? Number(pressure) : null,
      verifiedNearby: verify.nearby,
    });
    toast('Thanks! Your report helps others.', 'success');
    setSaving(false);
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Report update"
      description="Takes less than 10 seconds"
      testId="report-sheet"
      footer={
        <Button
          block
          size="lg"
          onClick={submit}
          disabled={!available || !queue || saving}
          data-testid="report-submit"
        >
          {saving ? 'Submitting…' : 'Submit report'}
        </Button>
      }
    >
      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Is CNG available?
        </div>
        <div className="chip-group">
          {AVAIL.map((a) => (
            <Chip
              key={a.value}
              selected={available === a.value}
              onClick={() => setAvailable(a.value)}
              data-testid={`report-avail-${a.value}`}
            >
              {a.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          How&apos;s the queue?
        </div>
        <div className="chip-group">
          {QUEUE_OPTIONS.map((q) => (
            <Chip
              key={q}
              selected={queue === q}
              onClick={() => setQueue(q)}
              data-testid={`report-queue-${q}`}
            >
              {q}
            </Chip>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="report-pressure">Pressure shown at pump (optional)</label>
        <input
          id="report-pressure"
          className="input"
          type="number"
          inputMode="numeric"
          placeholder="e.g. 205"
          value={pressure}
          onChange={(e) => setPressure(e.target.value)}
          data-testid="report-pressure"
        />
      </div>

      <div className="hint">
        <MapPin size={16} />
        Your location will be used to verify that you&apos;re near the station.
      </div>
    </BottomSheet>
  );
}
