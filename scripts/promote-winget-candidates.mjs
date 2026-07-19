import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const input = path.resolve(root, String(args.input || 'data/winget-crawl.drafts.json'));
const selectionFile = path.resolve(root, String(args.selection || 'data/winget-publication-selection.json'));
const batchFile = path.resolve(root, String(args.output || 'data/software-winget.batch.json'));
const apply = args.apply === true || args.apply === 'true';

const [candidates, selection, published] = await Promise.all([
  readFile(input, 'utf8').then(JSON.parse),
  readFile(selectionFile, 'utf8').then(JSON.parse),
  readFile(path.join(root, 'data', 'software.json'), 'utf8').then(JSON.parse)
]);
const byIdentifier = new Map(candidates.map(candidate => [candidate.packageIdentifier.toLowerCase(), candidate]));
const publishedBySlug = new Map(published.map(item => [item.slug, item]));
const selectedIdentifiers = new Set();
const selectedSlugs = new Set();
const verifiedAt = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

function installerScore(installer) {
  const pathname = new URL(installer.url).pathname.toLowerCase();
  let score = installer.architecture === 'x64' ? 30 : 10;
  if (/\.(?:exe|msi|msix|msixbundle)$/i.test(pathname)) score += 30;
  if (/(?:setup|install|installer)/i.test(pathname)) score += 18;
  if (/portable/i.test(pathname) || installer.type === 'portable') score -= 12;
  if (/\.zip$/i.test(pathname)) score -= 8;
  if (installer.scope === 'user') score += 3;
  return score;
}

function selectInstaller(candidate) {
  return [...candidate.installers].sort((a, b) => installerScore(b) - installerScore(a))[0];
}

const batch = selection.map(metadata => {
  const identifier = metadata.packageIdentifier.toLowerCase();
  if (selectedIdentifiers.has(identifier)) throw new Error(`${metadata.packageIdentifier}: duplicate selection`);
  const publishedWithSlug = publishedBySlug.get(metadata.slug);
  if (selectedSlugs.has(metadata.slug) || (publishedWithSlug && publishedWithSlug.packageIdentifier?.toLowerCase() !== identifier)) {
    throw new Error(`${metadata.slug}: duplicate published slug`);
  }
  selectedIdentifiers.add(identifier);
  selectedSlugs.add(metadata.slug);

  const candidate = byIdentifier.get(identifier);
  if (!candidate) throw new Error(`${metadata.packageIdentifier}: candidate not found in WinGet artifact`);
  if (!candidate.openSource || !candidate.desktopLikely || candidate.score < 80) {
    throw new Error(`${metadata.packageIdentifier}: candidate is below publication policy`);
  }
  if (!/^[a-f0-9]{64}$/i.test(candidate.sourceManifest?.sha256 || '')) {
    throw new Error(`${metadata.packageIdentifier}: verified source manifest hash is missing`);
  }
  const installer = selectInstaller(candidate);
  if (!installer || !/^[a-f0-9]{64}$/i.test(installer.sha256 || '')) {
    throw new Error(`${metadata.packageIdentifier}: installer SHA-256 is missing`);
  }
  const extension = new URL(installer.url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();

  return {
    slug: metadata.slug,
    name: metadata.name || candidate.name,
    category: metadata.category,
    categoryLabel: metadata.categoryLabel,
    shortDescription: metadata.shortDescription,
    fullDescription: metadata.fullDescription,
    website: metadata.website || candidate.website,
    platforms: ['windows'],
    features: metadata.features,
    ...(metadata.priceLabel ? {priceLabel: metadata.priceLabel} : {}),
    downloads: [{
      os: 'windows',
      label: extension === 'zip' ? 'Windows 64-bit · portable' : 'Windows 64-bit',
      url: installer.url,
      sha256: installer.sha256,
      version: candidate.version
    }],
    source: 'winget',
    packageIdentifier: candidate.packageIdentifier,
    publisher: candidate.publisher,
    license: candidate.license,
    sourceManifestSha256: candidate.sourceManifest.sha256,
    verifiedAt
  };
});

await writeFile(batchFile, `${JSON.stringify(batch, null, 2)}\n`);
if (apply) {
  const replacements = new Map(batch.map(item => [item.packageIdentifier.toLowerCase(), item]));
  const merged = published.map(item => replacements.get(item.packageIdentifier?.toLowerCase()) || item);
  const existingIdentifiers = new Set(published.map(item => item.packageIdentifier?.toLowerCase()).filter(Boolean));
  merged.push(...batch.filter(item => !existingIdentifiers.has(item.packageIdentifier.toLowerCase())));
  await writeFile(path.join(root, 'data', 'software.json'), `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`Prepared ${batch.length} reviewed WinGet programs${apply ? ' and applied them to software.json' : ''}.`);
