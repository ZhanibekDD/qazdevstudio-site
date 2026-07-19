import {createHash} from 'node:crypto';

const OPEN_SOURCE_LICENSE = /(?:\bMIT\b|Apache|GPL|LGPL|AGPL|MPL|BSD|ISC|EPL|EUPL|CDDL|Unlicense|open[ -]?source)/i;
const SUPPORTED_INSTALLER = /\.(?:exe|msi|msix|msixbundle|appx|appxbundle|zip)$/i;
const BLOCKED_HOST = /(?:softonic|filehippo|uptodown|mediafire|mega\.nz|bit\.ly|tinyurl)/i;

export function yamlScalar(value = '') {
  const text = String(value).trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  return text;
}

function topLevelValue(lines, key) {
  const prefix = `${key}:`;
  const line = lines.find(candidate => candidate.startsWith(prefix));
  return line ? yamlScalar(line.slice(prefix.length)) : '';
}

function topLevelList(lines, key) {
  const start = lines.findIndex(line => line === `${key}:`);
  if (start < 0) return [];
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9]+:/.test(line)) break;
    const match = line.match(/^-\s+(.+)$/);
    if (match) values.push(yamlScalar(match[1]));
  }
  return values;
}

function installerBlock(lines, inheritedType) {
  const start = lines.findIndex(line => line === 'Installers:');
  if (start < 0) return [];
  const result = [];
  let current = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9]+:/.test(line)) break;
    const first = line.match(/^-\s+([A-Za-z][A-Za-z0-9]+):\s*(.*)$/);
    if (first) {
      if (current) result.push(current);
      current = {InstallerType: inheritedType};
      current[first[1]] = yamlScalar(first[2]);
      continue;
    }
    const property = line.match(/^\s{2}([A-Za-z][A-Za-z0-9]+):\s*(.*)$/);
    if (current && property) current[property[1]] = yamlScalar(property[2]);
  }
  if (current) result.push(current);
  return result;
}

