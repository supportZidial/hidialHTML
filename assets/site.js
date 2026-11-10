(() => {
  const root = document.documentElement;
  const themeKey = 'hidial-theme';

  function applyTheme(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-theme-icon]').forEach(icon => {
      icon.textContent = theme === 'dark' ? '🌙' : '☀️';
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.title = label;
    });
    try { localStorage.setItem(themeKey, theme); } catch { /* Storage may be unavailable. */ }
  }

  let savedTheme;
  try { savedTheme = localStorage.getItem(themeKey); } catch { /* Use the default theme. */ }
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');
  window.__hidialToggleTheme = () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');

  const list = document.querySelector('.journal-article-list');
  if (list) {
    const rows = [...list.children];
    const form = document.querySelector('.journal-search');
    const search = form.querySelector('input[name="q"]');
    const categoryLinks = [...document.querySelectorAll('.journal-categories a')];
    const pagination = document.querySelector('.journal-pagination');
    const count = document.querySelector('.journal-list-heading p');
    const heading = document.querySelector('.journal-list-heading h2');
    const empty = document.createElement('p');
    empty.className = 'journal-empty';
    empty.textContent = 'No articles found. Try another search or topic.';
    empty.hidden = true;
    list.after(empty);
    const status = document.createElement('p');
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    list.before(status);

    function render() {
      const params = new URLSearchParams(location.search);
      const query = (params.get('q') || '').trim().slice(0, 120);
      const category = params.get('category') || '';
      search.value = query;
      const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matches = rows.filter(row => {
        const text = row.querySelector('.journal-row-copy').textContent.toLocaleLowerCase();
        return (!category || row.dataset.category === category) && terms.every(term => text.includes(term));
      });
      const pageCount = Math.max(1, Math.ceil(matches.length / 9));
      const requestedPage = Number(params.get('page'));
      const page = Number.isSafeInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
      rows.forEach(row => { row.hidden = true; });
      matches.slice((page - 1) * 9, page * 9).forEach(row => { row.hidden = false; });
      empty.hidden = matches.length > 0;
      heading.textContent = category || 'All articles';
      count.textContent = `${matches.length} ${matches.length === 1 ? 'article' : 'articles'}`;
      status.textContent = `${count.textContent}. Page ${page} of ${pageCount}.`;
      categoryLinks.forEach(link => {
        const linkCategory = new URL(link.href).searchParams.get('category') || '';
        const active = linkCategory === category;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        const url = new URL('/blog/', location.origin);
        if (linkCategory) url.searchParams.set('category', linkCategory);
        if (query) url.searchParams.set('q', query);
        link.href = url.pathname + url.search;
      });
      pagination.replaceChildren();
      for (let index = 1; index <= pageCount; index += 1) {
        const link = document.createElement('a');
        const next = new URLSearchParams(params);
        next.set('page', index);
        link.href = `/blog/?${next}`;
        link.textContent = index;
        link.setAttribute('aria-label', `Page ${index}`);
        if (index === page) link.setAttribute('aria-current', 'page');
        pagination.append(link);
      }
      document.querySelector('meta[name="robots"]').content = query || category ? 'noindex, follow' : 'index, follow';
    }

    function navigate(url) {
      history.pushState({}, '', url);
      render();
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const params = new URLSearchParams(location.search);
      params.delete('page');
      if (search.value.trim()) params.set('q', search.value.trim());
      else params.delete('q');
      navigate('/blog/' + (params.size ? `?${params}` : ''));
    });
    [...categoryLinks, pagination].forEach(element => {
      element.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        navigate(link.getAttribute('href'));
      });
    });
    window.addEventListener('popstate', render);
    render();
  }

  const guides = document.querySelector('.home-guides .journal-grid');
  if (guides) {
    fetch('/data/blog.json').then(response => {
      if (!response.ok) throw new Error('Article data unavailable');
      return response.json();
    }).then(posts => {
      const selected = posts.slice();
      for (let index = selected.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [selected[index], selected[swap]] = [selected[swap], selected[index]];
      }
      const fragment = document.createDocumentFragment();
      selected.slice(0, 3).forEach(post => {
        const template = document.createElement('template');
        template.innerHTML = '<article class="journal-card"><a class="journal-cover" tabindex="-1" aria-hidden="true"><img alt="" loading="lazy" width="720" height="440"><span></span></a><div class="journal-card-body"><p class="journal-meta"><time></time><span></span></p><h3><a></a></h3><p class="static-excerpt"></p><a class="journal-text-link">Read article ↗</a></div></article>';
        const card = template.content;
        card.querySelectorAll('a').forEach(link => { link.href = `/blog/${post.slug}/`; });
        card.querySelector('img').src = post.cover;
        card.querySelector('.journal-cover span').textContent = post.category;
        const time = card.querySelector('time');
        time.dateTime = post.date;
        time.textContent = post.dateLabel;
        card.querySelector('.journal-meta span').textContent = post.reading;
        card.querySelector('h3 a').textContent = post.title;
        card.querySelector('.static-excerpt').textContent = post.excerpt;
        fragment.append(card);
      });
      guides.replaceChildren(fragment);
    }).catch(() => { /* The exported article selection remains available. */ });
  }

})();
