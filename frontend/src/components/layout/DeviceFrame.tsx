import { cn } from '@/utils/cn';

// Centers the customer app in a mobile-width "device" on desktop.
// `wide` opts out for operator/admin surfaces.
export function DeviceFrame({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn('frame', wide && 'frame--wide')}>
      <div className="frame__device">
        {children}
        <div id="sheet-root" />
      </div>
    </div>
  );
}
