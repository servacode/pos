import type { ReactNode } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  Banknote,
  Barcode,
  Bell,
  BookOpen,
  CalendarClock,
  Boxes,
  Camera,
  Carrot,
  Coffee,
  Croissant,
  Hammer,
  Pill,
  Accessibility,
  Gem,
  Handbag,
  Glasses,
  Watch,
  Baby,
  Snowflake,
  SportShoe,
  createLucideIcon,
  Bed,
  HeartPulse,
  SprayCan,
  Syringe,
  ShoppingBasket,
  Stethoscope,
  UtensilsCrossed,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  Clock,
  CreditCard,
  Delete,
  Ellipsis,
  Eye,
  EyeOff,
  FolderTree,
  Gift,
  Hash,
  House,
  ImageOff,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  LayoutGrid,
  Link,
  LockKeyhole,
  LogOut,
  Megaphone,
  Menu,
  Minus,
  Monitor,
  MonitorSmartphone,
  Moon,
  Package,
  PackageOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pencil,
  Percent,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Scale,
  Scissors,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Sun,
  Tablet,
  Tag,
  Trash,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Truck,
  Undo2,
  User,
  Users,
  Warehouse,
  Wifi,
  WifiOff,
  Wrench,
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

// Menu and dashboard glyphs (هوية 2): every menu item has its own picture.
export const TransferIcon = defineIcon(ArrowLeftRight);
export const CalendarIcon = defineIcon(CalendarClock);
export const SerialIcon = defineIcon(Hash);
export const ChequeIcon = defineIcon(Landmark);
export const MegaphoneIcon = defineIcon(Megaphone);
export const StockIcon = defineIcon(Warehouse);
export const PercentIcon = defineIcon(Percent);
export const ScissorsIcon = defineIcon(Scissors);
export const TruckIcon = defineIcon(Truck);
export const BookIcon = defineIcon(BookOpen);
export const CardIcon = defineIcon(CreditCard);
export const ListIcon = defineIcon(ClipboardList);
export const GridIcon = defineIcon(LayoutGrid);
export const SparklesIcon = defineIcon(Sparkles);
export const ShirtIcon = defineIcon(Shirt);
export const NoImageIcon = defineIcon(ImageOff);
export const PackageOpenIcon = defineIcon(PackageOpen);
export const PanelIcon = defineIcon(PanelRight);
export const WrenchIcon = defineIcon(Wrench);

// The activity (sector) icons of tab 14 › أيقونة كل نشاط. Clothing, electronics, cosmetics and the
// general shop reuse ShirtIcon, PhoneIcon, SparklesIcon and StoreIcon above.
export const SupermarketIcon = defineIcon(ShoppingBasket);
export const RestaurantIcon = defineIcon(UtensilsCrossed);
export const CafeIcon = defineIcon(Coffee);
export const PharmacyIcon = defineIcon(Pill);
export const BakeryIcon = defineIcon(Croissant);
export const BuildingMaterialsIcon = defineIcon(Hammer);
export const MedicalSuppliesIcon = defineIcon(Stethoscope);
export const ProduceIcon = defineIcon(Carrot);
export const WholesaleIcon = defineIcon(Boxes);

// What an item is (the placeholder of an item with no photo): shoes, jewellery, perfume, syringes, devices.
export const ShoeIcon = defineIcon(SportShoe);
export const SneakerIcon = ShoeIcon;

// Garments lucide has no picture for (round 13): drawn on the same 24 grid, same stroke, so they sit with the rest.
/** lucide wants a key on every part of a drawing */
function glyph(name: string, parts: [string, Record<string, string | number>][]): LucideIcon {
  return createLucideIcon(
    name,
    parts.map(([tag, attrs], i) => [tag, { ...attrs, key: `p${i}` }]) as Parameters<
      typeof createLucideIcon
    >[1],
  );
}
const Trousers = glyph('serva-trousers', [
  ['path', { d: 'M7 3h10l1.5 18h-5L12 10l-1.5 11h-5z' }],
  ['path', { d: 'M7.2 7h9.6' }],
]);
const Skirt = glyph('serva-skirt', [
  ['path', { d: 'M9 3h6l5.5 17h-17z' }],
  ['path', { d: 'M8.3 7h7.4' }],
  ['path', { d: 'M12 7v13' }],
]);
const Dress = glyph('serva-dress', [
  ['path', { d: 'M9 2l.5 5L8 10 3.5 21h17L16 10l-1.5-3L15 2' }],
  ['path', { d: 'M8 10h8' }],
]);
const Top = glyph('serva-top', [
  ['path', { d: 'M8 3v4c0 1.5-1 2.5-2 3l1 11h10l1-11c-1-.5-2-1.5-2-3V3' }],
  ['path', { d: 'M8 3c1 2 2 3 4 3s3-1 4-3' }],
]);
const Sock = glyph('serva-sock', [
  ['path', { d: 'M8 3h7v9l5 3.5a3 3 0 0 1-1.5 5.5H10a3 3 0 0 1-2-3z' }],
  ['path', { d: 'M8 7h7' }],
]);
const Belt = glyph('serva-belt', [
  ['rect', { x: 2, y: 9, width: 20, height: 6, rx: 1 }],
  ['rect', { x: 10, y: 7, width: 4, height: 10, rx: 1 }],
  ['path', { d: 'M5 12h.01M18 12h.01' }],
]);
const Scarf = glyph('serva-scarf', [
  ['path', { d: 'M6 4c0 3.5 2.5 6 6 6s6-2.5 6-6' }],
  ['path', { d: 'M10 9.5L8 21h4.5l1-11' }],
]);
const Coat = glyph('serva-coat', [
  ['path', { d: 'M9 3L4 6v7l3 .5V21h10v-7.5l3-.5V6l-5-3' }],
  ['path', { d: 'M9 3l3 5 3-5' }],
  ['path', { d: 'M12 8v13' }],
]);
export const TrousersIcon = defineIcon(Trousers);
export const SkirtIcon = defineIcon(Skirt);
export const DressIcon = defineIcon(Dress);
export const TopIcon = defineIcon(Top);
export const SockIcon = defineIcon(Sock);
export const BeltIcon = defineIcon(Belt);
export const ScarfIcon = defineIcon(Scarf);
export const CoatIcon = defineIcon(Coat);
export const AccessoryIcon = defineIcon(Gem);
export const PerfumeIcon = defineIcon(SprayCan);
export const SyringeIcon = defineIcon(Syringe);
export const HeartPulseIcon = defineIcon(HeartPulse);
export const WheelchairIcon = defineIcon(Accessibility);
export const BagIcon = defineIcon(Handbag);
export const GlassesIcon = defineIcon(Glasses);
export const WatchIcon = defineIcon(Watch);
export const KidsIcon = defineIcon(Baby);
export const WinterIcon = defineIcon(Snowflake);
export const SleepIcon = defineIcon(Bed);

// The theme switch (هوية 4 › الوضع الداكن): light, dark, and «حسب الجهاز» (follow the device).
export const SunIcon = defineIcon(Sun);
export const MoonIcon = defineIcon(Moon);
export const SystemThemeIcon = defineIcon(Monitor);
// Fold and unfold the sidebar. Drawn, like every directional glyph here, for a left-to-right page
// (the panel on the left) and mirrored in RTL, where the sidebar sits on the right: in Arabic they
// show lucide's PanelRightClose and PanelRightOpen.
export const PanelCollapseIcon = defineIcon(PanelLeftClose, { directional: true });
export const PanelExpandIcon = defineIcon(PanelLeftOpen, { directional: true });
