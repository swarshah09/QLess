import { Button } from './Button';

interface Props {
  icon: React.ReactNode;
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}

export function EmptyState({ icon, title, text, actionLabel, onAction, testId }: Props) {
  return (
    <div className="state" data-testid={testId ?? 'empty-state'}>
      <div className="state__icon">{icon}</div>
      <div className="state__title">{title}</div>
      {text && <p className="state__text">{text}</p>}
      {actionLabel && onAction && (
        <Button variant="secondary" onClick={onAction} data-testid="empty-state-action">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
