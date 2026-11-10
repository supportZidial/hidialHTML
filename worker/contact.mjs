const BODY_LIMIT = 16384;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(data, status, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
}

function settings(env) {
  const origins = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const hostnames = origins.map(origin => {
    try { return new URL(origin).hostname; } catch { return ''; }
  }).filter(Boolean);
  const ready = Boolean(origins.length && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY && env.RESEND_API_KEY && env.CONTACT_FROM_EMAIL && env.CONTACT_TO_EMAIL);
  return { origins, hostnames, ready };
}

async function readPayload(request) {
  if (Number(request.headers.get('Content-Length')) > BODY_LIMIT) throw new Error('too-large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid-json');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > BODY_LIMIT) {
        await reader.cancel();
        throw new Error('too-large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handleRequest(request, env, send = fetch) {
  const url = new URL(request.url);
  if (!['/contact', '/contact/config'].includes(url.pathname)) return respond({ message: 'Not found.' }, 404);
  const config = settings(env);
  const origin = request.headers.get('Origin') || '';
  if (!config.origins.includes(origin)) return respond({ message: 'Origin not allowed.' }, 403);
  if (request.method === 'OPTIONS') return respond(null, 204, origin);
  if (url.pathname === '/contact/config' && request.method === 'GET') {
    return respond({ ready: config.ready, siteKey: env.TURNSTILE_SITE_KEY || '' }, 200, origin);
  }
  if (url.pathname !== '/contact' || request.method !== 'POST') return respond({ message: 'Method not allowed.' }, 405, origin);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return respond({ message: 'JSON is required.' }, 415, origin);
  let payload;
  try { payload = await readPayload(request); }
  catch (error) { return respond({ message: error.message === 'too-large' ? 'Your message is too large.' : 'Invalid request.' }, error.message === 'too-large' ? 413 : 400, origin); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return respond({ message: 'Invalid request.' }, 400, origin);
  const fields = ['name', 'email', 'phone', 'message', 'website', 'turnstileToken', 'requestId'];
  if (fields.some(field => payload[field] !== undefined && typeof payload[field] !== 'string')) return respond({ message: 'Invalid fields.' }, 422, origin);
  const values = Object.fromEntries(fields.map(field => [field, (payload[field] || '').trim()]));
  if (values.website) return respond({ message: 'Thanks. Your message was received.' }, 200, origin);
  if (!values.name || !values.email || !values.phone || !values.message || !EMAIL_PATTERN.test(values.email) || /[\r\n]/.test(values.name + values.email + values.phone)) {
    return respond({ message: 'Please provide your name, a valid email, phone number, and message.' }, 422, origin);
  }
  if (values.name.length > 120 || values.email.length > 254 || values.phone.length > 40 || values.message.length > 5000 || !REQUEST_ID_PATTERN.test(values.requestId)) {
    return respond({ message: 'Please check the length and format of your information.' }, 422, origin);
  }
  if (!config.ready) return respond({ message: 'Online messaging is temporarily unavailable. Please try again later.' }, 503, origin);
  if (!values.turnstileToken || values.turnstileToken.length > 2048) return respond({ message: 'Please complete the security check and try again.' }, 422, origin);
  let verification;
  try {
    const response = await send('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: values.turnstileToken, remoteip: request.headers.get('CF-Connecting-IP') || undefined }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('verification-unavailable');
    verification = await response.json();
  } catch {
    return respond({ message: 'The security check is temporarily unavailable. Please try again.' }, 503, origin);
  }
  if (!verification.success || verification.action !== 'contact' || !config.hostnames.includes(verification.hostname)) {
    return respond({ message: 'The security check expired or failed. Please try again.' }, 422, origin);
  }
  const text = ['New HiDial contact form submission', '', `Name: ${values.name}`, `Email: ${values.email}`, `Phone: ${values.phone}`, '', 'Message:', values.message].join('\n');
  try {
    const response = await send('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `hidial-contact-${values.requestId}`,
      },
      body: JSON.stringify({ from: env.CONTACT_FROM_EMAIL, to: [env.CONTACT_TO_EMAIL], reply_to: values.email, subject: `HiDial website contact from ${values.name}`, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      let failure = {};
      try { failure = await response.json(); } catch {}
      // Log only provider status and a known category, never contact data or credentials.
      const reason = response.status === 401 ? 'authentication' :
        /domain.*verif|verif.*domain/i.test(String(failure.message || '')) ? 'sender-domain' :
        /testing|own email/i.test(String(failure.message || '')) ? 'sandbox' :
        response.status === 403 ? 'permissions' :
        response.status === 429 ? 'rate-limit' : 'provider-rejection';
      console.error(JSON.stringify({ event: 'contact_delivery_failed', status: response.status, reason }));
      return respond({ message: 'Unable to send your message right now. Please try again later.', code: 'email_delivery_failed' }, 502, origin);
    }
    const result = await response.json();
    if (!result.id) throw new Error('delivery-unconfirmed');
  } catch {
    return respond({ message: 'Unable to send your message right now. Please try again later.' }, 502, origin);
  }
  return respond({ message: 'Thanks. Your message has been sent to HiDial.' }, 200, origin);
}

export default { fetch: (request, env) => handleRequest(request, env) };
