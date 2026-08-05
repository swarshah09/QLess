'use client';

import { Minus, Plus } from 'lucide-react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  testId?: string;
  editable?: boolean;
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 9999,
  suffix,
  testId,
  editable = true,
}: Props) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="stepper" data-testid={testId}>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(clamp(value - step))}
        aria-label="decrease"
        data-testid={testId ? `${testId}-dec` : undefined}
      >
        <Minus size={20} />
      </button>
      <div className="stepper__value">
        {editable ? (
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
            data-testid={testId ? `${testId}-input` : undefined}
            aria-label="value"
          />
        ) : (
          <span>{value}</span>
        )}
        {suffix && (
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            {' '}
            {suffix}
          </span>
        )}
      </div>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(clamp(value + step))}
        aria-label="increase"
        data-testid={testId ? `${testId}-inc` : undefined}
      >
        <Plus size={20} />
      </button>
    </div>
  );
}
