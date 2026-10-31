// @serva/ui: the one design source of tab 14. Tokens and base styles are in './theme.css', the
// fonts in './fonts.css'; everything a screen draws comes from these exports.

export { cn } from './cn';
export {
  CONTROL_HEIGHT,
  DensityProvider,
  DigitsProvider,
  ROW_HEIGHT,
  useDensity,
  useDigits,
  type Density,
  type Digits,
  type PolymorphicProps,
} from './context';
export * from './icons';

export { AppIcon, Logo, LOGO_S_PATH, LogoMark, LogoStacked } from './Logo';
export { Spinner } from './Spinner';
export { FullScreenLoader } from './FullScreenLoader';

export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonProps,
} from './Button';
export { TextLink, textLinkClass } from './TextLink';

export { TextField, type TextFieldProps } from './TextField';
export { PasswordField } from './PasswordField';
export {
  canonicalNumber,
  displayNumber,
  MoneyField,
  NumberField,
  type MoneyFieldProps,
  type NumberFieldProps,
} from './NumberField';
export { Select, type SelectProps } from './Select';
export { SearchField, type SearchFieldProps } from './SearchField';
export {
  Checkbox,
  Radio,
  RadioGroup,
  type CheckboxProps,
  type RadioGroupProps,
  type RadioProps,
} from './Checkbox';
export { Switch, type SwitchProps } from './Switch';
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from './SegmentedControl';
export { ChoiceCard } from './ChoiceCard';
export { ToggleChip } from './ToggleChip';
export { FieldError } from './FieldError';
export { FieldGroup } from './FieldGroup';

export { Badge, ConnectionPill, StatusChip, STATUSES, type BadgeTone, type Status } from './Badge';
export { Alert } from './Alert';
export { Banner, type BannerProps, type BannerTone } from './Banner';
export { TestModeRibbon, type TestModeRibbonProps } from './TestModeRibbon';
export { Card, CardHeader, StatTile, type CardProps, type StatTileProps } from './Card';
export { DataTable, type DataColumn, type DataTableProps } from './DataTable';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { Dialog, Sheet, type DialogProps, type SheetProps } from './Dialog';
export { TOAST_DURATION_MS, ToastProvider, useToast, type ToastOptions, type ToastTone } from './Toast';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Skeleton, SkeletonText } from './Skeleton';
export { Avatar, initialsOf, type AvatarProps } from './Avatar';
export { Money, type MoneyProps } from './Money';

export { CartLine, formatQuantity, type CartLineProps } from './cashier/CartLine';
export { ItemTile, type ItemTileProps } from './cashier/ItemTile';
export { Keypad, type KeypadProps } from './cashier/Keypad';
export { TotalPanel, type TotalPanelProps } from './cashier/TotalPanel';

export { AdminShell, NavGroup, NavItem, navItemClass, type AdminShellProps } from './shells/AdminShell';
export { CashierShell, CashierStatusBar, type CashierShellProps } from './shells/CashierShell';
export { PhoneShell, PhoneTab, type PhoneShellProps } from './shells/PhoneShell';
