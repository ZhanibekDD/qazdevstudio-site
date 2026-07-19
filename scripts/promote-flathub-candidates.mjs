import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const input = path.resolve(root, String(args.input || 'data/flathub-crawl.drafts.json'));
const selectionFile = path.resolve(root, String(args.selection || 'data/flathub-publication-selection.json'));
const batchFile = path.resolve(root, String(args.output || 'data/software-flathub.batch.json'));
const apply = args.apply === true || args.apply === 'true';

const [candidates, selection, published] = await Promise.all([
  readFile(input, 'utf8').then(JSON.parse),
  readFile(selectionFile, 'utf8').then(JSON.parse),
  readFile(path.join(root, 'data', 'software.json'), 'utf8').then(JSON.parse)
]);
const byAppId = new Map(candidates.map(candidate => [candidate.appId.toLowerCase(), candidate]));
const publishedBySlug = new Map(published.map(item => [item.slug, item]));
const publishedByAppId = new Map(published.filter(item => item.appId).map(item => [item.appId.toLowerCase(), item]));
const selectedAppIds = new Set();
const selectedSlugs = new Set();
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

const batch = selection.map(metadata => {
  const appId = metadata.appId.toLowerCase();
  if (selectedAppIds.has(appId)) throw new Error(`${metadata.appId}: duplicate selection`);
  const publishedWithSlug = publishedBySlug.get(metadata.slug);
  if (selectedSlugs.has(metadata.slug) || (publishedWithSlug && publishedWithSlug.appId?.toLowerCase() !== appId)) {
    throw new Error(`${metadata.slug}: duplicate published slug`);
  }
  selectedAppIds.add(appId);
  selectedSlugs.add(metadata.slug);
  const candidate = byAppId.get(appId);
  if (!candidate) throw new Error(`${metadata.appId}: candidate not found in Flathub artifact`);
  if (!candidate.openSource || !candidate.verified || candidate.score < 80 || candidate.reviewStatus !== 'ready-for-review') {
    throw new Error(`${metadata.appId}: candidate is below publication policy`);
  }
  if (!candidate.icon?.startsWith('https://dl.flathub.org/')) throw new Error(`${metadata.appId}: official icon is missing`);
  const previous = publishedByAppId.get(appId);
  const unchanged = previous && previous.downloads?.[0]?.url === candidate.download.url && previous.downloads?.[0]?.version === candidate.version && previous.icon === candidate.icon;
  return {
    slug: metadata.slug,
    name: metadata.name || candidate.name,
    category: metadata.category,
    categoryLabel: metadata.categoryLabel,
    shortDescription: metadata.shortDescription,
    fullDescription: metadata.fullDescription,
    website: metadata.website || candidate.website,
    platforms: ['linux'],
    features: metadata.features,
    downloads: [{os: 'linux', label: 'Linux · Flatpak', type: 'flatpakref', url: candidate.download.url, version: candidate.version}],
    source: 'flathub',
    appId: candidate.appId,
    developer: candidate.developer,
    license: candidate.license,
    icon: candidate.icon,
    verifiedAt: unchanged ? previous.verifiedAt : today
  };
});

await writeFile(batchFile, `${JSON.stringify(batch, null, 2)}\n`);
if (apply) {
  const replacements = new Map(batch.map(item => [item.appId.toLowerCase(), item]));
  const merged = published.map(item => replacements.get(item.appId?.toLowerCase()) || item);
  const existingAppIds = new Set(published.map(item => item.appId?.toLowerCase()).filter(Boolean));
  merged.push(...batch.filter(item => !existingAppIds.has(item.appId.toLowerCase())));
  await writeFile(path.join(root, 'data', 'software.json'), `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`Prepared ${batch.length} reviewed Flathub programs${apply ? ' and applied them to software.json' : ''}.`);
