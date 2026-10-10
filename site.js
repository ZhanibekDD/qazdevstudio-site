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

// Signature layer: WebGL hero, custom cursor, pinned horizontal services,
// code-to-interface demo, scroll-velocity marquee and live wordmark.
(() => {
  try { sessionStorage.setItem('qd_intro_seen', '1'); } catch {}
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.documentElement;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const whenVisible = (element, onChange) => {
    if (!('IntersectionObserver' in window)) { onChange(true); return; }
    new IntersectionObserver(([entry]) => onChange(entry.isIntersecting)).observe(element);
  };

  // Liquid gradient in brand colours that bends around the pointer.
  const canvas = document.querySelector('canvas.hero-gl');
  const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' });
  if (canvas && gl) {
    const fragment = `
      precision mediump float;
      uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_hover;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + 0.17; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / u_res;
        vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
        vec2 m = (u_mouse - 0.5 * u_res) / u_res.y;
        float d = length(p - m);
        p += (p - m) * 0.22 * exp(-d * d * 5.0) * u_hover;
        float t = u_time * 0.055;
        vec2 q = vec2(fbm(p * 1.5 + t), fbm(p * 1.5 - t + 4.1));
        vec2 r = vec2(fbm(p * 1.3 + 2.4 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p * 1.3 + 2.4 * q + vec2(8.3, 2.8) - t));
        float f = fbm(p * 1.15 + 2.6 * r);
        vec3 bg = vec3(0.027, 0.031, 0.043);
        vec3 col = mix(bg, vec3(0.20, 0.29, 0.92), smoothstep(0.42, 0.98, f));
        col = mix(col, vec3(0.56, 0.38, 1.0), smoothstep(0.62, 1.15, length(q)) * 0.6);
        col = mix(col, vec3(0.79, 1.0, 0.29), smoothstep(0.86, 1.18, r.x * f * 1.7) * 0.42);
        col += vec3(0.36, 0.45, 1.0) * 0.22 * exp(-d * d * 9.0) * u_hover;
        col *= smoothstep(1.25, 0.15, length((uv - vec2(0.66, 0.5)) * vec2(1.0, 1.25)));
        col = mix(bg, col, 0.85);
        col += (hash(gl_FragCoord.xy + u_time) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
    const pixels = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (vertex && pixels) {
      gl.attachShader(program, vertex);
      gl.attachShader(program, pixels);
      gl.linkProgram(program);
    }
    if (vertex && pixels && gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'p');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const uniform = name => gl.getUniformLocation(program, name);
      const uRes = uniform('u_res');
      const uTime = uniform('u_time');
      const uMouse = uniform('u_mouse');
      const uHover = uniform('u_hover');
      const hero = canvas.closest('.hero') || canvas.parentElement;
      let width = 1;
      let height = 1;
      // Drops resolution on devices that cannot keep up.
      let quality = 1;
      let lastFrame = 0;
      let slowFrames = 0;
      let countedFrames = 0;
      let frameTime = 0;
      let warmup = 8;
      let stopped = false;
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const scale = (innerWidth < 700 ? 0.42 : 0.55) * quality;
        width = Math.max(1, Math.round(rect.width * scale));
        height = Math.max(1, Math.round(rect.height * scale));
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      };
      resize();
      addEventListener('resize', resize, { passive: true });
      let mx = 0.66, my = 0.55, tx = mx, ty = my, hover = 0, targetHover = finePointer ? 0 : 0.7;
      hero.addEventListener('pointermove', event => {
        const rect = canvas.getBoundingClientRect();
        tx = (event.clientX - rect.left) / rect.width;
        ty = 1 - (event.clientY - rect.top) / rect.height;
        targetHover = 1;
      }, { passive: true });
      hero.addEventListener('pointerleave', () => { targetHover = finePointer ? 0 : 0.7; });
      let visible = true;
      let frame = 0;
      const started = performance.now();
      const draw = now => {
        frame = 0;
        if (stopped || !visible || document.hidden) { lastFrame = 0; return; }
        if (lastFrame && --warmup < 0) {
          countedFrames += 1;
          frameTime += now - lastFrame;
          if (now - lastFrame > 28) slowFrames += 1;
          if (countedFrames === 20 || (countedFrames >= 6 && frameTime > 1200)) {
            // Too slow even at the lowest resolution: fall back to the CSS background.
            if (frameTime / countedFrames > 45 || (slowFrames > 12 && quality <= 0.5)) {
              stopped = true;
              hero.classList.remove('has-gl');
              return;
            }
            if (slowFrames > 12) { quality -= 0.25; resize(); }
            countedFrames = 0;
            slowFrames = 0;
            frameTime = 0;
          }
        }
        lastFrame = now;
        const seconds = (now - started) / 1000;
        if (!finePointer) {
          tx = 0.6 + 0.22 * Math.sin(seconds * 0.35);
          ty = 0.5 + 0.18 * Math.cos(seconds * 0.27);
        }
        mx += (tx - mx) * 0.06;
        my += (ty - my) * 0.06;
        hover += (targetHover - hover) * 0.05;
        gl.uniform2f(uRes, width, height);
        gl.uniform1f(uTime, seconds);
        gl.uniform2f(uMouse, mx * width, my * height);
        gl.uniform1f(uHover, hover);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        frame = requestAnimationFrame(draw);
      };
      const wake = () => { if (visible && !document.hidden && !frame) frame = requestAnimationFrame(draw); };
      whenVisible(canvas, isVisible => { visible = isVisible; wake(); });
      document.addEventListener('visibilitychange', wake);
      canvas.addEventListener('webglcontextlost', () => hero.classList.remove('has-gl'));
      hero.classList.add('has-gl');
      wake();
    }
  }

  // Cursor: dot follows exactly, ring trails and describes the target.
  const cursor = document.querySelector('.cursor');
  if (finePointer && cursor) {
    const dot = cursor.querySelector('.cursor-dot');
    const ring = cursor.querySelector('.cursor-ring');
    const label = cursor.querySelector('.cursor-label');
    root.classList.add('has-cursor');
    let x = -100, y = -100, rx = x, ry = y, frame = 0;
    const trail = () => {
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      ring.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`;
      frame = Math.abs(x - rx) + Math.abs(y - ry) > 0.3 ? requestAnimationFrame(trail) : 0;
    };
    addEventListener('pointermove', event => {
      x = event.clientX;
      y = event.clientY;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      cursor.classList.add('is-visible');
      if (!frame) frame = requestAnimationFrame(trail);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));
    document.addEventListener('pointerover', event => {
      const text = event.target.closest?.('input, textarea');
      const labelled = event.target.closest?.('[data-cursor]');
      const link = event.target.closest?.('a, button, summary, label, select, [data-cursor]');
      cursor.classList.toggle('is-text', Boolean(text));
      cursor.classList.toggle('is-link', Boolean(link) && !text);
      cursor.classList.toggle('has-label', Boolean(labelled) && !text);
      label.textContent = labelled ? labelled.dataset.cursor : '';
    });
    addEventListener('pointerdown', () => cursor.classList.add('is-down'));
    addEventListener('pointerup', () => cursor.classList.remove('is-down'));
  }

  // Services pinned on wide screens: vertical scroll moves the cards sideways.
  const pinned = document.querySelector('[data-hscroll]');
  if (pinned) {
    const track = pinned.querySelector('.hscroll-track');
    const wide = matchMedia('(min-width: 1100px)');
    let overflow = 0;
    const update = () => {
      if (!pinned.classList.contains('hscroll-on')) return;
      const progress = clamp(-pinned.getBoundingClientRect().top / Math.max(1, overflow), 0, 1);
      track.style.transform = `translate3d(${(-progress * overflow).toFixed(1)}px, 0, 0)`;
      pinned.style.setProperty('--hp', progress.toFixed(3));
    };
    const measure = () => {
      pinned.classList.toggle('hscroll-on', wide.matches);
      if (!wide.matches) {
        pinned.style.height = '';
        track.style.transform = '';
        return;
      }
      overflow = Math.max(0, track.scrollWidth - innerWidth);
      pinned.style.height = `${Math.round(innerHeight + overflow)}px`;
      update();
    };
    measure();
    addEventListener('resize', measure, { passive: true });
    addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  }

  // Code types itself while the page it describes assembles.
  const build = document.querySelector('[data-build]');
  if (build) {
    const code = build.querySelector('code');
    const steps = [...build.querySelectorAll('.bp-step')];
    const lines = [
      [0, [['tk-tag', '<header>'], ['', ' логотип · меню · WhatsApp '], ['tk-tag', '</header>']]],
      [1, [['tk-tag', '<h1>'], ['', 'Запись в клинику онлайн'], ['tk-tag', '</h1>']]],
      [2, [['tk-tag', '<a '], ['tk-attr', 'class'], ['', '='], ['tk-str', '"cta"'], ['tk-attr', ' href'], ['', '='], ['tk-str', '"wa.me/…"'], ['tk-tag', '>'], ['', 'Записаться'], ['tk-tag', '</a>']]],
      [3, [['tk-tag', '<section '], ['tk-attr', 'class'], ['', '='], ['tk-str', '"services"'], ['tk-tag', '>'], ['', ' × 3 '], ['tk-tag', '</section>']]],
      [4, [['tk-tag', '<form '], ['tk-attr', 'data-lead'], ['tk-tag', '>'], ['', ' имя · телефон '], ['tk-tag', '</form>']]],
      [-1, []],
      [5, [['tk-fn', 'notify'], ['', '('], ['tk-str', '"telegram"'], ['', ', lead);'], ['tk-com', '  // заявка не теряется']]],
    ];
    const caret = document.createElement('span');
    caret.className = 'caret';
    let visible = false;
    let running = false;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const play = async () => {
      running = true;
      while (visible) {
        code.textContent = '';
        steps.forEach(step => step.classList.remove('is-on'));
        for (const [index, [step, parts]] of lines.entries()) {
          const line = document.createElement('span');
          line.className = 'ln';
          line.dataset.n = String(index + 1);
          code.append(line);
          line.append(caret);
          for (const [kind, text] of parts) {
            const token = document.createElement('span');
            if (kind) token.className = kind;
            line.insertBefore(token, caret);
            for (const char of text) {
              token.textContent += char;
              await wait(char === ' ' ? 12 : 26);
            }
          }
          if (step >= 0) steps[step]?.classList.add('is-on');
          await wait(260);
        }
        await wait(4200);
      }
      running = false;
    };
    whenVisible(build, isVisible => {
      visible = isVisible;
      if (visible && !running) play();
    });
  }

  // Marquee speed and skew follow scroll velocity and direction.
  const rows = [...document.querySelectorAll('.marquee-row')];
  const marquee = document.querySelector('.marquee');
  if (rows.length && marquee) {
    root.classList.add('js-marquee');
    const offsets = rows.map(() => 0);
    let velocity = 0;
    let direction = 1;
    let lastY = scrollY;
    let active = true;
    let frame = 0;
    addEventListener('scroll', () => {
      const dy = scrollY - lastY;
      lastY = scrollY;
      if (dy) direction = Math.sign(dy);
      velocity = clamp(velocity + dy * 0.08, -22, 22);
    }, { passive: true });
    const tick = () => {
      frame = 0;
      if (!active) return;
      velocity *= 0.92;
      rows.forEach((row, index) => {
        const half = row.scrollWidth / 2;
        const sign = index === 0 ? -1 : 1;
        offsets[index] += ((index === 0 ? 0.7 : 0.5) + Math.abs(velocity) * 0.6) * sign * direction;
        offsets[index] = ((offsets[index] % half) + half) % half - half;
        row.style.transform = `translate3d(${offsets[index].toFixed(1)}px, 0, 0) skewX(${(-velocity * 0.4).toFixed(2)}deg)`;
      });
      frame = requestAnimationFrame(tick);
    };
    whenVisible(marquee, isVisible => {
      active = isVisible;
      if (active && !frame) frame = requestAnimationFrame(tick);
    });
  }

  // Footer wordmark letters gain weight near the pointer (variable font).
  const word = document.querySelector('.footer-wordmark span');
  if (finePointer && word) {
    const letters = [...word.textContent].map(char => {
      const letter = document.createElement('span');
      letter.textContent = char;
      return letter;
    });
    word.textContent = '';
    word.classList.add('letters');
    letters.forEach(letter => word.append(letter));
    addEventListener('pointermove', event => {
      const box = word.getBoundingClientRect();
      if (event.clientY < box.top - 260 || event.clientY > box.bottom + 260) return;
      letters.forEach(letter => {
        const rect = letter.getBoundingClientRect();
        const distance = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
        letter.style.fontVariationSettings = `"wght" ${Math.round(400 + 500 * clamp(1 - distance / 460, 0, 1))}`;
      });
    }, { passive: true });
  }
})();

