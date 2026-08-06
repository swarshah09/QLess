'use client';

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import type { SortKey, StationFilters } from '@/types';

interface Props {
  open: boolean;
  sort: SortKey;
  filters: StationFilters;
  onApply: (sort: SortKey, filters: StationFilters) => void;
  onClose: () => void;
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'nearest', label: 'Nearest first' },
  { key: 'wait', label: 'Shortest wait' },
  { key: 'queue', label: 'Shortest queue' },
  { key: 'updated', label: 'Recently updated' },
];

const QUEUE_OPTS = [
  { v: 3, label: 'Almost empty' },
  { v: 7, label: 'Short queue' },
  { v: 15, label: '≤ 15 vehicles' },
];
const WAIT_OPTS = [5, 10, 15];
const DIST_OPTS = [2, 5, 10, 20];

export function SortFilterSheet({ open, sort, filters, onApply, onClose }: Props) {
  const [s, setS] = useState<SortKey>(sort);
  const [f, setF] = useState<StationFilters>(filters);

  useEffect(() => {
    if (open) {
      setS(sort);
      setF(filters);
    }
  }, [open, sort, filters]);

  const toggle = <K extends keyof StationFilters>(key: K, value: StationFilters[K]) =>
    setF((prev) => ({ ...prev, [key]: prev[key] === value ? undefined : value }));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Sort & Filter"
      testId="sortfilter-sheet"
      footer={
        <div className="btn-row">
          <Button
            variant="outline"
            onClick={() => {
              setS('nearest');
              setF({});
            }}
            data-testid="filter-reset"
          >
            Reset
          </Button>
          <Button onClick={() => onApply(s, f)} data-testid="filter-apply">
            Show stations
          </Button>
        </div>
      }
    >
      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Sort by
        </div>
        <div className="chip-group">
          {SORTS.map((o) => (
            <Chip
              key={o.key}
              selected={s === o.key}
              onClick={() => setS(o.key)}
              data-testid={`sort-${o.key}`}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          CNG status
        </div>
        <div className="chip-group">
          <Chip
            selected={!!f.availableOnly}
            onClick={() => toggle('availableOnly', true)}
            data-testid="filter-available-only"
          >
            Available only
          </Chip>
          <Chip
            selected={!!f.normalPressureOnly}
            onClick={() => toggle('normalPressureOnly', true)}
            data-testid="filter-normal-pressure"
          >
            Good pressure
          </Chip>
        </div>
      </div>

      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Queue
        </div>
        <div className="chip-group">
          {QUEUE_OPTS.map((o) => (
            <Chip
              key={o.v}
              selected={f.maxQueue === o.v}
              onClick={() => toggle('maxQueue', o.v)}
              data-testid={`filter-queue-${o.v}`}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Wait time
        </div>
        <div className="chip-group">
          {WAIT_OPTS.map((w) => (
            <Chip
              key={w}
              selected={f.maxWaitMinutes === w}
              onClick={() => toggle('maxWaitMinutes', w)}
              data-testid={`filter-wait-${w}`}
            >
              ≤ {w} min
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <div className="overline" style={{ marginBottom: 10 }}>
          Distance
        </div>
        <div className="chip-group">
          {DIST_OPTS.map((d) => (
            <Chip
              key={d}
              selected={f.maxDistanceKm === d}
              onClick={() => toggle('maxDistanceKm', d)}
              data-testid={`filter-distance-${d}`}
            >
              Within {d} km
            </Chip>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
