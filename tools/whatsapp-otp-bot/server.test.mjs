// The bot's HTTP side against a fake WhatsApp: node --test tools/whatsapp-otp-bot/server.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBotServer, jidOf, PER_PHONE_PER_HOUR } from './server.mjs';

const TOKEN = 'bot-token-0123456789';

async function withBot(fn, { linked = true, failSend = false } = {}) {
  const sent = [];
  const sender = {
    linked: () => linked,
    async send(jid, text) {
      if (failSend) throw new Error('boom');
      sent.push({ jid, text });
    },
  };
  const server = createBotServer({ token: TOKEN, sender, gapMs: 1, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body, token = TOKEN) =>
    fetch(`${url}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  try {
    await fn({ post, url, sent });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const message = (phone = '+963933123456') => ({
  phone,
  code: '482913',
  purpose: 'registration',
  text: 'رمز التحقق في سيرفا: 482913',
});
const settle = () => new Promise((r) => setTimeout(r, 30));

test('sends the text to the phone’s WhatsApp, with the right token only', async () => {
  await withBot(async ({ post, sent }) => {
    assert.equal((await post(message())).status, 202);
    await settle();
    assert.deepEqual(sent, [{ jid: '963933123456@s.whatsapp.net', text: 'رمز التحقق في سيرفا: 482913' }]);
    assert.equal((await post(message(), 'wrong-token-0123456789')).status, 401);
    assert.equal((await post(message(), '')).status, 401);
    await settle();
    assert.equal(sent.length, 1);
  });
});

test('refuses a bad body and a number that is not E.164', async () => {
  await withBot(async ({ post }) => {
    assert.equal((await post('{nope')).status, 400);
    assert.equal((await post({ ...message(), phone: '0933123456' })).status, 400);
    assert.equal((await post({ ...message(), text: '' })).status, 400);
  });
});

test('answers 503 until WhatsApp is linked, so sign-up says «try again»', async () => {
  await withBot(
    async ({ post, url }) => {
      assert.equal((await post(message())).status, 503);
      assert.deepEqual(await (await fetch(`${url}/health`)).json(), { linked: false, queued: 0 });
    },
    { linked: false },
  );
});

test(`stops after ${PER_PHONE_PER_HOUR} codes an hour for one number, not for another`, async () => {
  await withBot(async ({ post }) => {
    for (let i = 0; i < PER_PHONE_PER_HOUR; i++) assert.equal((await post(message())).status, 202);
    assert.equal((await post(message())).status, 429);
    assert.equal((await post(message('+963944000000'))).status, 202);
  });
});

test('a failed send is logged and does not stop the next ones', async () => {
  await withBot(
    async ({ post }) => {
      assert.equal((await post(message())).status, 202);
      await settle();
      assert.equal((await post(message('+963944000000'))).status, 202);
    },
    { failSend: true },
  );
});

test('turns E.164 into a WhatsApp id', () => {
  assert.equal(jidOf('+963933123456'), '963933123456@s.whatsapp.net');
  assert.equal(jidOf('963933123456'), null);
  assert.equal(jidOf('+0123'), null);
});

test('refuses a short token at start', () => {
  assert.throws(() =>
    createBotServer({ token: 'short', sender: { linked: () => true, send: async () => {} } }),
  );
});
