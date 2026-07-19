import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=Object.fromEntries(process.argv.slice(2).map(part=>{const [key,...value]=part.replace(/^--/,'').split('=');return[key,value.join('=')||true]}));
const repository=String(args.repo||'');
if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw new Error('Usage: node scripts/import-software.mjs --repo=owner/repository');

const headers={Accept:'application/vnd.github+json','User-Agent':'QazDevCatalog/1.0'};
const [repoResponse,releaseResponse]=await Promise.all([
  fetch(`https://api.github.com/repos/${repository}`,{headers}),
  fetch(`https://api.github.com/repos/${repository}/releases/latest`,{headers})
]);
if(!repoResponse.ok)throw new Error(`GitHub repository API: ${repoResponse.status}`);
if(!releaseResponse.ok)throw new Error(`GitHub release API: ${releaseResponse.status}`);
const repo=await repoResponse.json();
const release=await releaseResponse.json();
const downloadable=(release.assets||[]).filter(asset=>/\.(exe|msi|dmg|appimage|deb|zip)$/i.test(asset.name)||/^(install\.sh|yt-dlp_macos|yt-dlp_linux)$/i.test(asset.name));
if(!downloadable.length)throw new Error('The latest release has no recognizable downloadable files');

const draft={
  slug:repo.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),
  name:repo.name,
  github:repository,
  website:repo.homepage||repo.html_url,
  shortDescription:repo.description||'',
  fullDescription:'',
  category:'',
  categoryLabel:'',
  platforms:[],
  features:repo.topics||[],
  downloads:[],
  latestRelease:{tag:release.tag_name,publishedAt:release.published_at,assets:downloadable.map(asset=>({name:asset.name,size:asset.size,digest:asset.digest||null,url:asset.browser_download_url}))},
  verifiedAt:new Date().toISOString().slice(0,10)
};

const target=path.join(root,'data','software.drafts.json');
let existing=[];
try{existing=JSON.parse(await readFile(target,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
const byRepo=new Map(existing.map(item=>[item.github,item]));
byRepo.set(repository,draft);
await writeFile(target,JSON.stringify([...byRepo.values()],null,2)+'\n');
console.log(`Imported ${repository} ${release.tag_name} with ${downloadable.length} downloadable assets. Review patterns in ${target}.`);
