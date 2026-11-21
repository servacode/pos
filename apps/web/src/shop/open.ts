/**
 * Opens WhatsApp with the order written out in a new tab, so the shop page stays where the customer
 * left it (a module of its own so tests replace it). When the browser blocks the new tab, nothing is
 * lost: the order's page still has its «أرسل الطلب على واتساب» link, which opens in a new tab too.
 */
export function openWhatsApp(url: string): boolean {
  const tab = window.open(url, '_blank');
  if (!tab) return false;
  tab.opener = null;
  return true;
}

/** The order's message ends with the customer's own page for it, so the store can follow it too. */
export function withTrackingLink(whatsappUrl: string, trackUrl: string): string {
  return `${whatsappUrl}${encodeURIComponent(`\n\nتابع الطلب: ${trackUrl}`)}`;
}
