/* QazDev Studio — main.js */

/* Google AdSense */
(function loadAdSense() {
  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8638191147118359';
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
})();

const WA_NUMBER = '77000300024';

/* === HEADER SCROLL === */
const header = document.getElementById('header');
let lastScroll = 0;

window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (header) {
    if (y > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }
  lastScroll = y;
}, { passive: true });

/* === MOBILE MENU === */
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');

if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('open');
    navToggle.classList.toggle('active', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  navMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('open');
      navToggle.classList.remove('active');
      navToggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    });
  });
}

/* === SMOOTH SCROLL WITH HEADER OFFSET === */
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const offset = (header?.offsetHeight || 72) + 16;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

/* === ACTIVE NAV HIGHLIGHT === */
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link');

const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id;
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
      });
    }
  });
}, { rootMargin: '-40% 0px -50% 0px' });

sections.forEach(s => sectionObserver.observe(s));

/* === SCROLL REVEAL === */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const delay = el.dataset.revealDelay || 0;
      setTimeout(() => el.classList.add('revealed'), delay);
      revealObserver.unobserve(el);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('[data-reveal]').forEach((el, i) => {
  el.dataset.revealDelay = (i % 4) * 80;
  revealObserver.observe(el);
});

/* === METRIC BARS === */
const metricObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.metric-fill').forEach(fill => {
        const w = fill.dataset.width;
        if (w) {
          fill.style.setProperty('--w', w + '%');
          setTimeout(() => fill.classList.add('animated'), 200);
        }
      });
      metricObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.3 });

document.querySelectorAll('.card-metrics').forEach(el => metricObserver.observe(el));

/* === FAQ ACCORDION === */
document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const answer = item.querySelector('.faq-answer');
    const isOpen = btn.getAttribute('aria-expanded') === 'true';

    // Close all others
    document.querySelectorAll('.faq-item').forEach(other => {
      if (other !== item) {
        other.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        other.querySelector('.faq-answer').classList.remove('open');
      }
    });

    btn.setAttribute('aria-expanded', String(!isOpen));
    answer.classList.toggle('open', !isOpen);

    if (!isOpen) {
      trackEvent('faq_open', btn.querySelector('span')?.textContent?.trim()?.substring(0, 80) || '');
    }
  });
});

/* === WHATSAPP FORM === */
const projectForm = document.getElementById('projectForm');
if (projectForm) projectForm.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;

  const service = form.querySelector('input[name="service"]:checked')?.value || 'Не выбрано';
  const city    = form.querySelector('#city').value.trim()    || 'Не указан';
  const phone   = form.querySelector('#phone').value.trim();
  const comment = form.querySelector('#comment').value.trim() || 'Без комментария';

  // Track lead before opening WhatsApp
  trackEvent('form_submit', 'Отправка заявки', { service, city, phone, comment });

  // UX feedback
  const btn = form.querySelector('[type="submit"]');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Заявка подготовлена. Открываю WhatsApp...';
    btn.disabled = true;
    setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 4000);
  }

  setTimeout(() => {
    const text = `Здравствуйте! Хочу обсудить проект для QazDev Studio.\n\nНужно: ${service}\nГород: ${city}${phone ? '\nТелефон: ' + phone : ''}\nКомментарий: ${comment}`;
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }, 600);
});

