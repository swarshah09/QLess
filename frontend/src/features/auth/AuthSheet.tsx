'use client';

import { useEffect, useState } from 'react';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useAuth } from '@/hooks/AuthContext';
import { useToast } from '@/hooks/ToastContext';

type Mode = 'signin' | 'signup';

interface Props {
  open: boolean;
  /** Which form to show first — the caller decides based on what was tapped. */
  initialMode?: Mode;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Sign in / sign up in one sheet.
 *
 * Both flows live together because the distinction is only meaningful to
 * someone who already knows whether they have an account — switching between
 * them must not cost a navigation or lose what they have typed.
 */
export function AuthSheet({ open, initialMode = 'signin', onClose, onSuccess }: Props) {
  const { login, register } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
      setBusy(false);
    }
  }, [open, initialMode]);

  // Credentials carry over when switching, so a user who picked the wrong tab
  // does not have to retype anything.
  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const isSignup = mode === 'signup';

  /** Mirrors the backend rules so the user is told before a round trip. */
  function validate(): string | null {
    if (isSignup && name.trim().length < 2) return 'Please enter your name.';
    if (!email.trim()) return 'Please enter your email.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (!password) return 'Please enter your password.';
    if (isSignup && password.length < 10) {
      return 'Password must be at least 10 characters.';
    }
    if (isSignup && phone.trim() && !/^\+?[0-9]{7,15}$/.test(phone.trim())) {
      return 'Please enter a valid phone number, or leave it blank.';
    }
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (isSignup) {
        await register({
          name: name.trim(),
          email: email.trim(),
          password,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        });
        toast('Account created — welcome to QLess!', 'success');
      } else {
        await login(email.trim(), password);
        toast('Welcome back!', 'success');
      }

      setPassword('');
      onSuccess?.();
      onClose();
    } catch (err) {
      // The backend returns one generic message for credential failures and a
      // specific one for a taken email, so both are safe to show verbatim.
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      // Must reset on failure too, or the button stays stuck disabled.
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isSignup ? 'Create your account' : 'Welcome back'}
      description={
        isSignup
          ? 'Save stations, set alerts and report what you see.'
          : 'Log in to sync your alerts and saved stations.'
      }
      testId="auth-sheet"
    >
      <div className="stack" style={{ gap: 16 }}>
        {/* Tab switcher — the primary affordance for "already registered?" */}
        <div className="segmented segmented--block" role="tablist" aria-label="Sign in or sign up">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignup}
            className={`segmented__option${!isSignup ? ' is-active' : ''}`}
            onClick={() => switchMode('signin')}
            data-testid="auth-tab-signin"
          >
            <LogIn size={16} /> Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignup}
            className={`segmented__option${isSignup ? ' is-active' : ''}`}
            onClick={() => switchMode('signup')}
            data-testid="auth-tab-signup"
          >
            <UserPlus size={16} /> Sign up
          </button>
        </div>

        <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
          {isSignup && (
            <div className="field">
              <label htmlFor="auth-name">Name</label>
              <input
                id="auth-name"
                className="input"
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="auth-name"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="auth-email"
            />
          </div>

          {isSignup && (
            <div className="field">
              <label htmlFor="auth-phone">
                Phone <span className="muted">(optional)</span>
              </label>
              <input
                id="auth-phone"
                className="input"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+91 98000 00000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="auth-phone"
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <PasswordInput
              id="auth-password"
              // Tells password managers to offer saving vs filling.
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="auth-password"
            />
            {isSignup && (
              <span className="muted" style={{ fontSize: 13 }}>
                At least 10 characters.
              </span>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="hint"
              style={{ color: 'var(--tone-unavailable)' }}
              data-testid="auth-error"
            >
              {error}
            </div>
          )}

          <Button block size="lg" type="submit" disabled={busy} data-testid="auth-submit">
            {busy ? (
              <>
                <Loader2 size={18} className="spin" />
                {isSignup ? 'Creating account…' : 'Signing in…'}
              </>
            ) : isSignup ? (
              'Create account'
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <p className="muted" style={{ textAlign: 'center', fontSize: 14 }}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
            data-testid="auth-switch"
          >
            {isSignup ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </BottomSheet>
  );
}
