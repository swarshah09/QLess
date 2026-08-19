'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellOff, CheckCheck } from 'lucide-react';
import type { NotificationRule, Station } from '@/types';
import { NotificationService } from '@/services/NotificationService';
import { StationService } from '@/services/StationService';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { AlertCard } from '@/features/notifications/AlertCard';
import { NotifyMeSheet } from '@/features/notifications/NotifyMeSheet';
import { useSheets } from '@/hooks/SheetsContext';
import { useToast } from '@/hooks/ToastContext';

type Tab = 'active' | 'triggered';

export default function AlertsPage() {
  const { toast } = useToast();
  const { openNavigate } = useSheets();
  const [tab, setTab] = useState<Tab>('active');
  const [rules, setRules] = useState<NotificationRule[] | null>(null);
  const [editing, setEditing] = useState<{ rule: NotificationRule; station: Station } | null>(null);
  const [deleting, setDeleting] = useState<NotificationRule | null>(null);

  const load = useCallback(async () => {
    setRules(await NotificationService.listRules());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = rules?.filter((r) => r.status !== 'TRIGGERED') ?? [];
  const triggered = rules?.filter((r) => r.status === 'TRIGGERED') ?? [];
  const list = tab === 'active' ? active : triggered;

  async function handleEdit(rule: NotificationRule) {
    const station = await StationService.getStation(rule.stationId);
    if (station) setEditing({ rule, station });
  }

  async function handleToggle(rule: NotificationRule) {
    const next = rule.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
    await NotificationService.setStatus(rule.id, next);
    toast(next === 'PAUSED' ? 'Alert paused' : 'Alert resumed');
    load();
  }

  async function confirmDelete() {
    if (!deleting) return;
    await NotificationService.deleteRule(deleting.id);
    setDeleting(null);
    toast('Alert deleted');
    load();
  }

  async function handleNavigate(rule: NotificationRule) {
    const station = await StationService.getStation(rule.stationId);
    if (station) openNavigate(station);
  }

  return (
    <div data-testid="alerts-page" className="page-inset">
      <h1 className="page-title">Alerts</h1>
      <p className="page-sub">Get pinged the moment a station is worth the drive.</p>

      <SegmentedControl
        block
        testId="alerts-tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: `Active${active.length ? ` (${active.length})` : ''}` },
          { value: 'triggered', label: `Triggered${triggered.length ? ` (${triggered.length})` : ''}` },
        ]}
      />

      <div className="list" style={{ marginTop: 18 }}>
        {rules === null ? (
          <>
            <Skeleton height={140} radius={16} />
            <Skeleton height={140} radius={16} />
          </>
        ) : list.length === 0 ? (
          tab === 'active' ? (
            <EmptyState
              icon={<BellOff size={26} />}
              title="No active alerts"
              text="Create an alert from any station and we'll notify you when it's a good time."
              testId="empty-active-alerts"
            />
          ) : (
            <EmptyState
              icon={<CheckCheck size={26} />}
              title="Nothing triggered yet"
              text="When a station matches your conditions, it'll show up here."
              testId="empty-triggered-alerts"
            />
          )
        ) : (
          list.map((rule) => (
            <AlertCard
              key={rule.id}
              rule={rule}
              onEdit={handleEdit}
              onToggle={handleToggle}
              onDelete={setDeleting}
              onNavigate={handleNavigate}
            />
          ))
        )}
      </div>

      <NotifyMeSheet
        open={editing !== null}
        station={editing?.station ?? null}
        existing={editing?.rule ?? null}
        onClose={() => setEditing(null)}
        onSaved={load}
      />

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this alert?"
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        testId="delete-alert-modal"
      >
        <p>You won&apos;t be notified about {deleting?.stationName} anymore.</p>
      </Modal>
    </div>
  );
}