/* === MAGNETIC BUTTONS === */
if (window.matchMedia('(pointer: fine)').matches) {
  document.querySelectorAll('.magnetic').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.25;
      const y = (e.clientY - r.top - r.height / 2) * 0.25;
      btn.style.transform = `translate(${x}px, ${y}px)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  });
}

/* === PANEL STATUS CYCLING === */
(function initPanelAnimation() {
  const statuses = [
    { text: 'Принято', cls: 'status-accepted' },
    { text: 'В обработке', cls: 'status-processing' },
    { text: 'Готово', cls: 'status-done' },
  ];

  // Inject extra status styles
  const style = document.createElement('style');
  style.textContent = `
    .status-processing { background: rgba(245,197,66,0.12); color: #F5C542; border: 1px solid rgba(245,197,66,0.25); }
    .status-done { background: rgba(37,99,235,0.12); color: #2563EB; border: 1px solid rgba(37,99,235,0.25); }
  `;
  document.head.appendChild(style);

  let idx = 0;
  const badge = document.querySelector('.status-badge');
  if (!badge) return;

  setInterval(() => {
    idx = (idx + 1) % statuses.length;
    const s = statuses[idx];
    badge.className = 'card-val status-badge ' + s.cls;
    badge.innerHTML = `<span class="status-dot"></span>${s.text}`;
  }, 4000);
})();

/* === TYPING EFFECT (Hero badge — subtle) === */
(function initTyping() {
  const badge = document.querySelector('.hero-badge .mono');
  if (!badge) return;
  const original = badge.textContent;
  badge.textContent = '';
  badge.style.borderRight = '1px solid rgba(0,212,255,0.7)';
  badge.style.display = 'inline-block';

  let i = 0;
  const type = () => {
    if (i < original.length) {
      badge.textContent += original[i++];
      setTimeout(type, 40);
    } else {
      // Blink cursor then remove
      setTimeout(() => { badge.style.borderRight = 'none'; }, 1200);
    }
  };

  // Start after short delay
  setTimeout(type, 800);
})();

/* === CONNECTOR DOTS STAGGER === */
document.querySelectorAll('.connector-dot').forEach((dot, i) => {
  dot.style.animationDelay = `${i * 0.6}s`;
});

/* === INDUSTRY CARDS STAGGER === */
document.querySelectorAll('.industry-card[data-reveal]').forEach((card, i) => {
  card.style.transitionDelay = `${i * 50}ms`;
});

/* === PIPELINE CURRENT STAGE CYCLE === */
(function initPipeline() {
  const stages = document.querySelectorAll('.pipe-stage');
  if (!stages.length) return;
  let active = 2; // start at "Оплата"

  setInterval(() => {
    stages.forEach((s, i) => {
      s.classList.remove('pipe-active', 'pipe-current');
      if (i < active) s.classList.add('pipe-active');
      if (i === active) s.classList.add('pipe-current');
    });
    active = (active + 1) % stages.length;
  }, 2500);
})();

/* === PARALLAX HERO (subtle) === */
if (window.matchMedia('(pointer: fine)').matches) {
  const heroBg = document.querySelector('.hero-glow');
  if (heroBg) {
    document.addEventListener('mousemove', e => {
      const x = (e.clientX / window.innerWidth - 0.5) * 30;
      const y = (e.clientY / window.innerHeight - 0.5) * 20;
      heroBg.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }, { passive: true });
  }
}

/* ================================================
   ANALYTICS TRACKING
   BOT_TOKEN never touches this file — all events
   go to /api/track.php (backend only).
   ================================================ */

const TRACK_URL = '/api/track.php';

function _qdVid() {
  let id = localStorage.getItem('qd_vid');
  if (!id) {
    id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    localStorage.setItem('qd_vid', id);
  }
  return id;
}

function _qdSid() {
  let id = sessionStorage.getItem('qd_sid');
  if (!id) {
    id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    sessionStorage.setItem('qd_sid', id);
  }
  return id;
}

function trackEvent(eventType, eventLabel = '', extra = {}) {
  try {
    const sp = new URLSearchParams(location.search);
    const payload = JSON.stringify({
      visitor_id:   _qdVid(),
      session_id:   _qdSid(),
      event_type:   eventType,
      event_label:  String(eventLabel).substring(0, 200),
      page_url:     location.pathname + location.search,
      page_title:   document.title,
      referrer:     document.referrer,
      utm_source:   sp.get('utm_source')   || '',
      utm_medium:   sp.get('utm_medium')   || '',
      utm_campaign: sp.get('utm_campaign') || '',
      extra,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(TRACK_URL, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(TRACK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch (_) {}
}

// Page view on load
trackEvent('page_view');

// Scroll depth
(function () {
  const sent = { 50: false, 90: false };
  window.addEventListener('scroll', () => {
    const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100;
    if (!sent[50] && pct >= 50) { sent[50] = true; trackEvent('scroll_50', '50%'); }
    if (!sent[90] && pct >= 90) { sent[90] = true; trackEvent('scroll_90', '90%'); }
  }, { passive: true });
})();

// Service selection in form
document.querySelectorAll('input[name="service"]').forEach(r => {
  r.addEventListener('change', () => trackEvent('service_select', r.value));
});

// Global click delegation — links and CTA buttons
document.addEventListener('click', e => {
  try {
    // Links
    const link = e.target.closest('a[href]');
    if (link) {
      const href = link.getAttribute('href') || '';
      const txt  = link.textContent.trim().substring(0, 100);
      if (href.includes('wa.me'))               { trackEvent('whatsapp_click', txt); trackEvent('contact_intent', 'WhatsApp'); }
      else if (href.includes('t.me'))           { trackEvent('telegram_click',  txt); trackEvent('contact_intent', 'Telegram'); }
      else if (href.startsWith('mailto:'))      { trackEvent('email_click',     txt); trackEvent('contact_intent', 'Email'); }
      else if (href.startsWith('tel:'))         { trackEvent('phone_click',     txt); trackEvent('contact_intent', 'Phone'); }
    }

    // Buttons outside the form (CTA, pricing)
    const btn = e.target.closest('button:not([type="submit"]), .btn:not(.btn-whatsapp)');
    if (btn && !btn.closest('form')) {
      const txt = btn.textContent.trim().substring(0, 100);
      if (btn.classList.contains('pricing-btn')) {
        const label = btn.closest('.pricing-card')?.querySelector('.pricing-label')?.textContent?.trim() || txt;
        trackEvent('price_click', label);
      } else if (!btn.classList.contains('nav-toggle') && !btn.classList.contains('faq-question')) {
        trackEvent('button_click', txt);
      }
    }
  } catch (_) {}
}, true);

/* === HOMEPAGE V3 === */
(function initHomepageV3() {
  if (!document.body.classList.contains('home-v3')) return;

  document.body.classList.add('js-ready');
  const items = document.querySelectorAll('.v3-reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -45px' });
    items.forEach((item, index) => {
      item.style.transitionDelay = `${(index % 3) * 70}ms`;
      observer.observe(item);
    });
  } else {
    items.forEach(item => item.classList.add('is-visible'));
  }

  document.querySelectorAll('.v3-accordion details').forEach(item => {
    item.addEventListener('toggle', () => {
      if (!item.open) return;
      document.querySelectorAll('.v3-accordion details[open]').forEach(other => {
        if (other !== item) other.open = false;
      });
    });
  });

  const year = document.getElementById('currentYear');
  if (year) year.textContent = String(new Date().getFullYear());
})();
