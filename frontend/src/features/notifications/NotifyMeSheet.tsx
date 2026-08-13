'use client';

import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import type { NotificationConditions, NotificationRule, Station } from '@/types';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Toggle } from '@/components/ui/Toggle';
import { NotificationService } from '@/services/NotificationService';
import { useToast } from '@/hooks/ToastContext';
import { DEFAULT_CONDITIONS, ruleSummaryLines } from './rule';

interface Props {
  open: boolean;
  station: Station | null;
  existing?: NotificationRule | null;
  onClose: () => void;
  onSaved?: () => void;
}

const QUEUE_PRESETS = [3, 5, 10];
const WAIT_PRESETS = [5, 10, 15];

export function NotifyMeSheet({ open, station, existing, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [conditions, setConditions] = useState<NotificationConditions>(
    DEFAULT_CONDITIONS,
  );
  const [customQueue, setCustomQueue] = useState(false);
  const [usePressure, setUsePressure] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const base = existing?.conditions ?? DEFAULT_CONDITIONS;
      setConditions(base);
      setCustomQueue(
        base.maxQueue != null && !QUEUE_PRESETS.includes(base.maxQueue),
      );
      setUsePressure(base.minPressure != null);
      setSaving(false);
    }
  }, [open, existing]);

  const patch = (p: Partial<NotificationConditions>) =>
    setConditions((c) => ({ ...c, ...p }));

  async function handleCreate() {
    if (!station) return;
    setSaving(true);

    // Only ask for browser permission when the user actually creates an alert.
    const perm = await NotificationService.requestPermission();

    let pushReady = false;
    if (perm === 'granted') {
      // Register the device so the backend has somewhere to deliver to.
      await NotificationService.registerServiceWorker();
      pushReady = await NotificationService.ensurePushSubscription();
    }

    const finalConditions: NotificationConditions = {
      ...conditions,
      minPressure: usePressure ? conditions.minPressure : undefined,
    };

    try {
      if (existing) {
        await NotificationService.updateRule(existing.id, finalConditions);
      } else {
        await NotificationService.createRule(station.id, station.name, finalConditions);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Could not save the alert';
      toast(message, 'error');
      setSaving(false);
      return;
    }

    if (perm === 'denied' || perm === 'unsupported') {
      toast('Alert saved. Enable notifications to get pinged.', 'default');
    } else if (!pushReady) {
      // The rule is live and will still be evaluated; only delivery is missing.
      toast('Alert saved. Push delivery is unavailable on this device.', 'default');
    } else {
      toast(existing ? 'Alert updated' : "Alert created — we'll notify you", 'success');
    }

    setSaving(false);
    onSaved?.();
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Tell me when it's a good time"
      description={
        station
          ? `We'll notify you when ${station.name} matches your conditions.`
          : undefined
      }
      testId="notify-sheet"
      footer={
        <Button
          block
          size="lg"
          onClick={handleCreate}
          disabled={saving}
          data-testid="create-alert-btn"
        >
          <Bell size={18} />
          {saving ? 'Saving…' : existing ? 'Update alert' : 'Create alert'}
        </Button>
      }
    >
      {/* QUEUE */}
      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Notify when queue is
        </div>
        <div className="chip-group">
          {QUEUE_PRESETS.map((q) => (
            <Chip
              key={q}
              selected={!customQueue && conditions.maxQueue === q}
              onClick={() => {
                setCustomQueue(false);
                patch({ maxQueue: q });
              }}
              data-testid={`queue-preset-${q}`}
            >
              ≤ {q}
            </Chip>
          ))}
          <Chip
            selected={customQueue}
            onClick={() => setCustomQueue(true)}
            data-testid="queue-custom"
          >
            Custom
          </Chip>
        </div>
        {customQueue && (
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Max queue</span>
              <strong style={{ fontFamily: 'var(--font-heading)' }}>
                {conditions.maxQueue ?? 5} cars
              </strong>
            </div>
            <input
              className="slider"
              type="range"
              min={1}
              max={25}
              value={conditions.maxQueue ?? 5}
              onChange={(e) => patch({ maxQueue: Number(e.target.value) })}
              data-testid="queue-slider"
              style={{ marginTop: 8 }}
            />
          </div>
        )}
      </div>

      {/* WAIT */}
      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Wait time
        </div>
        <div className="chip-group">
          {WAIT_PRESETS.map((w) => (
            <Chip
              key={w}
              selected={conditions.maxWaitMinutes === w}
              onClick={() =>
                patch({
                  maxWaitMinutes: conditions.maxWaitMinutes === w ? undefined : w,
                })
              }
              data-testid={`wait-preset-${w}`}
            >
              ≤ {w} min
            </Chip>
          ))}
        </div>
      </div>

      {/* CNG availability */}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Only when CNG is available</div>
          <div className="muted" style={{ fontSize: 13 }}>
            Skip alerts during interruptions
          </div>
        </div>
        <Toggle
          checked={conditions.onlyWhenAvailable}
          onChange={(v) => patch({ onlyWhenAvailable: v })}
          testId="cng-toggle"
        />
      </div>

      {/* Pressure */}
      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Minimum pressure</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Optional
            </div>
          </div>
          <Toggle
            checked={usePressure}
            onChange={(v) => {
              setUsePressure(v);
              if (v && conditions.minPressure == null) patch({ minPressure: 180 });
            }}
            testId="pressure-toggle"
          />
        </div>
        {usePressure && (
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">At least</span>
              <strong style={{ fontFamily: 'var(--font-heading)' }}>
                {conditions.minPressure ?? 180} bar
              </strong>
            </div>
            <input
              className="slider"
              type="range"
              min={100}
              max={250}
              step={5}
              value={conditions.minPressure ?? 180}
              onChange={(e) => patch({ minPressure: Number(e.target.value) })}
              data-testid="pressure-slider"
              style={{ marginTop: 8 }}
            />
          </div>
        )}
      </div>

      {/* Summary */}
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          padding: 14,
        }}
        data-testid="rule-summary"
      >
        <div className="overline" style={{ marginBottom: 8 }}>
          Alert me when
        </div>
        <div className="rule-summary" style={{ margin: 0 }}>
          {ruleSummaryLines({
            ...conditions,
            minPressure: usePressure ? conditions.minPressure : undefined,
          }).map((line) => (
            <div className="rule-line" key={line}>
              <Check size={16} /> {line}
            </div>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
