(() => {
  const menuButton = document.querySelector('.menu-button');
  const nav = document.querySelector('#site-nav');
  if (menuButton && nav) {
    const label = menuButton.querySelector('.menu-label') || menuButton;
    const setMenu = open => {
      nav.classList.toggle('open', open);
      document.body.classList.toggle('menu-open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      label.textContent = open ? 'Закрыть' : 'Меню';
    };
    menuButton.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
    nav.addEventListener('click', event => {
      if (event.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && nav.classList.contains('open')) setMenu(false);
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
  // Storage can be missing or throw on access (blocked cookies, privacy modes);
  // touching it outside try would stop this script and the WhatsApp form with it.
  const remember = (storageName, key, create) => {
    try {
      const saved = self[storageName].getItem(key);
      if (saved) return saved;
    } catch {}
    const value = create();
    try {
      self[storageName].setItem(key, value);
    } catch {}
    return value;
  };
  const visitorId = remember('localStorage', 'qazdev_visitor_v2', () => randomId('v'));
  const sessionId = remember('sessionStorage', 'qazdev_session_v2', () => randomId('s'));
  // Short code added to WhatsApp messages: lets a real conversation be matched
  // to the page and traffic source of the visit. A click alone is not a lead.
  const leadRef = remember('sessionStorage', 'qazdev_lead_ref', () => {
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

// Motion layer. Content is complete without it: reveal states are applied only
// after this script runs, and reduced-motion users get the static page.
(() => {
  window.__qdMotion = true;
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const splitWords = element => {
    let index = 0;
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          const fragment = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              fragment.append(document.createTextNode(part));
              return;
            }
            const outer = document.createElement('span');
            const inner = document.createElement('span');
            outer.className = 'w';
            inner.textContent = part;
            inner.style.setProperty('--wi', index++);
            outer.append(inner);
            fragment.append(outer);
          });
          child.replaceWith(fragment);
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
          walk(child);
        }
      });
    };
    walk(element);
    element.classList.add('is-split');
  };

  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>/_';
  const scramble = element => {
    const original = element.textContent;
    const frames = 22;
    let frame = 0;
    const tick = () => {
      frame += 1;
      const settled = Math.floor((frame / frames) * original.length);
      element.textContent = [...original].map((char, i) => (
        i < settled || char === ' ' || char === '/' ? char : glyphs[Math.floor(Math.random() * glyphs.length)]
      )).join('');
      if (frame < frames) requestAnimationFrame(tick);
      else element.textContent = original;
    };
    tick();
  };

  const countUp = element => {
    const target = Number(element.dataset.count);
    if (!Number.isFinite(target)) return;
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / 1500);
      element.textContent = String(Math.round(target * (1 - (1 - t) ** 4)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const typeLoop = element => {
    const text = element.dataset.type || '';
    let length = 0;
    let deleting = false;
    const tick = () => {
      element.textContent = text.slice(0, length);
      let delay = deleting ? 24 : 58;
      if (!deleting && length < text.length) length += 1;
      else if (!deleting) { deleting = true; delay = 2400; }
      else if (length > 0) length -= 1;
      else { deleting = false; delay = 500; }
      setTimeout(tick, delay);
    };
    tick();
  };

  const observed = document.querySelectorAll('[data-reveal], [data-split], [data-scramble], [data-count], [data-type]');
  if (reduce || !('IntersectionObserver' in window)) {
    observed.forEach(element => element.classList.add('is-in'));
  } else {
    document.querySelectorAll('[data-split]').forEach(splitWords);
    const enter = element => {
      element.classList.add('is-in');
      if (element.hasAttribute('data-scramble')) scramble(element);
      if (element.hasAttribute('data-count')) countUp(element);
      if (element.hasAttribute('data-type')) typeLoop(element);
    };
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        enter(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    observed.forEach(element => observer.observe(element));

    // Pause decorative loops while their section is off screen.
    const ambient = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.target.classList.toggle('is-offscreen', !entry.isIntersecting));
    });
    document.querySelectorAll('.hero, .marquee, .lead-panel, .case-screen').forEach(element => ambient.observe(element));
  }

  const header = document.querySelector('[data-header]');
  const progressBar = document.querySelector('.scroll-progress');
  const processLists = [...document.querySelectorAll('[data-process] .process-steps')];
  const art = document.querySelector('.hero-art[data-depth]');
  const narrow = matchMedia('(max-width: 980px)');
  let pointerX = 0;
  let pointerY = 0;
  let lastY = scrollY;
  let queued = false;

  const updateProcess = () => processLists.forEach(list => {
    const rect = list.getBoundingClientRect();
    const vertical = narrow.matches;
    const span = vertical ? rect.height : innerHeight * 0.55;
    const progress = reduce ? 1 : clamp((innerHeight * 0.8 - rect.top) / span, 0, 1);
    list.style.setProperty('--progress', progress.toFixed(3));
    const reach = progress * (vertical ? list.offsetHeight : list.offsetWidth);
    [...list.children].forEach(step => {
      step.classList.toggle('is-active', (vertical ? step.offsetTop : step.offsetLeft) <= reach + 4);
    });
  });

  const updateParallax = () => {
    if (!art || reduce) return;
    const depth = Number(art.dataset.depth) || 0;
    art.style.setProperty('--px', `${(pointerX * depth).toFixed(1)}px`);
    art.style.setProperty('--py', `${(Math.min(scrollY, innerHeight) * 0.18 + pointerY * depth).toFixed(1)}px`);
  };

  const onScroll = () => {
    queued = false;
    const y = scrollY;
    const max = root.scrollHeight - innerHeight;
    progressBar?.style.setProperty('--p', max > 0 ? clamp(y / max, 0, 1).toFixed(4) : '0');
    if (header) {
      header.classList.toggle('is-scrolled', y > 20);
      const menuOpen = document.body.classList.contains('menu-open');
      if (!menuOpen && y > 420 && y > lastY + 2) header.classList.add('is-hidden');
      else if (y < lastY - 2 || y <= 420 || menuOpen) header.classList.remove('is-hidden');
    }
    lastY = y;
    updateProcess();
    updateParallax();
  };
  addEventListener('scroll', () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  onScroll();

  if (!finePointer || reduce) return;
  root.classList.add('has-pointer');

  const glow = document.querySelector('.cursor-glow');
  let targetX = innerWidth / 2;
  let targetY = innerHeight / 2;
  let glowX = targetX;
  let glowY = targetY;
  let glowFrame = 0;
  const follow = () => {
    glowX += (targetX - glowX) * 0.14;
    glowY += (targetY - glowY) * 0.14;
    glow?.style.setProperty('--cx', `${glowX.toFixed(1)}px`);
    glow?.style.setProperty('--cy', `${glowY.toFixed(1)}px`);
    glowFrame = Math.abs(targetX - glowX) + Math.abs(targetY - glowY) > 0.6 ? requestAnimationFrame(follow) : 0;
  };

  const local = (event, element) => {
    const rect = element.getBoundingClientRect();
    return { rect, x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  addEventListener('pointermove', event => {
    targetX = event.clientX;
    targetY = event.clientY;
    if (!glowFrame) glowFrame = requestAnimationFrame(follow);
    pointerX = event.clientX / innerWidth - 0.5;
    pointerY = event.clientY / innerHeight - 0.5;
    updateParallax();

    const spotlight = event.target.closest?.('[data-spotlight]');
    if (spotlight) {
      const { rect, x, y } = local(event, spotlight);
      spotlight.style.setProperty('--sx', `${((x / rect.width) * 100).toFixed(1)}%`);
      spotlight.style.setProperty('--sy', `${((y / rect.height) * 100).toFixed(1)}%`);
    }
    const lit = event.target.closest?.('[data-glow], .service-card');
    if (lit) {
      const { x, y } = local(event, lit);
      lit.style.setProperty('--mx', `${x.toFixed(0)}px`);
      lit.style.setProperty('--my', `${y.toFixed(0)}px`);
    }
    const tilt = event.target.closest?.('[data-tilt]');
    if (tilt) {
      const { rect, x, y } = local(event, tilt);
      const rx = (0.5 - y / rect.height) * 9;
      const ry = (x / rect.width - 0.5) * 11;
      tilt.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      tilt.style.setProperty('--mx', `${x.toFixed(0)}px`);
      tilt.style.setProperty('--my', `${y.toFixed(0)}px`);
    }
    const magnet = event.target.closest?.('[data-magnetic]');
    if (magnet) {
      const { rect, x, y } = local(event, magnet);
      magnet.style.setProperty('--tx', `${((x - rect.width / 2) * 0.22).toFixed(1)}px`);
      magnet.style.setProperty('--ty', `${((y - rect.height / 2) * 0.32).toFixed(1)}px`);
    }
  }, { passive: true });

  document.addEventListener('pointerout', event => {
    const leaving = (selector, reset) => {
      const element = event.target.closest?.(selector);
      if (element && !element.contains(event.relatedTarget)) reset(element);
    };
    leaving('[data-tilt]', element => { element.style.transform = ''; });
    leaving('[data-magnetic]', element => {
      element.style.setProperty('--tx', '0px');
      element.style.setProperty('--ty', '0px');
    });
  });

  document.addEventListener('pointerover', event => {
    glow?.classList.toggle('is-hover', Boolean(event.target.closest?.('a, button, input, select, textarea, summary, label')));
  });
})();
