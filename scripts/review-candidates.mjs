import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const input = path.resolve(root, String(args.input || 'data/github-crawl.drafts.json'));
const jsonOutput = path.resolve(root, String(args.output || 'data/review-queue.json'));
const csvOutput = path.resolve(root, String(args.csv || 'data/review-queue.csv'));
const threshold = Number.parseInt(args.threshold, 10) || 65;
const limit = Number.parseInt(args.limit, 10) || 1000;

const candidates = JSON.parse(await readFile(input, 'utf8'));
const queue = candidates
  .filter(candidate => candidate.score >= threshold && candidate.license && candidate.assets?.length)
  .sort((a, b) => b.score - a.score || b.releaseDownloads - a.releaseDownloads)
  .slice(0, limit)
  .map(candidate => ({
    ...candidate,
    moderation: {
      repositoryVerified: false,
      licenseVerified: false,
      assetPatternsVerified: false,
      descriptionWritten: false,
      approved: false,
      notes: ''
    }
  }));

function csv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = [
  ['score', 'name', 'repository', 'category', 'stars', 'license', 'platforms', 'release', 'downloads', 'asset_names', 'repository_url', 'approved', 'notes'],
  ...queue.map(candidate => [
    candidate.score,
    candidate.name,
    candidate.github,
    candidate.categoryLabel,
    candidate.stars,
    candidate.license,
    [...new Set(candidate.assets.map(asset => asset.platform))].join('|'),
    candidate.release.tag,
    candidate.releaseDownloads,
    candidate.assets.map(asset => asset.name).join('|'),
    candidate.repositoryUrl,
    '',
    ''
  ])
];

await mkdir(path.dirname(jsonOutput), {recursive: true});
await Promise.all([
  writeFile(jsonOutput, `${JSON.stringify(queue, null, 2)}\n`),
  writeFile(csvOutput, `${rows.map(row => row.map(csv).join(',')).join('\n')}\n`)
]);

console.log(`Prepared ${queue.length} candidates with score >= ${threshold}. Nothing was published automatically.`);
