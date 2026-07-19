import {createWriteStream} from 'node:fs';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {buildWingetCandidate, parseMergedManifest, sha256} from './lib/winget-parser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value.join('=') || true];
}));
const sourceBase = String(args.source || 'https://cdn.winget.microsoft.com/cache');
const outputFile = path.resolve(root, String(args.output || 'data/winget-crawl.drafts.json'));
const stateFile = path.resolve(root, String(args.state || 'data/winget-crawl.state.json'));
const summaryFile = path.resolve(root, String(args.summary || 'data/winget-summary.json'));
const maxPackages = Math.max(1, Math.min(15000, Number.parseInt(args.maxPackages || '3000', 10)));
const concurrency = Math.max(1, Math.min(32, Number.parseInt(args.concurrency || '16', 10)));
const resume = args.resume !== 'false';
const workDir = path.join(tmpdir(), 'qazdev-winget-crawler');
const msixFile = path.join(workDir, 'source.msix');
const databaseFile = path.join(workDir, 'index.db');
let stopRequested = false;
process.once('SIGINT', () => { stopRequested = true; });
process.once('SIGTERM', () => { stopRequested = true; });

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchBuffer(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {headers: {'User-Agent': 'QazDevWingetCrawler/1.0'}});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function downloadSource() {
  await mkdir(workDir, {recursive: true});
  const response = await fetch(`${sourceBase}/source.msix`, {headers: {'User-Agent': 'QazDevWingetCrawler/1.0'}});
  if (!response.ok || !response.body) throw new Error(`WinGet source: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(msixFile));
  await new Promise((resolve, reject) => {
    const output = createWriteStream(databaseFile);
    const child = spawn('unzip', ['-p', msixFile, 'Public/index.db'], {stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stdout.pipe(output);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`unzip exited ${code}: ${stderr.slice(0, 300)}`)));
  });
}

function loadIndex() {
  const database = new DatabaseSync(databaseFile, {readOnly: true});
  const metadata = Object.fromEntries(database.prepare('SELECT name, value FROM metadata').all().map(row => [row.name, row.value]));
  const rows = database.prepare(`
    SELECT m.rowid, i.id, n.name, v.version, m.pathpart, lower(hex(m.hash)) AS hash
    FROM manifest m
    JOIN (SELECT id, max(rowid) AS latest_rowid FROM manifest GROUP BY id) latest ON latest.latest_rowid = m.rowid
    JOIN ids i ON i.rowid = m.id
    JOIN names n ON n.rowid = m.name
    JOIN versions v ON v.rowid = m.version
    ORDER BY lower(i.id)
  `).all();
  const pathRows = database.prepare('SELECT rowid, parent, pathpart FROM pathparts').all();
  database.close();
  const pathParts = new Map(pathRows.map(row => [row.rowid, row]));
  function resolvePath(pathpart) {
    const parts = [];
    let cursor = pathpart;
    while (cursor) {
      const part = pathParts.get(cursor);
      if (!part) throw new Error(`Missing WinGet pathpart ${cursor}`);
      parts.unshift(part.pathpart);
      cursor = part.parent;
    }
    return parts.join('/');
  }
  return {
    metadata,
    manifests: rows.map(row => ({
      packageIdentifier: row.id,
      packageName: row.name,
      version: row.version,
      path: resolvePath(row.pathpart),
      hash: row.hash
    }))
  };
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length && !stopRequested) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, run));
}

console.log('Downloading the official Microsoft WinGet source index…');
await downloadSource();
const index = loadIndex();
let state = resume ? await readJson(stateFile, null) : null;
if (!state || state.version !== 2) {
  state = {version: 2, processedManifests: {}, errors: [], startedAt: new Date().toISOString(), updatedAt: null};
}
const existing = resume ? await readJson(outputFile, []) : [];
const candidates = new Map(existing.map(candidate => [candidate.packageIdentifier.toLowerCase(), candidate]));
const pending = index.manifests.filter(manifest => state.processedManifests[manifest.packageIdentifier] !== manifest.hash);
const queue = pending.slice(0, maxPackages);
let processedThisRun = 0;
let failuresThisRun = 0;

async function checkpoint(status) {
  const values = [...candidates.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const ready = values.filter(candidate => candidate.reviewStatus === 'ready-for-review').length;
  state.updatedAt = new Date().toISOString();
  await Promise.all([
    writeJsonAtomic(outputFile, values),
    writeJsonAtomic(stateFile, state),
    writeJsonAtomic(summaryFile, {
      source: 'Microsoft WinGet Community',
      databaseIdentifier: index.metadata.databaseIdentifier,
      sourceLastWriteTime: index.metadata.lastwritetime,
      packagesInSource: index.manifests.length,
      processedVersions: Object.keys(state.processedManifests).length,
      processedThisRun,
      pendingAfterRun: Math.max(0, pending.length - processedThisRun),
      candidates: values.length,
      readyForReview: ready,
      needsReview: values.length - ready,
      failuresThisRun,
      status,
      updatedAt: state.updatedAt
    })
  ]);
}

console.log(`WinGet source contains ${index.manifests.length} packages; processing ${queue.length} changed manifests with concurrency ${concurrency}.`);
for (let start = 0; start < queue.length && !stopRequested; start += 50) {
  const batch = queue.slice(start, start + 50);
  await mapLimit(batch, concurrency, async item => {
    const encodedPath = item.path.split('/').map(encodeURIComponent).join('/');
    try {
      const content = await fetchBuffer(`${sourceBase}/${encodedPath}`);
      const digest = sha256(content);
      if (digest !== item.hash) throw new Error(`manifest SHA-256 mismatch (${digest})`);
      const parsed = parseMergedManifest(content.toString('utf8'));
      if (parsed.packageIdentifier !== item.packageIdentifier || parsed.packageVersion !== item.version) {
        throw new Error('manifest identity does not match the signed index');
      }
      const candidate = buildWingetCandidate(parsed, {path: item.path, sha256: digest});
      if (candidate) candidates.set(item.packageIdentifier.toLowerCase(), candidate);
      else candidates.delete(item.packageIdentifier.toLowerCase());
      state.processedManifests[item.packageIdentifier] = item.hash;
      processedThisRun += 1;
    } catch (error) {
      failuresThisRun += 1;
      state.errors.push({packageIdentifier: item.packageIdentifier, version: item.version, message: error.message, at: new Date().toISOString()});
      state.errors = state.errors.slice(-300);
    }
  });
  await checkpoint(stopRequested ? 'stopped' : 'running');
  console.log(`${Math.min(start + batch.length, queue.length)}/${queue.length}: ${candidates.size} downloadable candidates, ${failuresThisRun} failures.`);
}

const status = stopRequested ? 'stopped' : queue.length < pending.length ? 'batch-completed' : 'completed';
await checkpoint(status);
console.log(`Saved ${candidates.size} unpublished WinGet candidates. Status: ${status}.`);
