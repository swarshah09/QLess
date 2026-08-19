'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useAuth } from '@/hooks/AuthContext';
import { useToast } from '@/hooks/ToastContext';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      await login(email, password);
      toast('Welcome back!', 'success');
      router.replace('/app/home');
    } catch (error) {
      // The backend returns one generic message for every credential failure,
      // so it is safe to surface verbatim.
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not sign in. Please try again.';
      toast(message, 'error');
    } finally {
      // Must reset on failure too, or the button stays stuck disabled.
      setLoading(false);
    }
  }

  return (
    <main className="landing" data-testid="login-page">
      <Link href="/" className="icon-btn" aria-label="Back" style={{ marginLeft: -10 }}>
        <ArrowLeft size={22} />
      </Link>

      <div className="landing__hero" style={{ justifyContent: 'flex-start', paddingTop: 12 }}>
        <div className="landing__brand" style={{ marginBottom: 8 }}>
          <Logo />
          QLess
        </div>
        <h1 style={{ fontSize: 28 }}>Welcome back</h1>
        <p className="landing__sub">Log in to manage your alerts and saved stations.</p>

        <form onSubmit={submit} className="stack" style={{ gap: 14, marginTop: 12 }}>
          <div className="field">
            <label htmlFor="email">Email or phone</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
            />
          </div>
          <Button
            size="lg"
            block
            type="submit"
            disabled={loading || !email || !password}
            data-testid="login-submit"
          >
            {loading ? 'Logging in…' : 'Login'}
          </Button>
        </form>
      </div>

      <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
        Demo mode — any email &amp; password works.
      </p>
    </main>
  );
}
