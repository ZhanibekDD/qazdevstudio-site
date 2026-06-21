/* Minimal analytics tracking for secondary pages */
const TRACK_URL = '/api/track.php';

function _qdVid() {
  let id = localStorage.getItem('qd_vid');
  if (!id) { id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); localStorage.setItem('qd_vid', id); }
  return id;
}
function _qdSid() {
  let id = sessionStorage.getItem('qd_sid');
  if (!id) { id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); sessionStorage.setItem('qd_sid', id); }
  return id;
}
function trackEvent(type, label='', extra={}) {
  try {
    const sp = new URLSearchParams(location.search);
    const p = JSON.stringify({ visitor_id:_qdVid(), session_id:_qdSid(), event_type:type, event_label:String(label).substring(0,200), page_url:location.pathname+location.search, page_title:document.title, referrer:document.referrer, utm_source:sp.get('utm_source')||'', utm_medium:sp.get('utm_medium')||'', utm_campaign:sp.get('utm_campaign')||'', extra });
    navigator.sendBeacon ? navigator.sendBeacon(TRACK_URL, new Blob([p],{type:'application/json'})) : fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:p,keepalive:true}).catch(()=>{});
  } catch(_) {}
}
document.addEventListener('click', e => {
  try {
    const a = e.target.closest('a[href]');
    if (a) {
      const h = a.getAttribute('href')||'', t = a.textContent.trim().substring(0,100);
      if (h.includes('wa.me'))          { trackEvent('whatsapp_click', t); }
      else if (h.includes('t.me'))      { trackEvent('telegram_click', t); }
      else if (h.startsWith('tel:'))    { trackEvent('phone_click', t); }
      else if (h.startsWith('mailto:')) { trackEvent('email_click', t); }
    }
  } catch(_) {}
}, true);
trackEvent('page_view');
