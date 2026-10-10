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
  const remember = (storage, key, create) => {
    try {
      let value = storage.getItem(key);
      if (!value) {
        value = create();
        storage.setItem(key, value);
      }
      return value;
    } catch {
      return create();
    }
  };
  const visitorId = remember(localStorage, 'qazdev_visitor_v2', () => randomId('v'));
  const sessionId = remember(sessionStorage, 'qazdev_session_v2', () => randomId('s'));
  // Short code added to WhatsApp messages: lets a real conversation be matched
  // to the page and traffic source of the visit. A click alone is not a lead.
  const leadRef = remember(sessionStorage, 'qazdev_lead_ref', () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = self.crypto?.getRandomValues?.(new Uint8Array(5))
      || Uint8Array.from({ length: 5 }, () => Math.floor(Math.random() * 256));
    return `QD-${Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')}`;
  });
  const withLeadRef = text => text.includes(leadRef) ? text : `${text.trim()}\n\nКод с сайта: ${leadRef}`;

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
    // /api/track.php is shadowed by a legacy PHP file on shared hosting;
    // /api/track always reaches the application.
    if (navigator.sendBeacon?.('/api/track', new Blob([payload], { type: 'application/json' }))) {
      return;
    }
    fetch('/api/track', {
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
    if (href.includes('wa.me') || href.includes('whatsapp')) {
      try {
        const url = new URL(link.href);
        if (url.hostname === 'wa.me') {
          // encodeURIComponent keeps spaces as %20; WhatsApp may show "+" literally.
          const text = withLeadRef(url.searchParams.get('text') || 'Здравствуйте! Хочу обсудить проект.');
          link.href = `${url.origin}${url.pathname}?text=${encodeURIComponent(text)}`;
        }
      } catch {}
      track('whatsapp_click', label, { channel: 'whatsapp', ref: leadRef });
    }
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
      const text = withLeadRef([
        'Здравствуйте! Хочу обсудить проект.',
        '',
        `Имя: ${name}`,
        `Задача: ${service}`,
        `Описание: ${message}`
      ].join('\n'));
      // Opening WhatsApp is not a lead yet: the visitor still has to press send.
      track('whatsapp_form_submit', service, { channel: 'whatsapp', service, ref: leadRef });
      const whatsapp = `https://wa.me/77000300024?text=${encodeURIComponent(text)}`;
      // In-app browsers (Instagram, Facebook) often block new windows; the
      // message must still reach WhatsApp instead of silently disappearing.
      const opened = window.open(whatsapp, '_blank');
      if (opened) opened.opener = null;
      else location.assign(whatsapp);
      return;
    }

    track('form_submit', label, { service });
  });
})();
