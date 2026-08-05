'use client';

import { cn } from '@/utils/cn';

interface Option<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  block?: boolean;
  testId?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  block,
  testId,
}: Props<T>) {
  return (
    <div
      className={cn('segmented', block && 'segmented--block')}
      role="tablist"
      data-testid={testId}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          type="button"
          aria-selected={value === opt.value}
          className={cn('segmented__option', value === opt.value && 'is-active')}
          onClick={() => onChange(opt.value)}
          data-testid={`${testId}-${opt.value}`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
