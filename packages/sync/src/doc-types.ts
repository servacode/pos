/**
 * Document types a device sends (17 › الإرسال) and the series each is numbered in (08 › الترقيم).
 * A type without a series carries no number: it is not a numbered document in tab 08 (a new
 * customer, an exchange-rate change, a cart event), or its number belongs to another document
 * (a shift close carries its shift's number in the payload).
 *
 * `exchange` has no prefix in tab 08 yet: until the product decides, it is unnumbered.
 */
export const DOC_SERIES = {
  sale: 'INV',
  return: 'SRT',
  exchange: null,
  quotation: 'QUO',
  receipt: 'RCV',
  cash_movement: 'CSH',
  shift_open: 'SFT',
  shift_close: null,
  customer: null,
  exchange_rate: null,
  // Added by the team review (17 › أنواع أضافتها المراجعة)
  owner_movement: 'OWN',
  fx_exchange: 'FXE',
  quick_receive: 'PUR',
  cart_event: null,
  trade_in: 'TRI',
  temp_item: null,
  payment_attempt: null,
  customer_change_request: null,
  // Later phases, numbered on the device too (08 › مستندات تُرقّم في المكانين)
  transfer: 'TRF',
  sales_order: 'SO',
  repair_ticket: 'RPR',
  attendance: 'ATT',
} as const satisfies Record<string, string | null>;

export type DocType = keyof typeof DOC_SERIES;
export const DOC_TYPES = Object.keys(DOC_SERIES) as [DocType, ...DocType[]];
export type DocSeries = Exclude<(typeof DOC_SERIES)[DocType], null>;

export function seriesOf(type: DocType): DocSeries | null {
  return DOC_SERIES[type];
}
