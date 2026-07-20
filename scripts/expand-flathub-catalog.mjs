import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, '').split('=');
  return [key, value.join('=') || true];
}));
const target = Math.max(200, Math.min(5000, Number.parseInt(args.target || '1000', 10)));
const apply = args.apply === true || args.apply === 'true';
const input = path.resolve(root, String(args.input || 'data/flathub-crawl.drafts.json'));
const output = path.resolve(root, String(args.output || 'data/software-expansion.batch.json'));
const catalogFile = path.join(root, 'data', 'software.json');

const [candidates, published] = await Promise.all([
  readFile(input, 'utf8').then(JSON.parse),
  readFile(catalogFile, 'utf8').then(JSON.parse)
]);

const categoryCaps = {
  system: 180,
  productivity: 150,
  developer: 150,
  graphics: 105,
  multimedia: 105,
  games: 100,
  internet: 90,
  security: 70,
  communication: 60,
  education: 55
};

const purposes = [
  [/screenshot|screen.?capture|screen.?record/i, 'создания снимков и записи экрана', ['Снимки экрана', 'Запись экрана']],
  [/photo|image|drawing|paint|graphics|svg|3d|model/i, 'работы с изображениями и графикой', ['Графика', 'Изображения']],
  [/video|movie|subtitle|media.?player/i, 'просмотра и обработки видео', ['Видео', 'Мультимедиа']],
  [/audio|music|podcast|sound/i, 'работы со звуком и музыкой', ['Аудио', 'Музыка']],
  [/password|encrypt|privacy|security|authenticat/i, 'защиты данных и конфиденциальности', ['Безопасность', 'Конфиденциальность']],
  [/browser|internet|torrent|download|network/i, 'работы в интернете и с сетью', ['Интернет', 'Сеть']],
  [/chat|messenger|mail|communication|matrix/i, 'общения и обмена сообщениями', ['Общение', 'Сообщения']],
  [/code|developer|programming|database|terminal|git|api/i, 'разработки и администрирования', ['Разработка', 'Инструменты']],
  [/document|office|note|markdown|pdf|calendar|task|productivity/i, 'работы с документами и задачами', ['Документы', 'Продуктивность']],
  [/learn|education|school|study|language/i, 'обучения и самостоятельной практики', ['Обучение', 'Практика']],
  [/game|strategy|puzzle|simulation|arcade/i, 'игр и развлечений', ['Игры', 'Развлечения']],
  [/file|archive|backup|sync|transfer/i, 'управления файлами и резервными копиями', ['Файлы', 'Резервные копии']]
];
const reservedSlugs = new Set(['index', 'catalog', 'catalog-data', 'kategorii']);

function purposeFor(candidate) {
  const text = [candidate.description, candidate.longDescription, ...(candidate.tags || [])].join(' ');
  const match = purposes.find(([pattern]) => pattern.test(text));
  return match ? {text: match[1], features: match[2]} : {
    text: candidate.category === 'system' ? 'настройки и обслуживания Linux' : `задач категории «${candidate.categoryLabel}»`,
    features: [candidate.categoryLabel, 'Приложение Linux']
  };
}

function slugify(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, '-and-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
}

function uniqueSlug(candidate, used) {
  const base = slugify(candidate.name) || slugify(candidate.appId) || 'linux-app';
  if (!used.has(base) && !reservedSlugs.has(base)) return base;
  const suffix = slugify(candidate.appId.split('.').slice(-2).join('-')).slice(-28)
    || createHash('sha1').update(candidate.appId).digest('hex').slice(0, 8);
  let result = `${base.slice(0, Math.max(10, 71 - suffix.length))}-${suffix}`;
  if (!used.has(result)) return result;
  return `${base.slice(0, 62)}-${createHash('sha1').update(candidate.appId).digest('hex').slice(0, 8)}`;
}

