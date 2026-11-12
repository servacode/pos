import type { SectorKey } from '@serva/core';

/**
 * Which screens and fields each business type uses (هوية 2: a clothing shop sees no expiry dates,
 * weights or IMEI). A store with no business type set sees everything.
 */
export function storeSells(
  storeSectors: readonly SectorKey[] | undefined,
  sectors: readonly SectorKey[],
): boolean {
  if (!storeSectors || storeSectors.length === 0) return true;
  return sectors.some((sector) => storeSectors.includes(sector));
}

/** Stock with expiry dates: the «الصلاحية» screen. */
export const EXPIRY_SECTORS: readonly SectorKey[] = [
  'supermarket',
  'pharmacy',
  'bakery',
  'cosmetics',
  'produce',
  'wholesale',
  'restaurant',
  'cafe',
  'general',
];

/** The hall and the kitchen: tables, a waiter and cancellations after the kitchen. */
export const HALL_SECTORS: readonly SectorKey[] = ['restaurant', 'cafe'];

/** Pieces sold by their serial number or IMEI, with a warranty. */
export const SERIAL_SECTORS: readonly SectorKey[] = ['electronics', 'building_materials', 'general'];

/** Customers who pay with cheques. */
export const CHEQUE_SECTORS: readonly SectorKey[] = [
  'wholesale',
  'building_materials',
  'electronics',
  'supermarket',
  'pharmacy',
  'general',
];

/** Goods sold by weight («0.250 كغ»). */
export const WEIGHED_SECTORS: readonly SectorKey[] = [
  'supermarket',
  'produce',
  'bakery',
  'restaurant',
  'cafe',
  'building_materials',
  'wholesale',
  'general',
];

/** Items with choices and extras for the kitchen. */
export const MODIFIER_SECTORS: readonly SectorKey[] = ['restaurant', 'cafe', 'bakery'];
