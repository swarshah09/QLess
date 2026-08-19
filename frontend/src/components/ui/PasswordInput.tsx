'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  'data-testid'?: string;
}

/**
 * Password field with a show/hide toggle.
 *
 * The toggle is a plain state flip on the input's `type`, not a separate
 * shadow input — swapping `type` keeps focus, cursor position and any
 * password-manager binding intact, which re-mounting a second input would lose.
 */
export function PasswordInput({ className, 'data-testid': testId, ...rest }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={`input password-input__field${className ? ` ${className}` : ''}`}
        data-testid={testId}
      />
      <button
        type="button"
        className="password-input__toggle"
        onClick={() => setVisible((v) => !v)}
        // Announces the ACTION the button performs, not the current state —
        // matches how screen readers expect a toggle button to be labelled.
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        // Typing focus never leaves the field just to reveal it.
        tabIndex={-1}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
