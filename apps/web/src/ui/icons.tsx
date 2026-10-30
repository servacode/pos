import type { ReactNode } from 'react';
import {
  ChartColumn,
  Check,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Gift,
  House,
  Info,
  LogOut,
  MessageCircle,
  Package,
  PackagePlus,
  Printer,
  Settings,
  ShoppingCart,
  UserPlus,
  Users,
  Warehouse,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import { cn } from '../lib/cn';

// The one icon wrapper of tab 14 › الأيقونات: screens import functional names from here, never from
// lucide-react directly. The wrapper sets the size and stroke and mirrors directional icons in RTL.

/** Icon sizes from tab 14; the stroke follows the size. */
export type IconSize = 16 | 20 | 24 | 32 | 48;

const STROKE: Record<IconSize, number> = { 16: 2, 20: 1.75, 24: 1.75, 32: 1.5, 48: 1.5 };

export interface IconProps extends Omit<LucideProps, 'ref' | 'size'> {
  size?: IconSize;
}

export type Icon = (props: IconProps) => ReactNode;

interface IconOptions {
  /**
   * Points a way or shows progress (arrows, next/back, undo, sign in/out, text alignment), so it
   * is mirrored when the page is RTL. Checks, clocks, barcodes, currency and real objects are not.
   */
  directional?: boolean;
}

function defineIcon(Glyph: LucideIcon, { directional = false }: IconOptions = {}): Icon {
  return function ServaIcon({ size = 20, strokeWidth, className, ...props }: IconProps) {
    return (
      <Glyph
        size={size}
        strokeWidth={strokeWidth ?? STROKE[size]}
        aria-hidden="true"
        focusable="false"
        className={cn('shrink-0', directional && 'rtl:-scale-x-100', className)}
        {...props}
      />
    );
  };
}

export const HomeIcon = defineIcon(House);
export const CartIcon = defineIcon(ShoppingCart);
export const PackageIcon = defineIcon(Package);
export const WarehouseIcon = defineIcon(Warehouse);
export const UsersIcon = defineIcon(Users);
export const ChartIcon = defineIcon(ChartColumn);
export const SettingsIcon = defineIcon(Settings);
export const LogoutIcon = defineIcon(LogOut, { directional: true });
export const EyeIcon = defineIcon(Eye);
export const EyeOffIcon = defineIcon(EyeOff);
export const CheckIcon = defineIcon(Check);
export const AlertCircleIcon = defineIcon(CircleAlert);
export const InfoIcon = defineIcon(Info);
export const CheckCircleIcon = defineIcon(CircleCheck);
export const GiftIcon = defineIcon(Gift);
export const PackagePlusIcon = defineIcon(PackagePlus);
export const UserPlusIcon = defineIcon(UserPlus);
export const PrinterIcon = defineIcon(Printer);
export const MessageIcon = defineIcon(MessageCircle);
