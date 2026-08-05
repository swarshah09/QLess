'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bell,
  Bookmark,
  ChevronRight,
  LogOut,
  MapPin,
  Moon,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Toggle } from '@/components/ui/Toggle';
import { useAuth } from '@/hooks/AuthContext';
import { useTheme } from '@/hooks/ThemeContext';
import { useToast } from '@/hooks/ToastContext';
import { NotificationService } from '@/services/NotificationService';

export default function ProfilePage() {
  const router = useRouter();
  const { user, isGuest, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { toast } = useToast();
  const [confirmOut, setConfirmOut] = useState(false);
  const [pushOn, setPushOn] = useState(false);

  useEffect(() => {
    setPushOn(NotificationService.getPermissionState() === 'granted');
  }, []);

  const name = user?.name ?? 'Guest';
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');

  async function doLogout() {
    await logout();
    toast('Logged out');
    router.replace('/');
  }

  async function togglePush(v: boolean) {
    if (v) {
      const res = await NotificationService.requestPermission();
      setPushOn(res === 'granted');
      if (res === 'denied')
        toast('Notifications are blocked in your browser settings.', 'error');
    } else {
      toast('Manage this in your browser/site settings.');
    }
  }

  return (
    <div data-testid="profile-page" style={{ paddingTop: 8 }}>
      <h1 className="page-title">Profile</h1>
      <p className="page-sub">Manage your account and preferences.</p>

      <div className="profile-head">
        <div className="avatar">{initials.toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18 }}>
            {name}
          </div>
          <div className="muted" style={{ fontSize: 14 }}>
            {isGuest ? 'Browsing as guest' : user?.email}
          </div>
          {!isGuest && user?.phone && (
            <div className="muted" style={{ fontSize: 13 }}>
              {user.phone}
            </div>
          )}
        </div>
      </div>

      {isGuest && (
        <Link href="/login" style={{ display: 'block', marginBottom: 16 }}>
          <Button block data-testid="profile-login">
            Login to sync alerts
          </Button>
        </Link>
      )}

      <div className="overline" style={{ marginBottom: 8 }}>
        Notifications
      </div>
      <div className="menu" style={{ marginBottom: 20 }}>
        <div className="menu__item">
          <Bell size={20} />
          <span>Push notifications</span>
          <Toggle checked={pushOn} onChange={togglePush} testId="push-toggle" />
        </div>
        <div className="menu__item">
          {theme === 'light' ? <Sun size={20} /> : <Moon size={20} />}
          <span>Dark theme</span>
          <Toggle checked={theme === 'dark'} onChange={toggle} testId="dark-toggle" />
        </div>
      </div>

      <div className="overline" style={{ marginBottom: 8 }}>
        Your places
      </div>
      <div className="menu" style={{ marginBottom: 20 }}>
        <Link href="/app/saved" className="menu__item" data-testid="profile-saved">
          <Bookmark size={20} />
          <span>Saved stations</span>
          <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
        </Link>
        <Link href="/app/home" className="menu__item" data-testid="profile-location">
          <MapPin size={20} />
          <span>Location preferences</span>
          <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
        </Link>
      </div>

      <Button
        variant="outline"
        block
        onClick={() => setConfirmOut(true)}
        data-testid="logout-btn"
      >
        <LogOut size={18} /> Logout
      </Button>

      <Modal
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title="Log out of QLess?"
        confirmLabel="Logout"
        destructive
        onConfirm={doLogout}
        testId="logout-modal"
      >
        <p>You can log back in anytime. Your alerts stay saved on this device.</p>
      </Modal>
    </div>
  );
}
