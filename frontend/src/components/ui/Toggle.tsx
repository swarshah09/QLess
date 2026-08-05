'use client';

import { cn } from '@/utils/cn';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  testId?: string;
}

export function Toggle({ checked, onChange, label, testId }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn('toggle', checked && 'is-on')}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      style={{ background: 'none' }}
    >
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      {label && <span style={{ fontWeight: 600, fontSize: 15 }}>{label}</span>}
    </button>
  );
}
