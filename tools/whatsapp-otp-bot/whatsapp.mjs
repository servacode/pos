// The WhatsApp side: links to a WhatsApp account the way WhatsApp Web does (scan a QR code once
// from the phone: الأجهزة المرتبطة ← ربط جهاز) and sends text messages. Unofficial (Baileys): use a
// number kept for the bot alone, not the shop's or your own, since WhatsApp may ban it.
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

export async function connectWhatsApp(authDir, log = console.log) {
  let socket = null;
  let open = false;

  async function start() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    socket = makeWASocket({ auth: state, printQRInTerminal: false, browser: ['Serva', 'Chrome', '1.0'] });
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        log('امسح هذا الرمز من واتساب على جوال البوت: الإعدادات ← الأجهزة المرتبطة ← ربط جهاز');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        open = true;
        log('✔ WhatsApp linked');
      }
      if (connection === 'close') {
        open = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          log('✘ Logged out from the phone: delete the auth folder and scan again.');
          return;
        }
        log('Connection lost, reconnecting…');
        setTimeout(() => void start(), 3000);
      }
    });
  }

  await start();
  return {
    linked: () => open,
    async send(jid, text) {
      if (!open || !socket) throw new Error('not linked');
      await socket.sendMessage(jid, { text });
    },
  };
}
