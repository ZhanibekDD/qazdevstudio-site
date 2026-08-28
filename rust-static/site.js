(() => {
  const menuButton = document.querySelector('.menu-button');
  const nav = document.querySelector('#site-nav');
  if (menuButton && nav) {
    menuButton.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      document.body.classList.toggle('menu-open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.textContent = open ? 'Закрыть' : 'Меню';
    });
    nav.addEventListener('click', event => {
      if (!event.target.closest('a')) return;
      nav.classList.remove('open');
      document.body.classList.remove('menu-open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.textContent = 'Меню';
    });
  }

  const search = document.querySelector('#program-search');
  const grid = document.querySelector('#program-grid');
  const count = document.querySelector('#program-count');
  const clear = document.querySelector('#clear-search');
  const empty = document.querySelector('#catalog-empty');
  if (!search || !grid || !count || !clear || !empty) return;

  let programs = [];
  let controller;

  const escapeHtml = value => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const card = app => {
    const icon = app.icon
      ? `<img src="${escapeHtml(app.icon)}" alt="" loading="lazy">`
      : escapeHtml(app.name.slice(0, 1).toUpperCase());
    return `<a class="program-card" href="/programmy/${encodeURIComponent(app.slug)}.html">
      <span class="program-icon">${icon}</span>
      <div><small>${escapeHtml(app.categoryLabel)}</small><h2>${escapeHtml(app.name)}</h2><p>${escapeHtml(app.description)}</p><b>${escapeHtml((app.platforms || []).join(', '))}</b></div><i>↗</i>
    </a>`;
  };

  const render = value => {
    const query = value.trim().toLocaleLowerCase('ru');
    if (!query) {
      location.reload();
      return;
    }
    const found = programs.filter(app => [app.name, app.description, app.categoryLabel, ...(app.platforms || [])]
      .join(' ').toLocaleLowerCase('ru').includes(query)).slice(0, 60);
    grid.innerHTML = found.map(card).join('');
    grid.hidden = found.length === 0;
    empty.hidden = found.length !== 0;
    count.textContent = found.length ? `Найдено: ${found.length}` : 'Результатов нет';
    clear.hidden = false;
  };

  const load = async () => {
    if (programs.length) return;
    const response = await fetch('/api/programs', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Не удалось загрузить каталог');
    programs = await response.json();
  };

  search.addEventListener('input', async () => {
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      await load();
      const value = search.value;
      setTimeout(() => {
        if (!controller.signal.aborted && value === search.value && value.trim()) render(value);
      }, 90);
    } catch (error) {
      count.textContent = 'Поиск временно недоступен';
    }
  });

  clear.addEventListener('click', () => {
    search.value = '';
    location.reload();
  });

  document.addEventListener('keydown', event => {
    if (event.key === '/' && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
    }
  });
})();

