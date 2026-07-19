import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {buildFlathubCandidate, parseFlathubComponent, sha256, splitDesktopComponents} from './lib/flathub-parser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value.join('=') || true];
}));
const sourceUrl = String(args.source || 'https://dl.flathub.org/repo/appstream/x86_64/appstream.xml.gz');
const sourceFile = args.sourceFile ? path.resolve(String(args.sourceFile)) : null;
const outputFile = path.resolve(root, String(args.output || 'data/flathub-crawl.drafts.json'));
const summaryFile = path.resolve(root, String(args.summary || 'data/flathub-summary.json'));

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

async function download(attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, {headers: {'User-Agent': 'QazDevFlathubCrawler/1.0'}});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

console.log(sourceFile ? `Reading Flathub AppStream snapshot ${sourceFile}…` : 'Downloading the official Flathub AppStream snapshot…');
const compressed = sourceFile ? await readFile(sourceFile) : await download();
const collectedAt = new Date().toISOString();
const sourceHash = sha256(compressed);
const xml = gunzipSync(compressed).toString('utf8');
const components = splitDesktopComponents(xml);
const candidates = components
  .map(component => buildFlathubCandidate(parseFlathubComponent(component), {sha256: sourceHash, collectedAt}))
  .filter(Boolean)
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
const ready = candidates.filter(candidate => candidate.reviewStatus === 'ready-for-review').length;
const summary = {
  source: 'Flathub AppStream',
  sourceUrl,
  architecture: 'x86_64',
  sourceSha256: sourceHash,
  sourceBytes: compressed.length,
  desktopComponents: components.length,
  candidates: candidates.length,
  verified: candidates.filter(candidate => candidate.verified).length,
  openSource: candidates.filter(candidate => candidate.openSource).length,
  withOfficialIcon: candidates.filter(candidate => candidate.icon).length,
  readyForReview: ready,
  needsReview: candidates.length - ready,
  status: 'completed',
  updatedAt: collectedAt
};

await Promise.all([
  writeJsonAtomic(outputFile, candidates),
  writeJsonAtomic(summaryFile, summary)
]);
console.log(`Saved ${candidates.length} unpublished Flathub candidates; ${ready} verified open-source apps are ready for human review.`);
