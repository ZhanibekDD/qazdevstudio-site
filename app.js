'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname);
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DATA_DIR = path.resolve(process.env.QAZDEV_DATA_DIR || path.join(ROOT, '.data'));
const MAX_TRACK_BODY = 16 * 1024;
const TRACK_EVENTS = new Set([
  'page_view',
  'whatsapp_click',
  'telegram_click',
  'phone_click',
  'email_click',
  'form_submit',
  'generate_lead',
  'download_click',
]);
const rateLimits = new Map();

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const REDIRECTS = new Map([
  ['/razrabotka-saitov-taldykorgan.html', '/razrabotka-saitov-kazakhstan.html'],
  ['/telegram-bot-dlya-biznesa.html', '/telegram-bot-kazakhstan.html'],
  ['/crm-dlya-malogo-biznesa.html', '/crm-dlya-biznesa-kazakhstan.html'],
  ['/avtomatizaciya-biznesa.html', '/avtomatizaciya-biznesa-kazakhstan.html'],
]);

function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function limitedString(value, maximum = 240) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
}

function safePageUrl(value) {
  try {
    const url = new URL(String(value || '/'), 'https://qazdevstudio.kz');
    return limitedString(url.pathname, 500);
  } catch {
    return '/';
  }
}

function safeIdentifier(value) {
  const identifier = limitedString(value, 100);
  return /^[a-z0-9-]{1,100}$/i.test(identifier) ? identifier : '';
}

function safeReferrer(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    return limitedString(`${url.hostname}${url.pathname}`, 300);
  } catch {
    return '';
  }
}

function trackingAllowed(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  if (rateLimits.size > 10_000) {
    for (const [address, value] of rateLimits) {
      if (now - value.startedAt >= 60_000) rateLimits.delete(address);
    }
  }
  const entry = rateLimits.get(key);
  if (!entry || now - entry.startedAt >= 60_000) {
    rateLimits.set(key, { startedAt: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 120;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_TRACK_BODY) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        const error = new Error('payload too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        const error = new Error('invalid json');
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

async function storeTrackingEvent(payload) {
  if (!payload || typeof payload !== 'object' || !TRACK_EVENTS.has(payload.event_type)) {
    const error = new Error('invalid event');
    error.statusCode = 400;
    throw error;
  }

  const timestamp = new Date().toISOString();
  const extra = payload.extra && typeof payload.extra === 'object' ? payload.extra : {};
  const record = {
    timestamp,
    event_type: payload.event_type,
    event_label: limitedString(payload.event_label, 200),
    visitor_id: safeIdentifier(payload.visitor_id),
    session_id: safeIdentifier(payload.session_id),
    page_url: safePageUrl(payload.page_url),
    page_title: limitedString(payload.page_title, 240),
    referrer: safeReferrer(payload.referrer),
    utm_source: limitedString(payload.utm_source, 100),
    utm_medium: limitedString(payload.utm_medium, 100),
    utm_campaign: limitedString(payload.utm_campaign, 140),
    channel: limitedString(extra.channel, 40),
    service: limitedString(extra.service, 120),
  };
  const month = timestamp.slice(0, 7);
  await fs.promises.mkdir(DATA_DIR, { recursive: true, mode: 0o750 });
  await fs.promises.appendFile(
    path.join(DATA_DIR, `analytics-${month}.ndjson`),
    `${JSON.stringify(record)}\n`,
    { encoding: 'utf8', mode: 0o640 },
  );
}

async function handleTracking(request, response) {
  if (!trackingAllowed(request)) {
    response.writeHead(429, { 'Cache-Control': 'no-store', 'Retry-After': '60' });
    response.end();
    return;
  }
  try {
    const payload = await readJsonBody(request);
    await storeTrackingEvent(payload);
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    if (status === 500) console.error('Tracking write failed:', error.message);
    response.writeHead(status, { 'Cache-Control': 'no-store' });
    response.end();
  }
}

function safeFilePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const relative = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(ROOT, relative || 'index.html');
  if (candidate !== ROOT && !candidate.startsWith(`${ROOT}${path.sep}`)) return null;
  return candidate;
}

async function resolvePublicFile(urlPath) {
  let filePath = safeFilePath(urlPath);
  if (!filePath) return null;

  try {
    const info = await fs.promises.stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    return null;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!MIME_TYPES.has(extension)) return null;
  try {
    const info = await fs.promises.stat(filePath);
    return info.isFile() ? { filePath, info, extension } : null;
  } catch {
    return null;
  }
}

function streamFile(request, response, file) {
  const isDocument = ['.html', '.json', '.xml', '.txt'].includes(file.extension);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES.get(file.extension),
    'Content-Length': file.info.size,
    'Last-Modified': file.info.mtime.toUTCString(),
    'Cache-Control': isDocument ? 'no-cache, must-revalidate' : 'public, max-age=604800',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = fs.createReadStream(file.filePath);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

async function sendNotFound(request, response) {
  const filePath = path.join(ROOT, '404.html');
  try {
    const body = await fs.promises.readFile(filePath);
    response.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : '404 Not Found');
  }
}

const server = http.createServer(async (request, response) => {
  applySecurityHeaders(response);

  let url;
  try {
    url = new URL(request.url || '/', 'http://localhost');
  } catch {
    response.writeHead(400);
    response.end('Bad Request');
    return;
  }

  const host = String(request.headers.host || '').toLowerCase();
  if (host.startsWith('www.')) {
    response.writeHead(301, { Location: `https://qazdevstudio.kz${url.pathname}${url.search}` });
    response.end();
    return;
  }

  if (url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', runtime: 'node-static', renderer: 'rust', programs: 1000 });
    return;
  }

  const redirect = REDIRECTS.get(url.pathname);
  if (redirect) {
    response.writeHead(301, { Location: redirect });
    response.end();
    return;
  }

  if (request.method === 'POST' && ['/api/track', '/api/track.php'].includes(url.pathname)) {
    await handleTracking(request, response);
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const requestedPath = url.pathname === '/api/programs' ? '/api/programs.json' : url.pathname;
  const file = await resolvePublicFile(requestedPath);
  if (file) {
    streamFile(request, response, file);
    return;
  }
  await sendNotFound(request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`QazDev Rust static bridge listening on Passenger port ${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
