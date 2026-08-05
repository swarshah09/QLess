import { AlertTriangle, WifiOff } from 'lucide-react';
import { Button } from './Button';

interface Props {
  title?: string;
  text?: string;
  offline?: boolean;
  onRetry?: () => void;
  testId?: string;
}

export function ErrorState({ title, text, offline, onRetry, testId }: Props) {
  return (
    <div className="state" data-testid={testId ?? 'error-state'}>
      <div className="state__icon" style={{ color: 'var(--tone-interrupted)' }}>
        {offline ? <WifiOff size={28} /> : <AlertTriangle size={28} />}
      </div>
      <div className="state__title">
        {title ?? (offline ? "You're offline" : 'Something went wrong')}
      </div>
      <p className="state__text">
        {text ??
          (offline
            ? 'Check your connection. Cached info may be out of date.'
            : "We couldn't load this right now. Please try again.")}
      </p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} data-testid="error-retry">
          Try again
        </Button>
      )}
    </div>
  );
}
