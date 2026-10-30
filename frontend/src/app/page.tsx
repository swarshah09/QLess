'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Bell, Gauge, LogIn, MapPin, Navigation2, UserPlus } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { AuthSheet } from '@/features/auth/AuthSheet';
import { useAuth } from '@/hooks/AuthContext';

// Live-feeling snapshots — the hero card ticks through these so the queue
// visibly shrinks, telling the "know before you queue" story at a glance.
const SNAPSHOTS = [
  { q: 12, w: 22 },
  { q: 9, w: 16 },
  { q: 6, w: 11 },
  { q: 4, w: 8 },
];

export default function LandingPage() {
  const router = useRouter();
  const { ready, user, isGuest, continueAsGuest } = useAuth();

  const [idx, setIdx] = useState(0);
  const [bump, setBump] = useState(false);
  const [authSheet, setAuthSheet] = useState<'signin' | 'signup' | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (ready && (user || isGuest)) router.replace('/app/home');
  }, [ready, user, isGuest, router]);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    timer.current = setInterval(() => {
      setIdx((i) => (i + 1) % SNAPSHOTS.length);
      setBump(true);
      setTimeout(() => setBump(false), 400);
    }, 1900);
    return () => clearInterval(timer.current);
  }, []);

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

  const snap = SNAPSHOTS[idx];
  const fill = Math.round((snap.q / 12) * 100);

  return (
    <main className="lp" data-testid="landing-page">
      <div className="lp__top">
        <div className="lp__brand">
          <Logo />
          QLess
        </div>
        <span className="lp__livepill">
          <span className="dot-live" /> LIVE
        </span>
      </div>

      {/* Animated hero stage */}
      <div className="lp__stage">
        <div className="lp__radar" aria-hidden>
          <span className="lp__ring" />
          <span className="lp__ring" />
          <span className="lp__ring" />
        </div>

        <span className="lp__pin lp__pin--a" aria-hidden>
          <MapPin size={12} /> 1.8 km
        </span>
        <span className="lp__pin lp__pin--b" aria-hidden>
          <MapPin size={12} /> ABC CNG
        </span>
        <span className="lp__pin lp__pin--c" aria-hidden>
          <MapPin size={12} /> GreenFuel
        </span>

        <div className="lp__card" data-testid="hero-live-card">
          <div className="lp__card-top">
            <span className="lp__card-name">Shree CNG Station</span>
            <span className="lp__badge">● AVAILABLE</span>
          </div>

          <div className="lp__queue">
            <span className={`lp__queue-num${bump ? ' is-bump' : ''}`}>{snap.q}</span>
            <span className="lp__queue-label">
              cars in queue
              <br />~{snap.w} min wait
            </span>
          </div>

          <div className="lp__meter">
            <div className="lp__meter-fill" style={{ width: `${fill}%` }} />
          </div>

          <div className="lp__card-foot">
            <span>205 bar · High confidence</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="dot-live" /> just now
            </span>
          </div>
        </div>
      </div>

      {/* Copy */}
      <div className="lp__copy">
        <h1 className="lp__h1">
          Know Before
          <br />
          You <span className="accent">Queue.</span>
        </h1>
        <p className="lp__sub">
          Live CNG availability, queues and pressure near you.
        </p>

        <div className="lp__chips">
          <span className="lp__chip" style={{ animationDelay: '0.45s' }}>
            <Activity size={14} /> Live queues
          </span>
          <span className="lp__chip" style={{ animationDelay: '0.55s' }}>
            <Gauge size={14} /> Gas pressure
          </span>
          <span className="lp__chip" style={{ animationDelay: '0.65s' }}>
            <Bell size={14} /> Notify me
          </span>
        </div>
      </div>

      {/* CTAs */}
      <div className="lp__cta">
        <Button size="lg" block onClick={findNearMe} data-testid="find-cng-cta">
          <Navigation2 size={18} /> Find CNG Near Me
        </Button>
        {/* First-time visitors look for "sign up", returning ones for "sign in",
            so both are offered side by side. */}
        <div className="btn-row">
          <Button variant="secondary" onClick={() => setAuthSheet('signup')} data-testid="signup-cta">
            <UserPlus size={18} /> Sign up
          </Button>
          <Button variant="ghost" onClick={() => setAuthSheet('signin')} data-testid="login-cta">
            <LogIn size={18} /> Sign in
          </Button>
        </div>
      </div>

      {/* Signing in/up flips `user`, and the effect above then routes to /app/home. */}
      <AuthSheet
        open={authSheet !== null}
        initialMode={authSheet ?? 'signin'}
        onClose={() => setAuthSheet(null)}
      />
    </main>
  );
}
