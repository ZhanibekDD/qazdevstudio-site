import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCandidate, summarizeCandidates} from './lib/catalog-crawler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const result = {queries: []};
  for (const part of argv) {
    const [rawKey, ...rawValue] = part.replace(/^--/, '').split('=');
    const value = rawValue.length ? rawValue.join('=') : true;
    if (rawKey === 'query') result.queries.push(String(value));
    else result[rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return result;
}

function int(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const args = parseArgs(process.argv.slice(2));
const configFile = path.resolve(root, String(args.config || 'scripts/crawl-config.json'));
const config = await readJson(configFile);
const pages = int(args.pages, config.defaults.pages, 1, 10);
const perPage = int(args.perPage, config.defaults.perPage, 1, 100);
const minStars = int(args.minStars, config.defaults.minStars, 0);
const maxRepositories = int(args.maxRepos, config.defaults.maxRepositories, 1, 100000);
const concurrency = int(args.concurrency, config.defaults.concurrency, 1, 16);
const maxRateWaitMs = int(args.maxRateWait, 120, 0, 900) * 1000;
const outputFile = path.resolve(root, String(args.output || 'data/github-crawl.drafts.json'));
const stateFile = path.resolve(root, String(args.state || 'data/github-crawl.state.json'));
const summaryFile = path.resolve(root, String(args.summary || 'data/crawl-summary.json'));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const resume = args.resume !== 'false';
const stopOnRateLimit = args.strict === true || args.strict === 'true';
const userAgent = 'QazDevCatalogCrawler/1.0';

let stopRequested = false;
process.once('SIGINT', () => { stopRequested = true; });
process.once('SIGTERM', () => { stopRequested = true; });

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': userAgent,
  ...(token ? {Authorization: `Bearer ${token}`} : {})
};

class RateLimitError extends Error {
  constructor(message, resetAt) {
    super(message);
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}

async function github(pathname, attempts = 4) {
  let lastError;
  let rateWaits = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`https://api.github.com${pathname}`, {headers});
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * 2 ** attempt);
      continue;
    }

    if (response.ok) return response.json();
    if (response.status === 404) return null;

    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
    if (response.status === 429 || (response.status === 403 && remaining === 0)) {
      const waitMs = Number.isFinite(reset) ? Math.max(0, reset - Date.now() + 1500) : Infinity;
      if (waitMs <= maxRateWaitMs && rateWaits < 8) {
        rateWaits += 1;
        attempt -= 1;
        console.log(`GitHub rate limit: waiting ${Math.ceil(waitMs / 1000)}s, then continuing.`);
        await sleep(waitMs);
        continue;
      }
      throw new RateLimitError('GitHub API rate limit reached; checkpoint was saved.', Number.isFinite(reset) ? new Date(reset).toISOString() : null);
    }

    const message = await response.text();
    lastError = new Error(`GitHub API ${response.status}: ${message.slice(0, 240)}`);
    if (response.status < 500 || attempt === attempts) break;
    await sleep(500 * 2 ** attempt);
  }
  throw lastError;
}

function buildJobs() {
  const qualifier = `stars:>=${minStars} archived:false fork:false`;
  const selected = [];
  if (args.queries.length) {
    selected.push({id: 'other', label: 'Другие программы', queries: args.queries});
  } else {
    const categories = args.all ? config.categories : config.categories.slice(0, 1);
    selected.push(...categories);
  }

  return selected.flatMap(category => category.queries.flatMap(query =>
    Array.from({length: pages}, (_, index) => ({
      category: {id: category.id, label: category.label},
      query: `${query} ${qualifier}`.trim(),
      page: index + 1,
      key: `${category.id}|${query}|${minStars}|${index + 1}`
    }))
  ));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length && !stopRequested) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, run));
  return results;
}

let state = resume ? await readJson(stateFile, null) : null;
if (!state || state.version !== config.version || state.minStars !== minStars) {
  state = {
    version: config.version,
    minStars,
    completedJobs: [],
    processedRepositories: [],
    searchedRepositories: 0,
    startedAt: new Date().toISOString(),
    updatedAt: null,
    stoppedReason: null
  };
}

const existing = resume ? await readJson(outputFile, []) : [];
const candidateMap = new Map(existing.map(candidate => [candidate.id, candidate]));
const completedJobs = new Set(state.completedJobs);
const processedRepositories = new Set(state.processedRepositories);
const jobs = buildJobs();

async function checkpoint(stoppedReason = null) {
  const candidates = [...candidateMap.values()].sort((a, b) => b.score - a.score || b.stars - a.stars);
  state = {
    ...state,
    completedJobs: [...completedJobs],
    processedRepositories: [...processedRepositories],
    updatedAt: new Date().toISOString(),
    stoppedReason
  };
  await Promise.all([
    writeJsonAtomic(outputFile, candidates),
    writeJsonAtomic(stateFile, state),
    writeJsonAtomic(summaryFile, {
      ...summarizeCandidates(candidates),
      searchedRepositories: state.searchedRepositories,
      processedRepositories: processedRepositories.size,
      completedJobs: completedJobs.size,
      totalJobs: jobs.length,
      stoppedReason,
      updatedAt: state.updatedAt
    })
  ]);
}

console.log(`QazDev crawler: ${jobs.length} search pages, up to ${maxRepositories} repositories, ${token ? 'authenticated' : 'anonymous'} GitHub API.`);

let stoppedReason = null;
try {
  for (const job of jobs) {
    if (stopRequested || processedRepositories.size >= maxRepositories) break;
    if (completedJobs.has(job.key)) continue;

    const params = new URLSearchParams({
      q: job.query,
      sort: 'stars',
      order: 'desc',
      per_page: String(perPage),
      page: String(job.page)
    });
    const result = await github(`/search/repositories?${params}`);
    const unprocessed = (result?.items || [])
      .filter(repo => !processedRepositories.has(repo.full_name.toLowerCase()));
    const repositories = unprocessed
      .slice(0, Math.max(0, maxRepositories - processedRepositories.size));
    const pageWasTruncated = repositories.length < unprocessed.length;
    state.searchedRepositories += repositories.length;

    await mapLimit(repositories, concurrency, async repo => {
      const id = repo.full_name.toLowerCase();
      try {
        const release = await github(`/repos/${repo.full_name}/releases/latest`);
        const candidate = buildCandidate(repo, release, job.category);
        if (candidate) candidateMap.set(candidate.id, candidate);
      } finally {
        processedRepositories.add(id);
      }
    });

    if (!pageWasTruncated && !stopRequested) completedJobs.add(job.key);
    await checkpoint();
    console.log(`[${completedJobs.size}/${jobs.length}] ${job.category.label}, page ${job.page}: ${candidateMap.size} candidates from ${processedRepositories.size} repositories.`);
  }

  if (stopRequested) stoppedReason = 'signal';
  else if (processedRepositories.size >= maxRepositories) stoppedReason = 'max-repositories';
  else stoppedReason = 'completed';
} catch (error) {
  stoppedReason = error instanceof RateLimitError ? `rate-limit${error.resetAt ? ` until ${error.resetAt}` : ''}` : `error: ${error.message}`;
  console.error(error.message);
  if (!(error instanceof RateLimitError) || stopOnRateLimit) process.exitCode = 1;
} finally {
  await checkpoint(stoppedReason);
}

console.log(`Saved ${candidateMap.size} unpublished candidates to ${path.relative(root, outputFile)}. Status: ${stoppedReason}.`);
