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
- Contact form prepares an email addressed to the existing production recipient, `info@zidial.com`. The visitor completes sending in their email application. Direct web delivery and server-side reCAPTCHA require a separate form service or backend.

## Content

Article pages are in `blog/<slug>/index.html`. The blog index holds the list rows, and `data/blog.json` supplies home-page selections. Keep these together when adding or editing content. A static host does not provide the Laravel editorial administration interface.

## Export again from Laravel

The optional exporter requires Python 3, curl, and lxml (`python3 -m pip install lxml`). Run `python3 scripts/export.py --source https://hidial.com` while that URL serves the Laravel version, or supply another publicly accessible Laravel source URL. It downloads public pages, assembles the complete article index, and copies referenced assets. Keep the static `assets/site.js` and `assets/static.css` files.

The export captures current published content. It does not synchronize future Laravel changes automatically. Canonical URLs continue to identify `https://hidial.com` as the intended domain.

## Hosting

Choose the repository root as the static publish directory. No build command is needed. Configure the host to serve directory `index.html` files and the supplied `404.html` for unknown routes. Deployment to production and domain changes are managed separately.
