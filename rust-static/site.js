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
    const response = await fetch('/api/programs.json', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Не удалось загрузить каталог');
    programs = await response.json();
  };

  search.addEventListener('input', async () => {
    if (controller) controller.abort();
    controller = new AbortController();
    const value = search.value;
    if (!value.trim()) {
      render('');
      return;
    }
    try {
      await load();
      setTimeout(() => {
        if (!controller.signal.aborted && value === search.value) render(value);
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

(() => {
  const randomId = prefix => {
    const value = self.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  };
  const visitorKey = 'qazdev_visitor_v2';
  const sessionKey = 'qazdev_session_v2';
  let visitorId = localStorage.getItem(visitorKey);
  let sessionId = sessionStorage.getItem(sessionKey);
  if (!visitorId) {
    visitorId = randomId('v');
    localStorage.setItem(visitorKey, visitorId);
  }
  if (!sessionId) {
    sessionId = randomId('s');
    sessionStorage.setItem(sessionKey, sessionId);
  }

  const params = new URLSearchParams(location.search);
  const base = () => ({
    visitor_id: visitorId,
    session_id: sessionId,
    page_url: `${location.pathname}${location.search}`,
    page_title: document.title,
    referrer: document.referrer,
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || ''
  });
  const track = (eventType, eventLabel = '', extra = {}) => {
    const payload = JSON.stringify({
      ...base(),
      event_type: eventType,
      event_label: eventLabel,
      extra
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track.php', new Blob([payload], { type: 'application/json' }));
      return;
    }
    fetch('/api/track.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  };

  track('page_view');

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const label = link.textContent.trim().slice(0, 200);
    if (href.includes('wa.me') || href.includes('whatsapp')) track('whatsapp_click', label);
    else if (href.includes('t.me/')) track('telegram_click', label);
    else if (href.startsWith('tel:')) track('phone_click', label);
    else if (href.startsWith('mailto:')) track('email_click', label);
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const values = new FormData(form);
    const service = String(values.get('service') || 'Нужно разобраться').slice(0, 120);
    const label = form.getAttribute('aria-label') || form.id || 'Форма';

    if (form.matches('[data-whatsapp-form]')) {
      event.preventDefault();
      const name = String(values.get('name') || '').trim().slice(0, 80);
      const message = String(values.get('message') || '').trim().slice(0, 1000);
      const text = [
        'Здравствуйте! Хочу обсудить проект.',
        '',
        `Имя: ${name}`,
        `Задача: ${service}`,
        `Описание: ${message}`
      ].join('\n');
      track('generate_lead', service, { channel: 'whatsapp', service });
      window.open(`https://wa.me/77000300024?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      return;
    }

    track('form_submit', label, { service });
  });
})();
