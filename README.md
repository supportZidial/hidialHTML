# HiDial HTML

Standalone HTML, CSS, and JavaScript version of the public HiDial website. Serve the repository root using any static web server. The site uses directory URLs such as `/blog/` and `/contact/`.

## Preview

Run `python3 -m http.server 8085 --bind 127.0.0.1` from this directory, then open `http://127.0.0.1:8085/`.

## Features

- Public business pages and all published articles captured from the live sitemap.
- Article list with browser-side search, category filters, pagination, and browser history support. Without JavaScript, the index shows every article.
- Three randomly selected home articles on each JavaScript-enabled page load.
- Dark theme by default and a saved light/dark preference.
- Local styles, images, canonical metadata, structured article data, sitemap, and robots file.
- Contact form sends JSON to `https://api.hidial.com/contact`, protected by server-validated Turnstile. The separate Worker sends email through Resend. A direct email link remains available.

## Content

Article pages are in `blog/<slug>/index.html`. The blog index holds the list rows, and `data/blog.json` supplies home-page selections. Keep these together when adding or editing content. A static host does not provide the Laravel editorial administration interface.

## Export again from Laravel

The optional exporter requires Python 3, curl, and lxml (`python3 -m pip install lxml`). Run `python3 scripts/export.py --source https://hidial.com` while that URL serves the Laravel version, or supply another publicly accessible Laravel source URL. It downloads public pages, assembles the complete article index, and copies referenced assets. Keep the static `assets/site.js` and `assets/static.css` files.

The export captures current published content. It does not synchronize future Laravel changes automatically. Canonical URLs continue to identify `https://hidial.com` as the intended domain.

## Hosting

Choose the repository root as the static publish directory. No build command is needed. Configure the host to serve directory `index.html` files and the supplied `404.html` for unknown routes. Deployment to production and domain changes are managed separately.

## Contact API configuration

Worker source is in `worker/contact.mjs`. Deploy it as `hidial-contact` and attach the custom domain `api.hidial.com`. Its runtime secrets are `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`, `RESEND_API_KEY`, `ALLOWED_ORIGINS`, and `TURNSTILE_SECRET_KEY`. `CONTACT_FROM_EMAIL` must use an address/domain accepted by the Resend account. Set `ALLOWED_ORIGINS` to `https://hidial.com,https://www.hidial.com,https://hidial-html.pages.dev`.

The public runtime binding `TURNSTILE_SITE_KEY` belongs to the matching widget. Configure its hostnames for the same three site domains. The browser obtains this public key and readiness status from `/contact/config`. It enables submission when all required settings are configured. It requests a new Turnstile token for the `contact` action on each submission.

Secrets belong in Cloudflare's Worker settings or an ignored local `.dev.vars` file. Never put them in frontend HTML, JavaScript, or Git. Run `node --test worker/contact.test.mjs` to validate the handler using simulated providers. Missing and invalid-token production checks do not send email. Complete a real browser submission and confirm receipt to test actual mail delivery.

Pushing `main` deploys the static site through Pages. The separate contact Worker must be uploaded separately when its source changes.