export function parseMergedManifest(text) {
  const lines = String(text).replaceAll('\r', '').split('\n');
  const installerType = topLevelValue(lines, 'InstallerType');
  return {
    packageIdentifier: topLevelValue(lines, 'PackageIdentifier'),
    packageVersion: topLevelValue(lines, 'PackageVersion'),
    packageName: topLevelValue(lines, 'PackageName'),
    publisher: topLevelValue(lines, 'Publisher'),
    packageUrl: topLevelValue(lines, 'PackageUrl') || topLevelValue(lines, 'PublisherUrl'),
    publisherUrl: topLevelValue(lines, 'PublisherUrl'),
    license: topLevelValue(lines, 'License'),
    licenseUrl: topLevelValue(lines, 'LicenseUrl'),
    shortDescription: topLevelValue(lines, 'ShortDescription'),
    releaseDate: topLevelValue(lines, 'ReleaseDate'),
    tags: topLevelList(lines, 'Tags'),
    installers: installerBlock(lines, installerType).map(installer => ({
      architecture: String(installer.Architecture || '').toLowerCase(),
      type: String(installer.InstallerType || installerType || '').toLowerCase(),
      url: installer.InstallerUrl || '',
      sha256: String(installer.InstallerSha256 || '').toLowerCase(),
      scope: String(installer.Scope || '').toLowerCase()
    }))
  };
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function isOpenSourceLicense(license) {
  return OPEN_SOURCE_LICENSE.test(String(license || ''));
}

export function isAllowedInstaller(installer) {
  if (!['x64', 'neutral', ''].includes(installer.architecture)) return false;
  if (!/^[a-f0-9]{64}$/i.test(installer.sha256)) return false;
  let url;
  try { url = new URL(installer.url); } catch { return false; }
  if (url.protocol !== 'https:' || BLOCKED_HOST.test(url.hostname)) return false;
  return SUPPORTED_INSTALLER.test(url.pathname);
}

export function selectInstallers(installers = []) {
  const seen = new Set();
  return installers
    .filter(isAllowedInstaller)
    .sort((a, b) => {
      const architecture = value => value === 'x64' ? 2 : value === 'neutral' ? 1 : 0;
      const extension = value => /\.(?:exe|msi)$/i.test(new URL(value).pathname) ? 2 : 1;
      return architecture(b.architecture) - architecture(a.architecture) || extension(b.url) - extension(a.url);
    })
    .filter(installer => {
      const key = `${installer.url}|${installer.sha256}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

export function classifyWingetCategory(manifest) {
  const text = [manifest.packageName, manifest.shortDescription, ...(manifest.tags || [])].join(' ').toLowerCase();
  const rules = [
    ['security', 'Безопасность', /password|encrypt|security|privacy|vpn|antivirus|firewall|шифр|парол/],
    ['developer', 'Разработка', /developer|programming|\bide\b|\bapi\b|database|terminal|\bssh\b|\bgit\b|code editor/],
    ['multimedia', 'Видео и аудио', /video|audio|media player|music|podcast|screen recorder|streaming/],
    ['graphics', 'Графика и фото', /image|photo|graphic|design|drawing|screenshot|\bocr\b/],
    ['productivity', 'Работа и текст', /productivity|note|markdown|office|document|\bpdf\b|calendar|task|mind map/],
    ['communication', 'Общение', /chat|messaging|meeting|email|mail client|conference/],
    ['network', 'Сеть и файлы', /remote desktop|network|file transfer|\bftp\b|torrent|download manager|sync/],
    ['system', 'Система', /utility|file manager|archive|compression|backup|launcher|system tool|uninstall/],
    ['internet', 'Интернет', /browser|web browser|internet/]
  ];
  const match = rules.find(([, , pattern]) => pattern.test(text));
  return match ? {id: match[0], label: match[1]} : {id: 'other', label: 'Другие программы'};
}

export function buildWingetCandidate(manifest, source = {}) {
  const installers = selectInstallers(manifest.installers);
  if (!manifest.packageIdentifier || !manifest.packageName || !installers.length) return null;
  const openSource = isOpenSourceLicense(manifest.license);
  const descriptiveText = [manifest.packageName, manifest.shortDescription, ...(manifest.tags || [])].join(' ');
  const desktopLikely = !/(?:\bserver\b|command[- ]?line|\bcli\b|\bruntime\b|\bsdk\b|\bdriver\b|\bcompiler\b|\blibrary\b|\bdaemon\b|headless|web ui|web interface|development kit)/i.test(descriptiveText);
  let score = 30;
  const reasons = ['SHA-256 для установщика'];
  if (installers.some(item => item.architecture === 'x64')) { score += 15; reasons.push('Windows x64'); }
  if (openSource) { score += 20; reasons.push('открытая лицензия'); }
  if (manifest.packageUrl?.startsWith('https://')) score += 10;
  if (manifest.shortDescription) score += 10;
  if (manifest.tags?.length) score += 5;
  if (!desktopLikely) score -= 20;
  if (manifest.releaseDate) {
    const age = (Date.now() - new Date(`${manifest.releaseDate}T00:00:00Z`)) / 86400000;
    if (Number.isFinite(age) && age <= 730) { score += 10; reasons.push('свежий релиз'); }
  }
  const category = classifyWingetCategory(manifest);
  return {
    id: `winget:${manifest.packageIdentifier.toLowerCase()}`,
    source: 'winget',
    packageIdentifier: manifest.packageIdentifier,
    name: manifest.packageName,
    publisher: manifest.publisher,
    version: manifest.packageVersion,
    description: manifest.shortDescription,
    website: manifest.packageUrl || manifest.publisherUrl,
    license: manifest.license || null,
    licenseUrl: manifest.licenseUrl || null,
    openSource,
    desktopLikely,
    category: category.id,
    categoryLabel: category.label,
    tags: manifest.tags || [],
    installers,
    score: Math.min(100, score),
    scoreReasons: reasons,
    reviewStatus: openSource && desktopLikely && score >= 80 ? 'ready-for-review' : 'needs-review',
    indexable: false,
    publishable: false,
    sourceManifest: {
      path: source.path,
      sha256: source.sha256,
      collectedAt: source.collectedAt || new Date().toISOString()
    }
  };
}
