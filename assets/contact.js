(() => {
  const form = document.querySelector('[data-api-contact]');
  if (!form) return;
  const endpoint = form.dataset.apiContact;
  const status = form.querySelector('[data-contact-status]');
  const button = form.querySelector('button[type="submit"]');
  let widget;
  let tokenCallback;
  let ready = false;
  let busy = false;
  let requestId = crypto.randomUUID();

  function notify(message, error = false) {
    status.setAttribute('role', error ? 'alert' : 'status');
    status.textContent = message;
  }

  function loadTurnstile() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The security check could not load. Please reload the page and try again.')), 20000);
      window.hidialTurnstileReady = () => { clearTimeout(timeout); resolve(); };
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=hidialTurnstileReady&render=explicit';
      script.async = true;
      script.onerror = () => { clearTimeout(timeout); reject(new Error('The security check could not load. Please reload the page and try again.')); };
      document.head.append(script);
    });
  }

  function rejectToken(message) {
    if (tokenCallback) tokenCallback.reject(new Error(message));
    tokenCallback = undefined;
  }

  function verify() {
    window.turnstile.reset(widget);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => rejectToken('The security check timed out. Please try again.'), 120000);
      tokenCallback = {
        resolve: token => { clearTimeout(timeout); resolve(token); },
        reject: error => { clearTimeout(timeout); reject(error); },
      };
      window.turnstile.execute(widget);
    });
  }

  form.addEventListener('input', () => { if (!busy) requestId = crypto.randomUUID(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !ready || !form.reportValidity()) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    notify('Checking your request…');
    const values = new FormData(form);
    try {
      const token = await verify();
      tokenCallback = undefined;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'), email: values.get('email'), phone: values.get('phone'),
          message: values.get('comments'), website: values.get('website') || '',
          turnstileToken: token, requestId,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to send. Please try again later.');
      notify(result.message);
      form.reset();
      requestId = crypto.randomUUID();
    } catch (error) {
      notify(error.name === 'TimeoutError' || error instanceof TypeError ? 'The connection was interrupted. Please try again later.' : error.message, true);
    } finally {
      window.turnstile.reset(widget);
      busy = false;
      button.disabled = false;
      button.textContent = 'Send message';
    }
  });

  async function initialize() {
    try {
      const response = await fetch(endpoint + '/config', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (!response.ok) throw new Error('Online messaging is temporarily unavailable. Please try again later.');
      const config = await response.json();
      if (!config.ready || !config.siteKey) throw new Error('Online messaging is temporarily unavailable. Please try again later.');
      await loadTurnstile();
      widget = window.turnstile.render(form.querySelector('[data-turnstile-container]'), {
        sitekey: config.siteKey,
        action: 'contact',
        execution: 'execute',
        appearance: 'always',
        theme: 'auto',
        callback: token => { if (tokenCallback) tokenCallback.resolve(token); },
        'error-callback': () => { rejectToken('The security check failed. Please try again.'); },
        'expired-callback': () => { rejectToken('The security check expired. Please try again.'); },
      });
      ready = true;
      button.disabled = false;
      notify('');
    } catch (error) {
      notify(error.message || 'Online messaging is temporarily unavailable. Please try again later.', true);
    }
  }
  initialize();
})();