function validCandidate(candidate) {
  if (candidate.source !== 'flathub' || candidate.reviewStatus !== 'ready-for-review') return false;
  if (!candidate.openSource || !candidate.verified || candidate.score < 95) return false;
  if (!candidate.appId || !candidate.version || !candidate.license || !candidate.developer) return false;
  if (!candidate.website?.startsWith('https://') || !candidate.icon?.startsWith('https://dl.flathub.org/')) return false;
  if (!candidate.description || candidate.description.length < 8 || !candidate.longDescription || candidate.longDescription.length < 70) return false;
  try {
    const download = new URL(candidate.download?.url);
    return download.hostname === 'dl.flathub.org'
      && download.pathname === `/repo/appstream/${candidate.appId}.flatpakref`;
  } catch {
    return false;
  }
}

const existingAppIds = new Set(published.map(item => item.appId?.toLowerCase()).filter(Boolean));
const usedSlugs = new Set(published.map(item => item.slug));
const counts = Object.fromEntries(Object.keys(categoryCaps).map(category => [category, published.filter(item => item.category === category).length]));
const buckets = new Map();
for (const candidate of candidates.filter(validCandidate)) {
  if (existingAppIds.has(candidate.appId.toLowerCase())) continue;
  if (!categoryCaps[candidate.category]) continue;
  if (!buckets.has(candidate.category)) buckets.set(candidate.category, []);
  buckets.get(candidate.category).push(candidate);
}
for (const bucket of buckets.values()) bucket.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'));

const selected = [];
const categories = Object.keys(categoryCaps);
while (published.length + selected.length < target) {
  let progressed = false;
  for (const category of categories) {
    if (published.length + selected.length >= target) break;
    if ((counts[category] || 0) >= categoryCaps[category]) continue;
    const candidate = buckets.get(category)?.shift();
    if (!candidate) continue;
    selected.push(candidate);
    counts[category] = (counts[category] || 0) + 1;
    progressed = true;
  }
  if (!progressed) break;
}

if (published.length + selected.length < target) {
  const leftovers = [...buckets.values()].flat().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'));
  selected.push(...leftovers.slice(0, target - published.length - selected.length));
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const batch = selected.map(candidate => {
  const purpose = purposeFor(candidate);
  const slug = uniqueSlug(candidate, usedSlugs);
  usedSlugs.add(slug);
  const version = String(candidate.version);
  return {
    slug,
    name: candidate.name,
    category: candidate.category,
    categoryLabel: candidate.categoryLabel,
    shortDescription: `${candidate.name} — программа для ${purpose.text} в Linux. Версия ${version}, установка через официальный Flathub.`,
    fullDescription: `${candidate.name} — приложение для ${purpose.text}. Разработчик: ${candidate.developer}. Актуальная версия ${version} распространяется по лицензии ${candidate.license}. Карточка сформирована по проверенным данным Flathub AppStream, а кнопка скачивает официальный Flatpak-профиль без рекламных загрузчиков.`,
    sourceDescription: candidate.longDescription,
    website: candidate.website,
    platforms: ['linux'],
    features: [...new Set([...purpose.features, 'Открытый код', 'Flatpak'])].slice(0, 5),
    downloads: [{
      os: 'linux', label: 'Linux · Flatpak', type: 'flatpakref',
      url: candidate.download.url, version
    }],
    source: 'flathub',
    appId: candidate.appId,
    developer: candidate.developer,
    license: candidate.license,
    version,
    icon: candidate.icon,
    verifiedDeveloper: true,
    sourceSnapshotSha256: candidate.sourceSnapshot?.sha256 || null,
    verifiedAt: today
  };
});

if (published.length + batch.length !== target) {
  throw new Error(`Only ${published.length + batch.length} programs satisfy the strict publication policy; target is ${target}.`);
}

await writeFile(output, `${JSON.stringify(batch, null, 2)}\n`);
if (apply) await writeFile(catalogFile, `${JSON.stringify([...published, ...batch], null, 2)}\n`);

console.log(`Prepared ${batch.length} verified Flathub programs; catalog total ${published.length + batch.length}${apply ? ' (applied)' : ''}.`);
console.log(`Category totals: ${JSON.stringify(counts)}`);
