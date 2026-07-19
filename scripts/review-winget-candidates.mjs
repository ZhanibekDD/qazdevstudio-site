import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const input = path.resolve(root, String(args.input || 'data/winget-crawl.drafts.json'));
const jsonOutput = path.resolve(root, String(args.output || 'data/winget-review-queue.json'));
const csvOutput = path.resolve(root, String(args.csv || 'data/winget-review-queue.csv'));
const threshold = Number.parseInt(args.threshold || '80', 10);
const limit = Number.parseInt(args.limit || '2000', 10);

const candidates = JSON.parse(await readFile(input, 'utf8'));
const queue = candidates
  .filter(candidate => candidate.openSource && candidate.desktopLikely && candidate.score >= threshold && candidate.installers?.length)
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  .slice(0, limit)
  .map(candidate => ({
    ...candidate,
    moderation: {
      publisherVerified: false,
      licenceVerified: false,
      installerDomainVerified: false,
      sha256VerifiedByDownload: false,
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
  ['score', 'name', 'identifier', 'publisher', 'version', 'category', 'license', 'installer_count', 'installer_domains', 'website', 'approved', 'notes'],
  ...queue.map(candidate => [
    candidate.score,
    candidate.name,
    candidate.packageIdentifier,
    candidate.publisher,
    candidate.version,
    candidate.categoryLabel,
    candidate.license,
    candidate.installers.length,
    [...new Set(candidate.installers.map(installer => new URL(installer.url).hostname))].join('|'),
    candidate.website,
    '',
    ''
  ])
];

await Promise.all([
  writeFile(jsonOutput, `${JSON.stringify(queue, null, 2)}\n`),
  writeFile(csvOutput, `${rows.map(row => row.map(csv).join(',')).join('\n')}\n`)
]);
console.log(`Prepared ${queue.length} WinGet candidates for human review. Nothing was published.`);
