/** Leaves the shop for WhatsApp with the order written out (a module of its own so tests replace it). */
export function openWhatsApp(url: string): void {
  window.location.assign(url);
}
