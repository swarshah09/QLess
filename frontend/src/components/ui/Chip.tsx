import { cn } from '@/utils/cn';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected, className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn('chip', selected && 'is-selected', className)}
      aria-pressed={selected}
      {...rest}
    >
      {children}
    </button>
  );
}
