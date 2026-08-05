'use client';

import Link from 'next/link';
import { Bell, CheckCircle2, Navigation2, Pencil, Play, Pause, Trash2 } from 'lucide-react';
import type { NotificationRule } from '@/types';
import { Card } from '@/components/ui/Card';
import { relativeTime } from '@/lib/status';
import { ruleSummaryLines } from './rule';

interface Props {
  rule: NotificationRule;
  onEdit?: (r: NotificationRule) => void;
  onToggle?: (r: NotificationRule) => void;
  onDelete?: (r: NotificationRule) => void;
  onNavigate?: (r: NotificationRule) => void;
}

export function AlertCard({ rule, onEdit, onToggle, onDelete, onNavigate }: Props) {
  const triggered = rule.status === 'TRIGGERED';
  const paused = rule.status === 'PAUSED';

  return (
    <Card data-testid={`alert-card-${rule.id}`}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <Link
          href={`/app/station/${rule.stationId}`}
          style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16 }}
        >
          {rule.stationName}
        </Link>
        {triggered ? (
          <span className="badge badge--available">
            <CheckCircle2 size={13} /> GOOD TIME
          </span>
        ) : paused ? (
          <span className="badge badge--outline">PAUSED</span>
        ) : (
          <span className="badge badge--recent">
            <Bell size={12} /> ACTIVE
          </span>
        )}
      </div>

      {triggered ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 700, color: 'var(--tone-available)' }}>
            Good time to refuel
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            Triggered {relativeTime(rule.triggeredAt ?? rule.createdAt)}
          </div>
        </div>
      ) : (
        <div className="rule-summary">
          <div className="overline" style={{ marginBottom: 2 }}>
            Notify when
          </div>
          {ruleSummaryLines(rule.conditions).map((line) => (
            <div className="rule-line" key={line}>
              <CheckCircle2 size={15} /> {line}
            </div>
          ))}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 4 }}>
        {triggered ? (
          <button
            className="btn btn--primary btn--sm"
            onClick={() => onNavigate?.(rule)}
            data-testid={`alert-navigate-${rule.id}`}
          >
            <Navigation2 size={16} /> Navigate
          </button>
        ) : (
          <>
            <button
              className="btn btn--outline btn--sm"
              onClick={() => onEdit?.(rule)}
              data-testid={`alert-edit-${rule.id}`}
            >
              <Pencil size={15} /> Edit
            </button>
            <button
              className="btn btn--outline btn--sm"
              onClick={() => onToggle?.(rule)}
              data-testid={`alert-toggle-${rule.id}`}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          </>
        )}
        <button
          className="btn btn--danger btn--sm"
          onClick={() => onDelete?.(rule)}
          data-testid={`alert-delete-${rule.id}`}
          aria-label="Delete alert"
          style={{ flex: '0 0 auto' }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </Card>
  );
}
