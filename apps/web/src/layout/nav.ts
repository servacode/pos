import type { Permission } from '@serva/core';
import { CategoriesIcon, DeviceIcon, HomeIcon, ProductsIcon, type Icon } from '@serva/ui';

export interface NavEntry {
  to: string;
  label: string;
  icon: Icon;
  /** Shown only to whoever holds this key in `me.user.permissions`; the server checks each request again. */
  permission?: Permission;
  /** Active only on this exact address (the home page) */
  end?: boolean;
}

/**
 * The admin menu (12 › خريطة الشاشات), in its order. It lists only screens that exist (tab 12: no
 * button the user cannot use), each with its icon from @serva/ui and its glossary name.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'الرئيسية', icon: HomeIcon, end: true },
  { to: '/products', label: 'المنتجات', icon: ProductsIcon, permission: 'catalog.manage' },
  { to: '/categories', label: 'التصنيفات', icon: CategoriesIcon, permission: 'catalog.manage' },
  { to: '/devices', label: 'الأجهزة', icon: DeviceIcon, permission: 'devices.view' },
];

export function navFor(permissions: readonly Permission[]): NavEntry[] {
  return NAV_ENTRIES.filter((entry) => !entry.permission || permissions.includes(entry.permission));
}
