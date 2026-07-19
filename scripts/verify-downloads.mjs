import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(path.join(root, 'data', 'software.json'), 'utf8'));
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'QazDevCatalogVerifier/1.0',
  ...(process.env.GITHUB_TOKEN ? {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`} : {})
};
const concurrency = Math.max(1, Math.min(12, Number.parseInt(process.env.VERIFY_CONCURRENCY || '6', 10)));
let cursor = 0;
const errors = [];
let checked = 0;

async function worker() {
  while (cursor < data.length) {
    const software = data[cursor++];
    const response = await fetch(`https://api.github.com/repos/${software.github}/releases/latest`, {headers});
    if (!response.ok) {
      errors.push(`${software.name}: GitHub API ${response.status}`);
      continue;
    }
    const release = await response.json();
    const names = (release.assets || []).map(asset => asset.name);
    for (const download of software.downloads) {
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
  console.log(`Verified ${checked} direct-download patterns for ${data.length} programs.`);
}
