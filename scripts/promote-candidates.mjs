import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {detectArchitecture, detectPlatform} from './lib/catalog-crawler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const input = path.resolve(root, String(args.input || 'data/github-crawl.drafts.json'));
const selectionFile = path.resolve(root, String(args.selection || 'data/publication-selection.json'));
const batchFile = path.resolve(root, String(args.output || 'data/software.batch.json'));
const apply = args.apply === true || args.apply === 'true';

const [candidates, selection, published] = await Promise.all([
  readFile(input, 'utf8').then(JSON.parse),
  readFile(selectionFile, 'utf8').then(JSON.parse),
  readFile(path.join(root, 'data', 'software.json'), 'utf8').then(JSON.parse)
]);
const byRepository = new Map(candidates.map(candidate => [candidate.github.toLowerCase(), candidate]));
const publishedRepositories = new Set(published.map(item => item.github.toLowerCase()));
const verifiedAt = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

function assetScore(asset, os) {
  const name = asset.name.toLowerCase();
  const architecture = detectArchitecture(asset.name);
  let score = Math.min(8, Math.log10(Math.max(1, asset.downloads || 0)) * 2);
  score += architecture === 'x64' ? 25 : architecture === 'universal' ? 22 : architecture === 'unknown' ? 8 : -30;
  if (/(?:dont[-_. ]?use|unsigned|symbols?|debug|source)/i.test(name)) score -= 100;
  if (/(?:portable|legacy|webview2-offline|\bcli\b)/i.test(name)) score -= 12;
  if (/(?:setup|installer|nsis)/i.test(name)) score += 10;

  if (os === 'windows') {
    if (/\.exe$/i.test(name)) score += 30;
    else if (/\.msi$/i.test(name)) score += 27;
    else if (/\.msix$/i.test(name)) score += 22;
    else if (/\.(?:zip|7z)$/i.test(name)) score += 8;
  } else if (os === 'macos') {
    if (/\.dmg$/i.test(name)) score += 32;
    else if (/\.pkg$/i.test(name)) score += 24;
    else if (/\.(?:zip|tar\.gz)$/i.test(name)) score += 8;
  } else if (os === 'linux') {
    if (/\.appimage$/i.test(name)) score += 32;
    else if (/\.appimage\.zip$/i.test(name)) score += 28;
    else if (/\.deb$/i.test(name)) score += 26;
    else if (/\.flatpak$/i.test(name)) score += 23;
    else if (/\.rpm$/i.test(name)) score += 20;
    else if (/\.(?:zip|tar\.gz)$/i.test(name)) score += 8;
  }
  return score;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stablePattern(asset, release, allAssets) {
  let pattern = escapeRegex(asset.name);
  const versions = String(release.tag || '').match(/\d+(?:\.\d+){1,4}/g) || [];
  for (const version of versions.sort((a, b) => b.length - a.length)) {
    if (asset.name.includes(version)) pattern = pattern.replaceAll(escapeRegex(version), '[0-9][0-9A-Za-z.]*');
  }
  pattern = `^${pattern}$`;
  const matcher = new RegExp(pattern, 'i');
  const matches = allAssets.filter(candidate => matcher.test(candidate.name));
  return matches.length === 1 ? pattern : `^${escapeRegex(asset.name)}$`;
}

function selectDownload(candidate, os) {
  const options = candidate.assets.filter(asset => detectPlatform(asset.name) === os);
  if (!options.length) return null;
  const asset = [...options].sort((a, b) => assetScore(b, os) - assetScore(a, os))[0];
  return {
    os,
    label: os === 'windows' ? 'Windows 64-bit' : os === 'macos' ? 'macOS' : 'Linux 64-bit',
    pattern: stablePattern(asset, candidate.release, candidate.assets),
    reviewedAsset: asset.name
  };
}

const batch = [];
for (const metadata of selection) {
  const repository = metadata.github.toLowerCase();
  if (publishedRepositories.has(repository)) continue;
  const candidate = byRepository.get(repository);
  if (!candidate) throw new Error(`${metadata.github}: candidate not found in crawl artifact`);
  if (candidate.score < 80) throw new Error(`${metadata.github}: score ${candidate.score} is below publication threshold`);
  if (!candidate.license || ['NOASSERTION', 'OTHER'].includes(candidate.license)) throw new Error(`${metadata.github}: licence is not machine-verifiable`);

  const downloads = ['windows', 'macos', 'linux'].map(os => selectDownload(candidate, os)).filter(Boolean);
  if (!downloads.length) throw new Error(`${metadata.github}: no desktop downloads selected`);
  for (const download of downloads) {
    const matcher = new RegExp(download.pattern, 'i');
    const matches = candidate.assets.filter(asset => matcher.test(asset.name));
    if (matches.length !== 1) throw new Error(`${metadata.github}/${download.os}: pattern matches ${matches.length} assets`);
  }

  batch.push({
    slug: metadata.slug,
    name: metadata.name,
    category: metadata.category,
    categoryLabel: metadata.categoryLabel,
    shortDescription: metadata.shortDescription,
    fullDescription: metadata.fullDescription,
    github: candidate.github,
    website: metadata.website || candidate.website || candidate.repositoryUrl,
    platforms: downloads.map(download => download.os),
    features: metadata.features,
    downloads: downloads.map(({reviewedAsset, ...download}) => download),
    verifiedAt
  });
}

await writeFile(batchFile, `${JSON.stringify(batch, null, 2)}\n`);
if (apply) {
  const merged = [...published, ...batch];
  await writeFile(path.join(root, 'data', 'software.json'), `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`Prepared ${batch.length} reviewed programs${apply ? ' and appended them to software.json' : ''}.`);
