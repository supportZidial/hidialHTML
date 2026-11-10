"""Export the public Laravel site to standalone HTML files."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, unquote
import argparse
import copy
import json
import re
import subprocess
import xml.etree.ElementTree as ET

from lxml import html, etree

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source', default='https://hidial.com')
parser.add_argument('--contact-email', default='info@zidial.com')
args = parser.parse_args()
source = args.source.rstrip('/')
assets = set()

def download(path):
    return subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--retry', '2', '--max-time', '40', source + path])

def local_url(value):
    parsed = urlsplit(value)
    if parsed.scheme and parsed.netloc not in {urlsplit(source).netloc, 'hidial.com', 'www.hidial.com'}:
        return value
    if value.startswith(('#', 'mailto:', 'tel:', 'data:', 'javascript:')):
        return value
    path = parsed.path or '/'
    if not path.startswith('/'):
        path = '/' + path
    if '.' not in path.rsplit('/', 1)[-1] and not path.endswith('/'):
        path += '/'
    return urlunsplit(('', '', path, parsed.query, parsed.fragment))

sitemap = download('/sitemap.xml')
xml = ET.fromstring(sitemap)
paths = [urlsplit(node.text).path for node in xml.findall('.//{*}loc')]
paths = list(dict.fromkeys(paths + ['/contact', '/about-us', '/telecom-plans', '/terms-of-service', '/acceptable-use-policy', '/']))
with ThreadPoolExecutor(max_workers=6) as pool:
    documents = dict(zip(paths, pool.map(download, paths)))

first = html.fromstring(documents['/blog'])
page_numbers = [int(n) for n in re.findall(r'[?&]page=(\d+)', documents['/blog'].decode())]
rows = first.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " journal-article-row ")]')
for page in range(2, max(page_numbers, default=1) + 1):
    doc = html.fromstring(download('/blog?page=' + str(page)))
    rows.extend(doc.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " journal-article-row ")]'))
row_by_slug = {}
for row in rows:
    link = row.xpath('.//h3/a')[0]
    slug = urlsplit(link.get('href')).path.rstrip('/').split('/')[-1]
    row_by_slug[slug] = row
expected_slugs = {p.rstrip('/').split('/')[-1] for p in paths if p.startswith('/blog/')}
if set(row_by_slug) != expected_slugs:
    raise RuntimeError('The blog index and sitemap do not contain the same articles')

posts = []
for slug, row in row_by_slug.items():
    article = html.fromstring(documents['/blog/' + slug])
    figure = article.xpath('//*[contains(@class,"journal-article-cover")]//img')[0]
    posts.append({
        'slug': slug,
        'title': row.xpath('.//h3/a')[0].text_content().strip(),
        'excerpt': row.xpath('.//*[contains(@class,"journal-row-copy")]/p')[0].text_content().strip(),
        'category': row.xpath('.//*[contains(@class,"journal-row-topic")]')[0].text_content().strip(),
        'date': row.xpath('.//time')[0].get('datetime'),
        'dateLabel': row.xpath('.//time')[0].text_content().strip(),
        'reading': row.xpath('.//*[contains(@class,"journal-row-meta")]/span')[0].text_content().strip(),
        'cover': local_url(figure.get('src')),
    })
(ROOT / 'data').mkdir(exist_ok=True)
(ROOT / 'data/blog.json').write_text(json.dumps(posts, ensure_ascii=False, indent=2) + '\n')

for path, content in documents.items():
    doc = html.fromstring(content)
    if not doc.xpath('//head'):
        doc = copy.deepcopy(html.fromstring(documents['/']))
        main = doc.xpath('//main')[0]
        for child in list(main):
            main.remove(child)
        for fragment in html.fragments_fromstring(content):
            main.append(fragment)
        title = main.xpath('.//h1')[0].text_content().strip()
        doc.xpath('//title')[0].text = title + ' — HiDial'
        doc.xpath('//link[@rel="canonical"]')[0].set('href', 'https://hidial.com' + path)
        for meta in doc.xpath('//meta[@property="og:title"]'):
            meta.set('content', title + ' — HiDial')
        for meta in doc.xpath('//meta[@property="og:url"]'):
            meta.set('content', 'https://hidial.com' + path)
        for meta in doc.xpath('//meta[@name="description"] | //meta[@property="og:description"]'):
            meta.set('content', 'HiDial ' + title)
    if path == '/blog':
        listing = doc.xpath('//*[contains(@class,"journal-article-list")]')[0]
        listing.clear()
        listing.set('class', 'journal-article-list')
        listing.set('role', 'list')
        for slug, row in row_by_slug.items():
            item = etree.SubElement(listing, 'li')
            item.set('data-category', posts[list(row_by_slug).index(slug)]['category'])
            item.append(row)
        for pagination in doc.xpath('//*[contains(@class,"journal-pagination")]'):
            pagination.clear()
            pagination.set('class', 'journal-pagination')
            pagination.set('aria-label', 'Article pages')
        note = etree.SubElement(listing.getparent(), 'noscript')
        note.text = 'All articles are shown. Enable JavaScript to search, filter topics, and paginate.'
    if path == '/contact':
        # Preserve the configured API form and its client script during a content refresh.
        existing = ROOT / 'contact/index.html'
        if existing.exists():
            doc = html.fromstring(existing.read_bytes())
        else:
            raise RuntimeError('Restore contact/index.html from Git before exporting')
    for element in doc.xpath('//*[@data-cfemail]'):
        encoded = bytes.fromhex(element.get('data-cfemail'))
        email = ''.join(chr(value ^ encoded[0]) for value in encoded[1:])
        element.text = email
        del element.attrib['data-cfemail']
    for element in doc.xpath('//a[contains(@href,"/cdn-cgi/l/email-protection")]'):
        encoded = bytes.fromhex(element.get('href').split('#')[-1])
        email = ''.join(chr(value ^ encoded[0]) for value in encoded[1:])
        element.set('href', 'mailto:' + email)
    for element in doc.xpath('//script[not(@type="application/ld+json")] | //meta[@name="csrf-token"]'):
        element.getparent().remove(element)
    for element in doc.xpath('//link[@rel="modulepreload"]'):
        element.getparent().remove(element)
    for element in doc.xpath('//*[@href or @src or @action]'):
        for attribute in ['href', 'src', 'action']:
            value = element.get(attribute)
            if not value:
                continue
            if attribute == 'href' and element.tag == 'link' and element.get('rel') == 'canonical':
                continue
            rewritten = local_url(value)
            element.set(attribute, rewritten)
            if attribute == 'src' or (element.tag == 'link' and element.get('rel') in ('stylesheet', 'icon')):
                if rewritten.startswith('/'):
                    assets.add(urlsplit(rewritten).path)
    heads = doc.xpath('//head')
    if not heads:
        raise RuntimeError('Source page has no HTML head: ' + path)
    head = heads[0]
    css = etree.SubElement(head, 'link', {'rel': 'stylesheet', 'href': '/assets/static.css'})
    etree.SubElement(head, 'script', {'defer': 'defer', 'src': '/assets/site.js'})
    if path == '/contact':
        etree.SubElement(head, 'script', {'defer': 'defer', 'src': '/assets/contact.js'})
    destination = ROOT / path.strip('/') / 'index.html' if path != '/' else ROOT / 'index.html'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(html.tostring(doc, encoding='utf-8', doctype='<!doctype html>', method='html'))

for post in posts:
    assets.add(post['cover'])
with ThreadPoolExecutor(max_workers=6) as pool:
    downloaded = list(pool.map(download, sorted(assets)))
for path, content in zip(sorted(assets), downloaded):
    target = ROOT / path.lstrip('/')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    if target.suffix == '.css':
        # Relative URLs inside the source stylesheet need to retain their path.
        for reference in re.findall(r'url\([\"\']?([^\)\"\']+)', content.decode()):
            if reference.startswith('/'):
                extra = ROOT / reference.lstrip('/')
                if not extra.exists():
                    extra.parent.mkdir(parents=True, exist_ok=True)
                    extra.write_bytes(download(reference))
(ROOT / 'sitemap.xml').write_bytes(sitemap)
(ROOT / 'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: https://hidial.com/sitemap.xml\n')
print(f'Exported {len(paths)} pages, {len(posts)} articles, {len(assets)} referenced assets')
