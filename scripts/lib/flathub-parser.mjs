import {createHash} from 'node:crypto';

const OPEN_SOURCE_LICENSE = /(?:\bMIT\b|Apache|GPL|LGPL|AGPL|MPL|BSD|ISC|EPL|EUPL|CDDL|Unlicense|CC0|Artistic|Zlib|Boost)/i;

function decodeXml(value = '') {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripMarkup(value = '') {
  return decodeXml(String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function exactTag(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? stripMarkup(match[1]) : '';
}

function tags(xml, tag) {
  return [...String(xml).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))]
    .map(match => stripMarkup(match[1]))
    .filter(Boolean);
}

function attributes(tag = '') {
  return Object.fromEntries([...String(tag).matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], decodeXml(match[2])]));
}

function typedUrl(xml, type) {
  const matches = [...String(xml).matchAll(/<url\s+([^>]*)>([\s\S]*?)<\/url>/gi)];
  const match = matches.find(item => attributes(item[1]).type === type);
  return match ? stripMarkup(match[2]) : '';
}

function remoteIcon(xml) {
  const matches = [...String(xml).matchAll(/<icon\s+([^>]*)>([\s\S]*?)<\/icon>/gi)]
    .map(match => ({attributes: attributes(match[1]), value: stripMarkup(match[2])}))
    .filter(icon => {
      if (icon.attributes.type !== 'remote') return false;
      try { return new URL(icon.value).hostname === 'dl.flathub.org'; }
      catch { return false; }
    });
  return matches.find(icon => icon.attributes.width === '128' && !icon.attributes.scale)?.value || matches[0]?.value || '';
}

function latestRelease(xml) {
  const releases = [...String(xml).matchAll(/<release\s+([^>]*?)(?:\/>|>[\s\S]*?<\/release>)/gi)]
    .map(match => attributes(match[1]))
    .filter(release => release.version)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  return releases[0] || {};
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function splitDesktopComponents(xml) {
  return [...String(xml).matchAll(/<component\s+type="desktop-application">([\s\S]*?)<\/component>/gi)].map(match => match[1]);
}

export function parseFlathubComponent(xml) {
  const release = latestRelease(xml);
  const bundle = String(xml).match(/<bundle\s+([^>]*)>([^<]+)<\/bundle>/i);
  const custom = Object.fromEntries([...String(xml).matchAll(/<value\s+key="([^"]+)">([\s\S]*?)<\/value>/gi)]
    .map(match => [match[1], stripMarkup(match[2])]));
  return {
    appId: exactTag(xml, 'id'),
    name: exactTag(xml, 'name'),
    summary: exactTag(xml, 'summary'),
    description: exactTag(xml, 'description'),
    developer: exactTag(xml, 'developer_name') || exactTag(xml, 'name'),
    license: exactTag(xml, 'project_license'),
    website: typedUrl(xml, 'homepage'),
    sourceCode: typedUrl(xml, 'vcs-browser'),
    bugTracker: typedUrl(xml, 'bugtracker'),
    categories: tags(xml, 'category'),
    keywords: tags(xml, 'keyword'),
    icon: remoteIcon(xml),
    version: release.version || '',
    releaseTimestamp: Number(release.timestamp || 0),
    verified: custom['flathub::verification::verified'] === 'true',
    verificationMethod: custom['flathub::verification::method'] || '',
    verificationWebsite: custom['flathub::verification::website'] || '',
    bundle: bundle ? stripMarkup(bundle[2]) : '',
    bundleType: bundle ? attributes(bundle[1]).type || '' : ''
  };
}

export function classifyFlathubCategory(component) {
  const values = new Set(component.categories.map(value => value.toLowerCase()));
  const text = [component.name, component.summary, ...component.keywords].join(' ').toLowerCase();
  if (values.has('development')) return {id: 'developer', label: 'Разработка'};
  if (values.has('graphics') || /photo|image|drawing|paint|design|3d/.test(text)) return {id: 'graphics', label: 'Графика и фото'};
  if (values.has('audio') || values.has('video') || values.has('audiovideo') || /audio|video|music|media/.test(text)) return {id: 'multimedia', label: 'Видео и аудио'};
  if (values.has('office') || /document|office|note|markdown|pdf|calendar|task/.test(text)) return {id: 'productivity', label: 'Работа и текст'};
  if (values.has('network') || /browser|internet|torrent|download|network/.test(text)) return {id: 'internet', label: 'Интернет'};
  if (values.has('chat') || /chat|messenger|email|communication/.test(text)) return {id: 'communication', label: 'Общение'};
  if (values.has('security') || /password|security|privacy|encrypt|vpn/.test(text)) return {id: 'security', label: 'Безопасность'};
  if (values.has('game')) return {id: 'games', label: 'Игры'};
  if (values.has('education')) return {id: 'education', label: 'Образование'};
  return {id: 'system', label: 'Система'};
}

export function buildFlathubCandidate(component, source = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(component.appId) || !component.name || component.bundleType !== 'flatpak') return null;
  if (!component.bundle.startsWith(`app/${component.appId}/`)) return null;
  const openSource = OPEN_SOURCE_LICENSE.test(component.license) && !/proprietary|LicenseRef/i.test(component.license);
  const category = classifyFlathubCategory(component);
  let score = 35;
  const reasons = ['desktop-приложение из официального AppStream'];
  if (openSource) { score += 20; reasons.push('открытая лицензия'); }
  if (component.verified) { score += 20; reasons.push('разработчик подтверждён Flathub'); }
  if (component.summary) score += 5;
  if (component.description) score += 5;
  if (component.icon) score += 5;
  if (component.website?.startsWith('https://')) score += 5;
  if (component.releaseTimestamp && Date.now() / 1000 - component.releaseTimestamp <= 60 * 60 * 24 * 730) {
    score += 5;
    reasons.push('свежий релиз');
  }
  const refUrl = `https://dl.flathub.org/repo/appstream/${encodeURIComponent(component.appId)}.flatpakref`;
  return {
    id: `flathub:${component.appId.toLowerCase()}`,
    source: 'flathub',
    appId: component.appId,
    name: component.name,
    developer: component.developer,
    version: component.version || null,
    description: component.summary,
    longDescription: component.description,
    website: component.website || component.sourceCode || `https://flathub.org/apps/${component.appId}`,
    sourceCode: component.sourceCode || null,
    license: component.license || null,
    openSource,
    verified: component.verified,
    verificationMethod: component.verificationMethod || null,
    category: category.id,
    categoryLabel: category.label,
    tags: [...new Set([...component.categories, ...component.keywords])],
    icon: component.icon || null,
    download: {os: 'linux', type: 'flatpakref', url: refUrl},
    score: Math.min(100, score),
    scoreReasons: reasons,
    reviewStatus: openSource && component.verified && score >= 80 ? 'ready-for-review' : 'needs-review',
    indexable: false,
    publishable: false,
    sourceSnapshot: {
      sha256: source.sha256,
      collectedAt: source.collectedAt || new Date().toISOString()
    }
  };
}
