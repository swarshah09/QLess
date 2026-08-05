'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';
import { Button } from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  destructive?: boolean;
  testId?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  destructive,
  testId,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
  }, [open]);

  if (!mounted || !open) return null;
  const target = document.getElementById('sheet-root') ?? document.body;

  return createPortal(
    <div
      className={cn('modal-overlay', visible && 'is-open')}
      onClick={onClose}
      data-testid={testId ? `${testId}-overlay` : 'modal-overlay'}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <h3>{title}</h3>
        {children}
        <div className="btn-row" style={{ marginTop: 18 }}>
          <Button variant="outline" onClick={onClose} data-testid="modal-cancel">
            Cancel
          </Button>
          {confirmLabel && (
            <Button
              variant={destructive ? 'danger' : 'primary'}
              onClick={onConfirm}
              data-testid="modal-confirm"
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    target,
  );
}
