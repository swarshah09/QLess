'use client';

import { useEffect, useState } from 'react';
import { BottomNav } from '@/components/layout/BottomNav';
import { NotificationService } from '@/services/NotificationService';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    NotificationService.listRules().then((rules) =>
      setCount(rules.filter((r) => r.status === 'ACTIVE').length),
    );
  }, []);

  return (
    <div className="shell">
      <div className="shell__scroll" data-testid="app-scroll">
        {children}
      </div>
      <BottomNav alertCount={count} />
    </div>
  );
}
