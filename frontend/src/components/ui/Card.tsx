import { cn } from '@/utils/cn';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  tappable?: boolean;
  as?: 'div' | 'article' | 'section';
}

export function Card({ tappable, className, children, as = 'div', ...rest }: Props) {
  const Tag = as;
  return (
    <Tag className={cn('card', tappable && 'card--tap', className)} {...rest}>
      {children}
    </Tag>
  );
}
