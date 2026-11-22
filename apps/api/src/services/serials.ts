/**
 * Serial numbers and IMEIs: one barrel over serials-core (receiving, lookup, transfers, stock),
 * serials-sales (selling, returns, unassigned sales, fixes) and serials-drift (counts and write-offs).
 * Importers keep using './serials'.
 */
export * from './serials-core';
export * from './serials-sales';
export * from './serials-drift';
