'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/hooks/AuthContext';

export default function LandingPage() {
  const router = useRouter();
  const { ready, user, isGuest, continueAsGuest } = useAuth();

  // Returning authenticated / guest users skip the landing screen.
  useEffect(() => {
    if (ready && (user || isGuest)) router.replace('/app/home');
  }, [ready, user, isGuest, router]);

  if (!ready || user || isGuest) {
    return (
      <div className="center-loader">
        <Spinner />
      </div>
    );
  }

  function findNearMe() {
    continueAsGuest();
    router.push('/app/home');
  }

  return (
    <main className="landing" data-testid="landing-page">
      <div className="landing__brand">
        <Logo />
        QLess
      </div>

      <div className="landing__hero">
        <div className="landing__art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1765272088009-100c96a4cd4e?w=900&q=70&auto=format&fit=crop"
            alt="Clean fuel station"
            loading="eager"
          />
        </div>
        <h1>Know Before You Queue.</h1>
        <p className="landing__sub">
          Live CNG availability, queues and pressure near you.
        </p>
      </div>

      <div className="landing__cta">
        <Button size="lg" block onClick={findNearMe} data-testid="find-cng-cta">
          Find CNG Near Me
        </Button>
        <Link href="/login" style={{ display: 'block' }}>
          <Button variant="ghost" block data-testid="login-cta">
            Login
          </Button>
        </Link>
      </div>
    </main>
  );
}
