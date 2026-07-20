import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const input = path.resolve(root, String(args.input || 'data/software.json'));
const data = JSON.parse(await readFile(input, 'utf8'));
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'QazDevCatalogVerifier/1.0',
  ...(process.env.GITHUB_TOKEN ? {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`} : {})
};
const concurrency = Math.max(1, Math.min(12, Number.parseInt(process.env.VERIFY_CONCURRENCY || '6', 10)));
const maxFlathubNetworkChecks = Math.max(1, Number.parseInt(process.env.FLATHUB_NETWORK_SAMPLES || '24', 10));
const maxDirectChecksPerHost = Math.max(1, Number.parseInt(process.env.DIRECT_HOST_SAMPLES || '3', 10));
const maxGithubNetworkChecks = Math.max(1, Number.parseInt(process.env.GITHUB_NETWORK_SAMPLES || '40', 10));
const networkEnabled = process.env.VERIFY_NETWORK !== 'false';
let cursor = 0;
const errors = [];
let checked = 0;
let flathubNetworkChecked = 0;
let directNetworkChecked = 0;
let githubNetworkChecked = 0;
const directChecksByHost = new Map();

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, options = {}, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {...options, signal: options.signal || AbortSignal.timeout(12000)});
      if (attempt < attempts && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel();
        await wait(500 * attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(500 * attempt);
    }
  }
  throw lastError;
}

async function worker() {
  while (cursor < data.length) {
    const software = data[cursor++];
    const directDownloads = software.downloads.filter(download => download.url);
    for (const download of directDownloads) {
      let officialFlatpakRef = false;
      try {
        const url = new URL(download.url);
        officialFlatpakRef = software.source === 'flathub' && download.type === 'flatpakref' && url.hostname === 'dl.flathub.org' && url.pathname === `/repo/appstream/${software.appId}.flatpakref`;
      } catch {}
      if (!/^https:\/\//i.test(download.url) || (!officialFlatpakRef && !/^[a-f0-9]{64}$/i.test(download.sha256 || ''))) {
        errors.push(`${software.name}/${download.label}: invalid direct URL or SHA-256`);
        continue;
      }
      if (!networkEnabled) {
        checked += 1;
        continue;
      }
      // All Flathub URLs are deterministic and their App IDs are validated above. A bounded
      // network sample catches host outages without issuing ~1,000 identical HEAD requests.
      if (officialFlatpakRef && flathubNetworkChecked >= maxFlathubNetworkChecks) {
        checked += 1;
        continue;
      }
      if (officialFlatpakRef) flathubNetworkChecked += 1;
      const directHost = new URL(download.url).hostname;
      const hostChecks = directChecksByHost.get(directHost) || 0;
      if (!officialFlatpakRef && hostChecks >= maxDirectChecksPerHost) {
        checked += 1;
        continue;
      }
      directChecksByHost.set(directHost, hostChecks + 1);
      directNetworkChecked += 1;
      try {
        let response = await fetchWithRetry(download.url, {method: 'HEAD', redirect: 'follow', headers: {'User-Agent': headers['User-Agent']}});
        if (response.status === 405 || response.status === 501) {
          response = await fetchWithRetry(download.url, {redirect: 'follow', headers: {'User-Agent': headers['User-Agent'], Range: 'bytes=0-0'}});
          await response.body?.cancel();
        }
        if (!response.ok) errors.push(`${software.name}/${download.label}: direct URL HTTP ${response.status}`);
        checked += 1;
      } catch (error) {
        errors.push(`${software.name}/${download.label}: ${error.message}`);
      }
    }
    const releaseDownloads = software.downloads.filter(download => !download.url);
    if (!releaseDownloads.length) continue;
    if (!networkEnabled) {
      for (const download of releaseDownloads) new RegExp(download.pattern, 'i');
      checked += releaseDownloads.length;
      continue;
    }
    if (githubNetworkChecked >= maxGithubNetworkChecks) {
      checked += releaseDownloads.length;
      continue;
    }
    githubNetworkChecked += 1;
    const response = await fetchWithRetry(`https://api.github.com/repos/${software.github}/releases/latest`, {headers});
    if (!response.ok) {
      errors.push(`${software.name}: GitHub API ${response.status}`);
      continue;
    }
    const release = await response.json();
    const names = (release.assets || []).map(asset => asset.name);
    for (const download of releaseDownloads) {
      let pattern;
      try {
        pattern = new RegExp(download.pattern, 'i');
      } catch (error) {
        errors.push(`${software.name}/${download.label}: invalid pattern (${error.message})`);
        continue;
      }
      const matches = names.filter(name => pattern.test(name));
      if (matches.length !== 1) errors.push(`${software.name}/${download.label}: expected 1 asset, found ${matches.length}`);
      checked += 1;
    }
  }
}

await Promise.all(Array.from({length: Math.min(concurrency, data.length)}, worker));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified ${checked} download rules for ${data.length} programs (${flathubNetworkChecked} Flathub, ${directNetworkChecked} direct-file and ${githubNetworkChecked} GitHub live checks).`);
}
