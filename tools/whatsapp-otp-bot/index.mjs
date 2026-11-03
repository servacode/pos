// Serva's WhatsApp code sender. See README.md.
import { createBotServer } from './server.mjs';
import { connectWhatsApp } from './whatsapp.mjs';

const token = process.env.BOT_TOKEN ?? '';
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const authDir = process.env.AUTH_DIR ?? './auth';

const sender = await connectWhatsApp(authDir);
createBotServer({ token, sender }).listen(port, host, () => {
  console.log(`Serva WhatsApp sender on http://${host}:${port}/send`);
});
