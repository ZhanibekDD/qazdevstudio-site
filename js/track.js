/* Minimal analytics tracking for secondary pages */
// /api/track.php is shadowed by a legacy PHP file on shared hosting;
// /api/track always reaches the application.
const TRACK_URL = '/api/track';

function _qdStored(storage, key, create) {
  try {
    let id = storage.getItem(key);
    if (!id) { id = create(); storage.setItem(key, id); }
    return id;
  } catch(_) { return create(); }
}
function _qdVid() {
  return _qdStored(localStorage, 'qd_vid', () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2,7));
}
function _qdSid() {
  return _qdStored(sessionStorage, 'qd_sid', () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2,7));
}
// Short code added to WhatsApp messages: lets a real conversation be matched
// to the page and traffic source of the visit. A click alone is not a lead.
function qdLeadRef() {
  return _qdStored(sessionStorage, 'qazdev_lead_ref', () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'QD-';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  });
}
function qdWithRef(text) {
  const ref = qdLeadRef();
  return text.includes(ref) ? text : text.trim() + '\n\nКод с сайта: ' + ref;
}
function trackEvent(type, label='', extra={}) {
  try {
    if (type === 'whatsapp_click') extra = Object.assign({ channel: 'whatsapp', ref: qdLeadRef() }, extra);
    const sp = new URLSearchParams(location.search);
    const p = JSON.stringify({ visitor_id:_qdVid(), session_id:_qdSid(), event_type:type, event_label:String(label).substring(0,200), page_url:location.pathname+location.search, page_title:document.title, referrer:document.referrer, utm_source:sp.get('utm_source')||'', utm_medium:sp.get('utm_medium')||'', utm_campaign:sp.get('utm_campaign')||'', extra });
    if (!(navigator.sendBeacon && navigator.sendBeacon(TRACK_URL, new Blob([p],{type:'application/json'})))) {
      fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:p,keepalive:true}).catch(()=>{});
    }
  } catch(_) {}
}
document.addEventListener('click', e => {
  try {
    const a = e.target.closest('a[href]');
    if (a) {
      const h = a.getAttribute('href')||'', t = a.textContent.trim().substring(0,100);
      // Links with their own onclick="trackEvent(...)" are already counted.
      const tracked = (a.getAttribute('onclick')||'').includes('trackEvent');
      if (h.includes('wa.me')) {
        try {
          // encodeURIComponent keeps spaces as %20; WhatsApp may show "+" literally.
          const url = new URL(a.href);
          const text = qdWithRef(url.searchParams.get('text') || 'Здравствуйте! Хочу обсудить проект.');
          a.href = url.origin + url.pathname + '?text=' + encodeURIComponent(text);
        } catch(_) {}
        if (!tracked) trackEvent('whatsapp_click', t);
      }
      else if (tracked)                 { return; }
      else if (h.includes('t.me'))      { trackEvent('telegram_click', t); }
      else if (h.startsWith('tel:'))    { trackEvent('phone_click', t); }
      else if (h.startsWith('mailto:')) { trackEvent('email_click', t); }
    }
  } catch(_) {}
}, true);
trackEvent('page_view');