// v3: raymarched 3D brand mark, scroll-lit manifesto and live work screenshots.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Glassy chrome "Q" from the logo, rendered with a signed distance field.
  const canvas = document.querySelector('canvas.hero-q');
  const gl = canvas?.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, powerPreference: 'low-power' });
  if (canvas && gl) {
    const fragment = `
      precision highp float;
      uniform vec2 u_res; uniform float u_time; uniform vec2 u_rot; uniform float u_steps;
      mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
      float sdRoundRect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      float sdCapsule(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
      vec2 map(vec3 p) {
        p.y -= 0.07 * sin(u_time * 0.9);
        p.xz = rot(u_rot.x + 0.32 * sin(u_time * 0.35)) * p.xz;
        p.yz = rot(u_rot.y + 0.16 * sin(u_time * 0.28)) * p.yz;
        p.xy = rot(0.1) * p.xy;
        p += vec3(0.1, -0.14, 0.0);
        float ring2d = abs(sdRoundRect(p.xy, vec2(0.61, 0.67), 0.3)) - 0.14;
        vec2 w = vec2(ring2d, abs(p.z) - 0.11);
        float ring = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.05;
        float tail = sdCapsule(p, vec3(0.19, -0.36, 0.0), vec3(0.78, -0.94, 0.0), 0.15);
        return ring < tail ? vec2(ring, 0.0) : vec2(tail, 1.0);
      }
      vec3 normalAt(vec3 p) {
        vec2 e = vec2(0.0015, 0.0);
        return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x));
      }
      vec3 env(vec3 r) {
        vec3 c = mix(vec3(0.02, 0.025, 0.05), vec3(0.22, 0.3, 0.9), smoothstep(-0.3, 0.8, r.y));
        c += vec3(0.79, 1.0, 0.29) * pow(max(dot(r, normalize(vec3(0.7, 0.5, 0.4))), 0.0), 18.0) * 1.4;
        c += vec3(0.62, 0.42, 1.0) * pow(max(dot(r, normalize(vec3(-0.8, 0.1, 0.5))), 0.0), 6.0) * 0.9;
        c += vec3(1.0) * smoothstep(0.96, 1.0, abs(sin(r.y * 9.0 + r.x * 3.0 + u_time * 0.2))) * 0.25;
        return c;
      }
      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
        vec3 ro = vec3(0.0, 0.0, 4.5);
        vec3 rd = normalize(vec3(uv, -1.75));
        float b = dot(ro, rd), c = dot(ro, ro) - 2.4, h = b * b - c;
        vec4 color = vec4(0.0);
        float closest = 10.0;
        if (h > 0.0) {
          float t = -b - sqrt(h), tMax = -b + sqrt(h);
          vec2 hit = vec2(1.0, 0.0);
          for (int i = 0; i < 90; i++) {
            if (float(i) >= u_steps) break;
            hit = map(ro + rd * t);
            closest = min(closest, hit.x);
            if (hit.x < 0.0015 || t > tMax) break;
            t += hit.x * 0.9;
          }
          if (hit.x < 0.0015) {
            vec3 p = ro + rd * t, n = normalAt(p);
            float fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
            vec3 base = hit.y > 0.5 ? vec3(0.72, 1.0, 0.22) : vec3(0.32, 0.42, 1.0);
            float diff = max(dot(n, normalize(vec3(0.5, 0.8, 0.6))), 0.0);
            vec3 col = base * (0.12 + 0.6 * diff) + env(reflect(rd, n)) * (0.45 + 0.55 * fres);
            col += fres * mix(vec3(0.6, 0.45, 1.0), vec3(0.79, 1.0, 0.29), hit.y) * 0.55;
            color = vec4(col, 1.0);
          }
        }
        if (color.a < 1.0) {
          float halo = exp(-closest * 9.0) * 0.36;
          color = vec4(vec3(0.36, 0.45, 1.0) * halo, halo);
        }
        gl_FragColor = color;
      }`;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}');
    const pixels = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (vertex && pixels) {
      gl.attachShader(program, vertex);
      gl.attachShader(program, pixels);
      gl.linkProgram(program);
    }
    if (vertex && pixels && gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'p');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const uRes = gl.getUniformLocation(program, 'u_res');
      const uTime = gl.getUniformLocation(program, 'u_time');
      const uRot = gl.getUniformLocation(program, 'u_rot');
      const uSteps = gl.getUniformLocation(program, 'u_steps');
      const hero = canvas.closest('.hero');
      // Quality levels drop automatically if frames take too long.
      const levels = finePointer ? [[1.25, 90], [0.9, 70], [0.65, 56]] : [[1, 70], [0.75, 56], [0.55, 44]];
      let level = 0;
      let width = 1;
      let height = 1;
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const scale = Math.min(devicePixelRatio || 1, 1.5) * levels[level][0];
        width = Math.max(1, Math.round(rect.width * scale));
        height = Math.max(1, Math.round(rect.height * scale));
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      };
      resize();
      addEventListener('resize', resize, { passive: true });
      let rx = 0, ry = 0, targetX = 0, targetY = 0;
      addEventListener('pointermove', event => {
        targetX = (event.clientX / innerWidth - 0.5) * 1.1;
        targetY = (event.clientY / innerHeight - 0.5) * 0.7;
      }, { passive: true });
      let visible = true;
      let frame = 0;
      let last = 0;
      let slow = 0;
      let counted = 0;
      let spent = 0;
      let warmup = 8;
      let stopped = false;
      const started = performance.now();
      const draw = now => {
        frame = 0;
        if (stopped || !visible || document.hidden) { last = 0; return; }
        if (last && --warmup < 0) {
          counted += 1;
          spent += now - last;
          if (now - last > 28) slow += 1;
          if (counted === 20 || (counted >= 6 && spent > 1200)) {
            // Too slow even at the lowest level: show the static artwork instead.
            if (spent / counted > 45 || (slow > 12 && level === levels.length - 1)) {
              stopped = true;
              hero?.classList.remove('has-q');
              return;
            }
            if (slow > 12) { level += 1; resize(); }
            counted = 0;
            slow = 0;
            spent = 0;
          }
        }
        last = now;
        rx += (targetX + scrollY * 0.0016 - rx) * 0.06;
        ry += (targetY - ry) * 0.06;
        gl.uniform2f(uRes, width, height);
        gl.uniform1f(uTime, (now - started) / 1000);
        gl.uniform2f(uRot, rx, ry);
        gl.uniform1f(uSteps, levels[level][1]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        frame = requestAnimationFrame(draw);
      };
      const wake = () => { if (visible && !document.hidden && !frame) frame = requestAnimationFrame(draw); };
      if ('IntersectionObserver' in window) new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); }).observe(canvas);
      document.addEventListener('visibilitychange', wake);
      canvas.addEventListener('webglcontextlost', () => hero?.classList.remove('has-q'));
      hero?.classList.add('has-q');
      wake();
    }
  }

  // Manifesto words light up as the pinned statement scrolls past.
  const manifesto = document.querySelector('[data-manifesto]');
  if (manifesto) {
    const text = manifesto.querySelector('.manifesto-text');
    const words = [];
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          const fragment = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { fragment.append(document.createTextNode(part)); return; }
            const word = document.createElement('span');
            word.className = 'mw';
            word.textContent = part;
            words.push(word);
            fragment.append(word);
          });
          child.replaceWith(fragment);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      });
    };
    walk(text);
    manifesto.classList.add('manifesto-on');
    const update = () => {
      const rect = manifesto.getBoundingClientRect();
      const span = Math.max(1, manifesto.offsetHeight - innerHeight * 0.6);
      const progress = clamp((innerHeight * 0.55 - rect.top) / span, 0, 1);
      const lit = Math.round(progress * words.length);
      words.forEach((word, index) => word.classList.toggle('lit', index < lit));
      manifesto.style.setProperty('--mp', progress.toFixed(3));
    };
    update();
    addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    addEventListener('resize', update, { passive: true });
  }

  // Real screenshots scroll inside their device frames with the page.
  const shots = [...document.querySelectorAll('img[data-shot]')];
  if (shots.length) {
    const state = shots.map(() => ({ y: 0 }));
    let frame = 0;
    const tick = () => {
      frame = 0;
      let moving = false;
      shots.forEach((img, index) => {
        const box = img.parentElement.getBoundingClientRect();
        const travel = Math.max(0, img.getBoundingClientRect().height - box.height);
        const progress = clamp((innerHeight - box.top) / (innerHeight + box.height), 0, 1);
        const target = -travel * progress;
        state[index].y += (target - state[index].y) * 0.12;
        if (Math.abs(target - state[index].y) > 0.5) moving = true;
        img.style.setProperty('--shot-y', `${state[index].y.toFixed(1)}px`);
      });
      if (moving) frame = requestAnimationFrame(tick);
    };
    const kick = () => { if (!frame) frame = requestAnimationFrame(tick); };
    addEventListener('scroll', kick, { passive: true });
    shots.forEach(img => img.addEventListener('load', kick));
    kick();
  }
})();
