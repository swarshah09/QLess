'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
}

// Bottom sheet that mounts into the device frame so it stays within the
// centered mobile container on desktop.
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  testId,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
  }, [open]);

  if (!mounted || !open) return null;

  const target =
    document.getElementById('sheet-root') ?? document.body;

  return createPortal(
    <>
      <div
        className={cn('sheet-overlay', visible && 'is-open')}
        onClick={onClose}
        data-testid={testId ? `${testId}-overlay` : 'sheet-overlay'}
      />
      <div
        className={cn('sheet', visible && 'is-open')}
        role="dialog"
        aria-modal="true"
        data-testid={testId}
      >
        <div className="sheet__handle" />
        {(title || description) && (
          <div className="sheet__header">
            {title && <h3>{title}</h3>}
            {description && <p>{description}</p>}
          </div>
        )}
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </>,
    target,
  );
}
