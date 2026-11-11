import { useState } from 'react';
import { useDensity } from './context';
import { EyeIcon, EyeOffIcon } from './icons';
import { FieldButton, TextField, type TextFieldProps } from './TextField';

/** A password with a show/hide toggle at the end of the box. */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'endAdornment'>) {
  const density = useDensity();
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOffIcon : EyeIcon;

  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      endAdornment={
        <FieldButton
          label="أظهر كلمة السر"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          icon={<Icon size={density === 'dense' ? 16 : 20} />}
        />
      }
    />
  );
}
