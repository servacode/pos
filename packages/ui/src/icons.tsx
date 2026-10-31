import type { ReactNode } from 'react';
import {
  Archive,
  ArrowLeft,
  Banknote,
  Barcode,
  Bell,
  Camera,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Clock,
  Delete,
  Ellipsis,
  Eye,
  EyeOff,
  FolderTree,
  Gift,
  House,
  Inbox,
  Info,
  KeyRound,
  Link,
  LockKeyhole,
  LogOut,
  Menu,
  Minus,
  Monitor,
  MonitorSmartphone,
  Package,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Scale,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Store,
  Tablet,
  Tag,
  Trash,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Undo2,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import { cn } from './cn';

// The one icon wrapper of tab 14 › الأيقونات: screens import functional names from here, never from
// lucide-react directly (ESLint refuses it in apps/). The wrapper sets the size and stroke and
// mirrors directional icons in RTL.

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

// Navigation and places
export const HomeIcon = defineIcon(House);
export const ProductsIcon = defineIcon(Package);
export const CustomersIcon = defineIcon(Users);
export const SalesIcon = defineIcon(Receipt);
export const ReportsIcon = defineIcon(ChartColumn);
export const SettingsIcon = defineIcon(Settings);
export const StoreIcon = defineIcon(Store);
export const InboxIcon = defineIcon(Inbox);
export const MenuIcon = defineIcon(Menu);
export const NotificationsIcon = defineIcon(Bell);

// Actions
export const LogoutIcon = defineIcon(LogOut, { directional: true });
export const BackIcon = defineIcon(ArrowLeft, { directional: true });
/** «التالي» and list-row disclosure: points to the reading end (left in Arabic, mirrored in LTR). */
export const NextIcon = defineIcon(ChevronLeft, { directional: true });
export const UndoIcon = defineIcon(Undo2, { directional: true });
export const SearchIcon = defineIcon(Search);
export const CloseIcon = defineIcon(X);
export const AddIcon = defineIcon(Plus);
export const RemoveIcon = defineIcon(Minus);
export const DeleteIcon = defineIcon(Trash);
export const MoreIcon = defineIcon(Ellipsis);
export const PrintIcon = defineIcon(Printer);
export const RetryIcon = defineIcon(RefreshCw);
export const ExpandIcon = defineIcon(ChevronDown);
export const EyeIcon = defineIcon(Eye);
export const EyeOffIcon = defineIcon(EyeOff);

// Status
export const CheckIcon = defineIcon(Check);
export const AlertCircleIcon = defineIcon(CircleAlert);
export const WarningIcon = defineIcon(TriangleAlert);
export const InfoIcon = defineIcon(Info);
export const CheckCircleIcon = defineIcon(CircleCheck);
/** Trends follow the time axis, which runs right → left in Arabic (tab 14 › محور الزمن). */
export const TrendUpIcon = defineIcon(TrendingUp, { directional: true });
export const TrendDownIcon = defineIcon(TrendingDown, { directional: true });
export const ConnectedIcon = defineIcon(Wifi);
export const OfflineIcon = defineIcon(WifiOff);
export const ClockIcon = defineIcon(Clock);

// Things
export const GiftIcon = defineIcon(Gift);
export const LockIcon = defineIcon(LockKeyhole);
export const DeviceIcon = defineIcon(MonitorSmartphone);
export const CartIcon = defineIcon(ShoppingCart);
export const CashIcon = defineIcon(Banknote);
export const BarcodeIcon = defineIcon(Barcode);
export const WeighedIcon = defineIcon(Scale);
export const OfferIcon = defineIcon(Tag);
// The catalog (12 › المنتجات): the category tree, and the 30-day archive of products and categories.
export const CategoriesIcon = defineIcon(FolderTree);
export const ArchiveIcon = defineIcon(Archive);
// Lives on the keypad, which stays LTR (7 8 9 on top), so it always points left: not mirrored.
export const BackspaceIcon = defineIcon(Delete);

// Devices and linking (12 › ربط الجهاز)
export const QrCodeIcon = defineIcon(QrCode);
export const KeyIcon = defineIcon(KeyRound);
export const UserIcon = defineIcon(User);
export const PhoneIcon = defineIcon(Smartphone);
export const TabletIcon = defineIcon(Tablet);
export const MonitorIcon = defineIcon(Monitor);
export const CameraIcon = defineIcon(Camera);
export const LinkIcon = defineIcon(Link);
// A paper plane is an object, not a direction: never mirrored.
export const SendIcon = defineIcon(Send);
export const EditIcon = defineIcon(Pencil);
export const ShieldCheckIcon = defineIcon(ShieldCheck);
