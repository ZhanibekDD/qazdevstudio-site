const REJECTED_ASSET = /(source|src|symbols?|debug|\.pdb\b|checksums?|sha(?:1|256|512)?(?:sums?)?|\.sig\b|\.asc\b|\.blockmap\b|update\.ya?ml$|latest\.ya?ml$)/i;

const PLATFORM_RULES = [
  ['windows', /\.(?:exe|msi|msix|msixbundle|appx|appxbundle)$/i],
  ['macos', /\.(?:dmg|pkg)$/i],
  ['linux', /\.(?:appimage|deb|rpm|flatpak|snap)$/i],
  ['android', /\.apk$/i]
];

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function detectArchitecture(name) {
  if (/(?:arm64|aarch64|apple[-_. ]?silicon|silicon)/i.test(name)) return 'arm64';
  if (/(?:x86_64|x64|amd64|win64|intel)/i.test(name)) return 'x64';
  if (/(?:i[3-6]86|x86|win32)/i.test(name)) return 'x86';
  if (/(?:universal|all[-_.]?arch|noarch)/i.test(name)) return 'universal';
  return 'unknown';
}

export function detectPlatform(name) {
  for (const [platform, pattern] of PLATFORM_RULES) {
    if (pattern.test(name)) return platform;
  }

  if (/\.(?:zip|7z|tar\.gz|tgz)$/i.test(name)) {
    if (/(?:macos|darwin|osx)/i.test(name)) return 'macos';
    if (/(?:windows|(?:^|[-_.])win(?:32|64|[-_.]?x64)(?:[-_.]|$))/i.test(name)) return 'windows';
    if (/(?:linux|ubuntu|debian)/i.test(name)) return 'linux';
  }

  return null;
}

export function selectDownloadableAssets(assets = []) {
  return assets
    .filter(asset => asset && asset.name && asset.browser_download_url)
    .filter(asset => !REJECTED_ASSET.test(asset.name))
    .map(asset => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: Number(asset.size || 0),
      downloads: Number(asset.download_count || 0),
      digest: asset.digest || null,
      platform: detectPlatform(asset.name),
      architecture: detectArchitecture(asset.name)
    }))
    .filter(asset => asset.platform);
}

export function scoreCandidate(repo, release, assets, now = new Date()) {
  let score = 0;
  const reasons = [];
  const spdx = repo.license?.spdx_id;
  const hasLicense = Boolean(spdx && !['NOASSERTION', 'OTHER'].includes(spdx));
  if (hasLicense) {
    score += 15;
    reasons.push(`лицензия ${spdx}`);
  }

  const stars = Number(repo.stargazers_count || 0);
  const starPoints = stars >= 50000 ? 25 : stars >= 10000 ? 22 : stars >= 3000 ? 18 : stars >= 1000 ? 14 : stars >= 300 ? 9 : 0;
  score += starPoints;
  if (starPoints) reasons.push(`${stars.toLocaleString('en-US')} stars`);

  const platforms = new Set(assets.map(asset => asset.platform));
  const platformPoints = Math.min(20, platforms.size * 7);
  score += platformPoints;
  if (platforms.size) reasons.push(`${platforms.size} платформ`);

  const publishedAt = new Date(release.published_at || release.created_at || 0);
  const ageDays = Number.isFinite(publishedAt.valueOf()) ? Math.max(0, (now - publishedAt) / 86400000) : Infinity;
  if (ageDays <= 180) {
    score += 15;
    reasons.push('свежий релиз');
  } else if (ageDays <= 365) {
    score += 10;
  } else if (ageDays <= 730) {
    score += 5;
  }

  const downloadCount = assets.reduce((sum, asset) => sum + asset.downloads, 0);
  if (downloadCount >= 10000) score += 10;
  else if (downloadCount >= 1000) score += 8;
  else if (downloadCount >= 100) score += 5;

  if (repo.homepage) score += 5;
  if (repo.description) score += 5;
  if ((repo.topics || []).length) score += 5;

  return {
    score: Math.min(100, score),
    reasons,
    hasLicense,
    ageDays: Number.isFinite(ageDays) ? Math.round(ageDays) : null,
    downloadCount
  };
}

export function buildCandidate(repo, release, category, now = new Date()) {
  if (!repo || repo.archived || repo.fork || repo.disabled) return null;
  if (!release || release.draft || release.prerelease) return null;

  const assets = selectDownloadableAssets(release.assets);
  if (!assets.length) return null;

  const scored = scoreCandidate(repo, release, assets, now);
  const fullName = repo.full_name;
  return {
    id: fullName.toLowerCase(),
    slug: slugify(repo.name),
    name: repo.name,
    github: fullName,
    source: 'github-releases',
    category: category.id,
    categoryLabel: category.label,
    description: repo.description || '',
    website: repo.homepage || repo.html_url,
    repositoryUrl: repo.html_url,
    stars: Number(repo.stargazers_count || 0),
    license: repo.license?.spdx_id || null,
    topics: repo.topics || [],
    score: scored.score,
    scoreReasons: scored.reasons,
    release: {
      tag: release.tag_name,
      name: release.name || release.tag_name,
      publishedAt: release.published_at || release.created_at,
      url: release.html_url
    },
    assets,
    platformCount: new Set(assets.map(asset => asset.platform)).size,
    releaseDownloads: scored.downloadCount,
    reviewStatus: scored.hasLicense && scored.score >= 65 ? 'ready-for-review' : 'needs-review',
    indexable: false,
    publishable: false,
    collectedAt: now.toISOString()
  };
}

export function summarizeCandidates(candidates = []) {
  const byCategory = {};
  const byStatus = {};
  const byPlatform = {};
  for (const candidate of candidates) {
    byCategory[candidate.category] = (byCategory[candidate.category] || 0) + 1;
    byStatus[candidate.reviewStatus] = (byStatus[candidate.reviewStatus] || 0) + 1;
    for (const platform of new Set(candidate.assets.map(asset => asset.platform))) {
      byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    }
  }
  return {total: candidates.length, byCategory, byStatus, byPlatform};
}
