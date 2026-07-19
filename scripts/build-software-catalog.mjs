import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const outputDir=path.join(root,'programmy');
const site='https://qazdevstudio.kz';
const items=JSON.parse(await readFile(path.join(root,'data','software.json'),'utf8'));
await mkdir(outputDir,{recursive:true});

const required=['slug','name','category','categoryLabel','shortDescription','fullDescription','github','website','platforms','features','downloads','verifiedAt'];
const slugs=new Set();
for(const item of items){
  for(const field of required)if(!item[field]||(Array.isArray(item[field])&&!item[field].length))throw new Error(`${item.slug||item.name||'item'}: missing ${field}`);
  if(!/^[a-z0-9-]+$/.test(item.slug))throw new Error(`${item.slug}: invalid slug`);
  if(slugs.has(item.slug))throw new Error(`${item.slug}: duplicate slug`);
  if(!/^[\w.-]+\/[\w.-]+$/.test(item.github))throw new Error(`${item.slug}: invalid GitHub repository`);
  for(const download of item.downloads){
    if(!['windows','macos','linux'].includes(download.os))throw new Error(`${item.slug}: invalid OS ${download.os}`);
    new RegExp(download.pattern,'i');
  }
  slugs.add(item.slug);
  new URL(item.website);
}

for(const file of await readdir(outputDir)){
  if(file.endsWith('.html'))await unlink(path.join(outputDir,file));
}

const e=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const initials=name=>name.split(/\s+/).map(word=>word[0]).join('').slice(0,2).toUpperCase();
const logoUrl=item=>`https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(item.website)}&sz=128`;
const logo=(item,detail=false)=>`<div class="${detail?'detail-logo':'software-logo'}"><span aria-hidden="true">${e(initials(item.name))}</span><img src="${e(logoUrl(item))}" alt="Логотип ${e(item.name)}" ${detail?'fetchpriority="high"':'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"></div>`;
const dateRu=value=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`));
const osIcon={windows:'⊞',macos:'◆',linux:'◉'};
const downloadButtons=item=>item.downloads.map(download=>`<button class="download-btn" type="button" data-repo="${e(item.github)}" data-pattern="${e(download.pattern)}" data-os="${e(download.os)}"><span aria-hidden="true">${osIcon[download.os]}</span> Скачать · ${e(download.label)}</button>`).join('');
const categories=[...new Map(items.map(item=>[item.category,item.categoryLabel])).entries()];

const head=({title,description,canonical,schema=''})=>`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><meta name="description" content="${e(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${e(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="QazDev Studio"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(canonical)}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/programmy/catalog.css">${schema}`;
const header=`<header class="site-header"><div class="container nav"><a class="brand" href="/"><span>QazDev</span> Studio</a><nav class="nav-links" aria-label="Основная навигация"><a href="/programmy/">Программы</a><a href="/templates/">Шаблоны</a><a href="/blog/">Блог</a><a class="nav-cta" href="https://wa.me/77000300024?text=${encodeURIComponent('Здравствуйте! Нужна программа или автоматизация для бизнеса')}">Написать нам</a></nav></div></header>`;
const footer=`<footer class="site-footer"><div class="container footer-row"><span>© 2026 QazDev Studio · Казахстан</span><span>Файлы загружаются из официальных GitHub Releases · <a href="mailto:hello@qazdevstudio.kz">Предложить программу</a></span></div></footer><div class="download-toast" id="downloadToast" role="status" aria-live="polite"></div><script src="/programmy/catalog.js" defer></script>`;
const layout=({title,description,canonical,body,schema=''})=>`<!doctype html><html lang="ru"><head>${head({title,description,canonical,schema})}</head><body>${header}${body}${footer}</body></html>`;

const cards=items.map(item=>`<article class="software-card" data-category="${e(item.category)}" data-search="${e([item.name,item.categoryLabel,item.shortDescription,...item.features].join(' '))}"><div class="card-top">${logo(item)}<div><a class="card-title" href="/programmy/${e(item.slug)}.html">${e(item.name)}</a><div class="card-category">${e(item.categoryLabel)}</div></div></div><p class="card-desc">${e(item.shortDescription)}</p><div class="tags">${item.features.slice(0,3).map(feature=>`<span class="tag">${e(feature)}</span>`).join('')}</div><div class="download-actions">${downloadButtons(item)}</div><div class="card-bottom"><span class="source-badge">✓ Официальный GitHub Release</span><a class="details" href="/programmy/${e(item.slug)}.html">Подробнее →</a></div></article>`).join('\n');
const categoryButtons=[['all','Все'],...categories].map(([key,label],index)=>`<button class="filter-btn${index===0?' is-active':''}" type="button" data-category="${e(key)}" aria-pressed="${index===0}">${e(label)}</button>`).join('');
const indexBody=`<main><section class="hero"><div class="container"><div class="eyebrow mono">QazTools · прямые загрузки</div><h1>Полезные программы <span>в один клик</span></h1><p>Выберите систему и скачайте последний файл из официального GitHub Release. Без регистрации, рекламных загрузчиков и переходов на чужие страницы.</p><div class="hero-stats"><div class="stat"><strong>${items.length}</strong><span>полезные программы</span></div><div class="stat"><strong>${categories.length}</strong><span>категорий</span></div><div class="stat"><strong>0</strong><span>изменённых файлов</span></div></div></div></section><section class="catalog-shell"><div class="container"><div class="trust-note"><strong>Как это работает:</strong> QazDev находит последний официальный релиз программы и запускает загрузку оригинального файла напрямую с GitHub. Мы не перепаковываем и не изменяем установщики.</div><div class="toolbar"><label class="search-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span hidden>Поиск программ</span><input id="catalogSearch" type="search" placeholder="Например: запись экрана, архиватор или AI" autocomplete="off"></label><div class="filters" aria-label="Категории">${categoryButtons}</div></div><div class="results-bar"><h2>Скачать программы</h2><span class="results-count" id="resultsCount">${items.length} программы</span></div><div class="cards" id="softwareCards">${cards}</div><div class="empty" id="emptyState"><strong>Ничего не найдено</strong><br>Попробуйте другой запрос или категорию.</div><section class="catalog-cta"><div><h2>Какой программы не хватает?</h2><p>Отправьте название или ссылку на GitHub — проверим релизы и добавим безопасную загрузку.</p></div><a class="primary-btn" href="https://wa.me/77000300024?text=${encodeURIComponent('Здравствуйте! Предлагаю добавить программу в QazTools: ')}">Предложить программу</a></section></div></section></main>`;
await writeFile(path.join(outputDir,'index.html'),layout({title:'Скачать бесплатные программы для Windows, macOS и Linux — QazTools',description:'Полезные бесплатные программы: прямое скачивание последних официальных GitHub Releases без регистрации и рекламных загрузчиков.',canonical:`${site}/programmy/`,body:indexBody}));

