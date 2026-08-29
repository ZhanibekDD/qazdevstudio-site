'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname);
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

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
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
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
