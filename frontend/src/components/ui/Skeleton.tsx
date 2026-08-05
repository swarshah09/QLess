import { cn } from '@/utils/cn';

interface Props {
  width?: string | number;
  height?: string | number;
  radius?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width, height = 16, radius, className, style }: Props) {
  return (
    <span
      className={cn('skeleton', className)}
      style={{
        display: 'block',
        width: width ?? '100%',
        height,
        borderRadius: radius,
        ...style,
      }}
      aria-hidden
    />
  );
}

export function StationCardSkeleton() {
  return (
    <div className="card" data-testid="station-card-skeleton">
      <div className="station-card">
        <div className="station-card__top">
          <div style={{ flex: 1 }}>
            <Skeleton width="60%" height={18} />
            <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
          </div>
          <Skeleton width={90} height={24} radius={999} />
        </div>
        <div className="station-card__grid">
          <Skeleton height={44} radius={8} />
          <Skeleton height={44} radius={8} />
          <Skeleton height={44} radius={8} />
        </div>
        <Skeleton height={44} radius={12} />
      </div>
    </div>
  );
}