for(const item of items){
  const related=items.filter(candidate=>candidate.category===item.category&&candidate.slug!==item.slug).slice(0,3);
  const softwareSchema={"@context":"https://schema.org","@type":"SoftwareApplication",name:item.name,description:item.shortDescription,url:`${site}/programmy/${item.slug}.html`,image:logoUrl(item),applicationCategory:item.categoryLabel,operatingSystem:item.platforms.join(', '),isAccessibleForFree:true,offers:{"@type":"Offer",price:"0",priceCurrency:"KZT"},sameAs:`https://github.com/${item.github}`};
  const breadcrumbs={"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[{"@type":"ListItem",position:1,name:"Главная",item:`${site}/`},{"@type":"ListItem",position:2,name:"Скачать программы",item:`${site}/programmy/`},{"@type":"ListItem",position:3,name:item.name,item:`${site}/programmy/${item.slug}.html`} ]};
  const schema=`<script type="application/ld+json">${JSON.stringify([softwareSchema,breadcrumbs]).replace(/</g,'\\u003c')}</script>`;
  const body=`<main><section class="detail-hero"><div class="container"><div class="breadcrumbs"><a href="/">Главная</a> / <a href="/programmy/">Программы</a> / ${e(item.name)}</div><div class="detail-head"><div><div class="detail-title-row">${logo(item,true)}<div><div class="card-category">${e(item.categoryLabel)}</div><h1>Скачать ${e(item.name)}</h1></div></div><p class="detail-subtitle">${e(item.shortDescription)}</p></div><div class="detail-downloads">${downloadButtons(item)}</div></div></div></section><section class="detail-main"><div class="container detail-grid"><article class="content-panel"><h2>О программе</h2><p>${e(item.fullDescription)}</p><h2>Возможности</h2><ul class="bullet-list">${item.features.map(feature=>`<li>${e(feature)}</li>`).join('')}</ul><div class="trust-note compact"><strong>Безопасная загрузка:</strong> кнопка получает последний релиз через GitHub API и скачивает оригинальный файл автора. QazDev не хранит и не изменяет установщик.</div>${related.length?`<section class="related"><h2>Похожие программы</h2><div class="related-grid">${related.map(candidate=>`<a href="/programmy/${e(candidate.slug)}.html"><strong>${e(candidate.name)}</strong><br><span>${e(candidate.shortDescription)}</span></a>`).join('')}</div></section>`:''}<div class="updated">Проверено ${e(dateRu(item.verifiedAt))}</div></article><aside class="side-panel"><h2>Информация</h2><div class="info-list"><div class="info-item"><span>Категория</span><strong>${e(item.categoryLabel)}</strong></div><div class="info-item"><span>Системы</span><strong>${e(item.downloads.map(download=>download.label).join(', '))}</strong></div><div class="info-item"><span>Цена</span><strong>Бесплатно</strong></div><div class="info-item"><span>Источник</span><a href="https://github.com/${e(item.github)}" target="_blank" rel="noopener nofollow">Исходный код на GitHub ↗</a></div></div></aside></div></section></main>`;
  await writeFile(path.join(outputDir,`${item.slug}.html`),layout({title:`Скачать ${item.name} бесплатно — последняя версия | QazTools`,description:`${item.shortDescription} Прямая загрузка последнего официального GitHub Release для ${item.downloads.map(download=>download.label).join(', ')}.`,canonical:`${site}/programmy/${item.slug}.html`,body,schema}));
}

const urls=[`${site}/programmy/`,...items.map(item=>`${site}/programmy/${item.slug}.html`)];
const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url=>`  <url><loc>${url}</loc><lastmod>2026-07-20</lastmod><changefreq>weekly</changefreq></url>`).join('\n')}\n</urlset>\n`;
await writeFile(path.join(root,'sitemap-programmy.xml'),sitemap);
console.log(`Generated ${items.length+1} download pages and sitemap-programmy.xml`);
