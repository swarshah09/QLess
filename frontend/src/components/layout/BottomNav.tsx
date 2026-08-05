'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Bookmark, Home, Map, User } from 'lucide-react';
import { cn } from '@/utils/cn';

const ITEMS = [
  { href: '/app/home', label: 'Home', icon: Home },
  { href: '/app/map', label: 'Map', icon: Map },
  { href: '/app/alerts', label: 'Alerts', icon: Bell },
  { href: '/app/saved', label: 'Saved', icon: Bookmark },
  { href: '/app/profile', label: 'Profile', icon: User },
];

export function BottomNav({ alertCount = 0 }: { alertCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" data-testid="bottom-nav">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn('bottom-nav__item', active && 'is-active')}
            data-testid={`nav-${label.toLowerCase()}`}
            aria-current={active ? 'page' : undefined}
          >
            <span style={{ position: 'relative' }}>
              <Icon size={22} strokeWidth={active ? 2.4 : 2} />
              {label === 'Alerts' && alertCount > 0 && (
                <span className="bottom-nav__badge">{alertCount}</span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
