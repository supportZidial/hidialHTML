import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './contact.mjs';

const env = {
  ALLOWED_ORIGINS: 'https://hidial.com,https://www.hidial.com',
  TURNSTILE_SECRET_KEY: 'test-only-secret', TURNSTILE_SITE_KEY: 'test-only-public',
  RESEND_API_KEY: 'test-only-email-key', CONTACT_FROM_EMAIL: 'sender@example.com', CONTACT_TO_EMAIL: 'receiver@example.com',
};
const payload = { name: 'Test contact', email: 'visitor@example.com', phone: '+14155550100', message: '<script>example</script>', website: '', turnstileToken: 'test-only-token', requestId: '18c0d6f7-6acc-43a3-a572-eaa702ff0c03' };
const request = (body = payload, origin = 'https://hidial.com') => new Request('https://api.hidial.com/contact', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const neverSend = async () => { throw new Error('Unexpected upstream request'); };

test('preflight and configuration expose only public configuration', async () => {
  const preflight = await handleRequest(new Request('https://api.hidial.com/contact', { method: 'OPTIONS', headers: { Origin: 'https://hidial.com' } }), env, neverSend);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://hidial.com');
  const response = await handleRequest(new Request('https://api.hidial.com/contact/config', { headers: { Origin: 'https://hidial.com' } }), env, neverSend);
  assert.deepEqual(await response.json(), { ready: true, siteKey: 'test-only-public' });
});
test('rejects foreign origins and invalid JSON structures', async () => {
  const response = await handleRequest(request(payload, 'https://foreign.example'), env, neverSend);
  assert.equal(response.status, 403);
  assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  assert.equal((await handleRequest(request(null), env, neverSend)).status, 400);
  assert.equal((await handleRequest(request({ ...payload, name: {} }), env, neverSend)).status, 422);
});
test('rejects oversized and invalid fields before contacting providers', async () => {
  for (const data of [{ ...payload, message: 'x'.repeat(20000) }, { ...payload, message: 'x'.repeat(5001) }, { ...payload, email: 'invalid' }, { ...payload, name: 'Name\nInjected' }]) {
    assert.ok([413, 422].includes((await handleRequest(request(data), env, neverSend)).status));
  }
});
test('honeypot never sends mail', async () => {
  assert.equal((await handleRequest(request({ ...payload, website: 'spam.example' }), env, neverSend)).status, 200);
});
test('missing configuration and missing tokens fail closed', async () => {
  assert.equal((await handleRequest(request(), { ...env, RESEND_API_KEY: '' }, neverSend)).status, 503);
  assert.equal((await handleRequest(request({ ...payload, turnstileToken: '' }), env, neverSend)).status, 422);
});
test('requires successful verification for the correct host and action', async () => {
  for (const verification of [{ success: false }, { success: true, hostname: 'foreign.example', action: 'contact' }, { success: true, hostname: 'hidial.com', action: 'login' }]) {
    let calls = 0;
    const send = async url => { calls += 1; assert.ok(url.includes('siteverify')); return Response.json(verification); };
    assert.equal((await handleRequest(request(), env, send)).status, 422);
    assert.equal(calls, 1);
  }
});
test('successful verification sends only validated fields with an idempotency key', async () => {
  const calls = [];
  const send = async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.includes('siteverify') ? { success: true, hostname: 'hidial.com', action: 'contact' } : { id: 'simulated-email' });
  };
  const response = await handleRequest(request(), env, send);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  const mail = JSON.parse(calls[1].options.body);
  assert.equal(mail.reply_to, payload.email);
  assert.deepEqual(mail.to, ['receiver@example.com']);
  assert.ok(mail.text.includes(payload.message));
  assert.equal(mail.html, undefined);
  assert.ok(!calls[1].options.body.includes(payload.turnstileToken));
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'hidial-contact-' + payload.requestId);
});
test('upstream failures return errors rather than a success message', async () => {
  assert.equal((await handleRequest(request(), env, async () => { throw new Error('network'); })).status, 503);
  const send = async url => url.includes('siteverify') ? Response.json({ success: true, hostname: 'hidial.com', action: 'contact' }) : new Response('rejected', { status: 403 });
  assert.equal((await handleRequest(request(), env, send)).status, 502);
});
