import { IconButton, type IconButtonProps } from './Button';
import { MoonIcon, SunIcon, SystemThemeIcon, type Icon } from './icons';
import { Menu, MenuItem } from './Menu';
import { useThemePreference, type ThemePreference } from './themePreference';
import { Tooltip } from './Tooltip';

const CHOICES: Record<ThemePreference, { label: string; icon: Icon }> = {
  light: { label: 'فاتح', icon: SunIcon },
  dark: { label: 'داكن', icon: MoonIcon },
  system: { label: 'حسب الجهاز', icon: SystemThemeIcon },
};

const ORDER: readonly ThemePreference[] = ['light', 'dark', 'system'];

export interface ThemeToggleProps {
  /** The button's edge the menu lines up with. Default end: top bars keep it at their end. */
  align?: 'start' | 'end';
  /** The icon button's size; the density's by default. */
  size?: IconButtonProps['size'];
  className?: string;
}

/**
 * The theme switch of the top bars (هوية 4 › الوضع الداكن): an icon button showing the current
 * choice (sun, moon, screen) that opens «فاتح», «داكن» and «حسب الجهاز» (tab 14's words). The
 * choice applies at once, is kept on this device, and reaches the app's other open tabs, those
 * without this switch too when the app root runs useThemeSync. Its hint stays away while the menu
 * is open (Tooltip), so it never covers the first choice.
 */
export function ThemeToggle({ align = 'end', size, className }: ThemeToggleProps) {
  const [preference, setPreference] = useThemePreference();
  const current = CHOICES[preference];
  const CurrentIcon = current.icon;
  return (
    <Menu
      label="المظهر"
      align={align}
      trigger={
        <Tooltip content={`المظهر: ${current.label}`} side="bottom">
          <IconButton label="تبديل المظهر" icon={<CurrentIcon />} size={size} className={className} />
        </Tooltip>
      }
    >
      {ORDER.map((value) => {
        const ChoiceIcon = CHOICES[value].icon;
        return (
          <MenuItem
            key={value}
            icon={<ChoiceIcon />}
            checked={preference === value}
            onSelect={() => setPreference(value)}
          >
            {CHOICES[value].label}
          </MenuItem>
        );
      })}
    </Menu>
  );
}
