'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Info, X } from 'lucide-react';

type ToastTone = 'default' | 'success' | 'error';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastCtx {
  toast: (message: string, tone?: ToastTone) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const toast = useCallback((message: string, tone: ToastTone = 'default') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  const host =
    mounted && typeof document !== 'undefined'
      ? document.getElementById('sheet-root')
      : null;

  const overlay = (
    <div className="toast-wrap" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`} data-testid="toast">
          {t.tone === 'success' ? (
            <Check size={18} />
          ) : t.tone === 'error' ? (
            <X size={18} />
          ) : (
            <Info size={18} />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );

  // Showing or expiring a toast re-renders this provider; a stable value keeps
  // that from re-rendering every component that can raise one.
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {host ? createPortal(overlay, host) : null}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
