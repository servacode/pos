import { useState } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';
import { TextField, type TextFieldProps } from './TextField';

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'endAdornment'>) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOffIcon : EyeIcon;

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      endAdornment={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label="أظهر كلمة السر"
          aria-pressed={visible}
          className="me-1 grid size-11 shrink-0 place-items-center rounded-[0.625rem] text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <Icon />
        </button>
      }
    />
  );
}
