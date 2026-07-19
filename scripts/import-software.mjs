import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=Object.fromEntries(process.argv.slice(2).map(part=>{const [key,...value]=part.replace(/^--/,'').split('=');return[key,value.join('=')||true]}));
const source=args.source||'apple';
const query=args.query||'business';
const limit=Math.min(Number(args.limit)||20,50);
let drafts=[];

if(source==='apple'){
  const url=new URL('https://itunes.apple.com/search');
  url.search=new URLSearchParams({term:query,country:'kz',entity:'software',limit:String(limit)});
  const response=await fetch(url,{headers:{'user-agent':'QazDevCatalog/1.0'}});
  if(!response.ok)throw new Error(`Apple Search API: ${response.status}`);
  const payload=await response.json();
  drafts=payload.results.map(item=>({source:'apple',sourceId:String(item.trackId),name:item.trackName,shortDescription:item.description?.slice(0,280)||'',website:item.trackViewUrl,developer:item.sellerName,categoryLabel:item.primaryGenreName,pricing:item.formattedPrice,platforms:['iOS'],iconUrl:item.artworkUrl512||item.artworkUrl100,sourcePayload:item}));
}else if(source==='producthunt'){
  const token=process.env.PRODUCT_HUNT_TOKEN;
  if(!token)throw new Error('Set PRODUCT_HUNT_TOKEN before importing Product Hunt');
  const gql=`query CatalogDrafts($first: Int!) { posts(first: $first, order: NEWEST) { edges { node { id name tagline description website url } } } }`;
  const response=await fetch('https://api.producthunt.com/v2/api/graphql',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:gql,variables:{first:limit}})});
  if(!response.ok)throw new Error(`Product Hunt API: ${response.status}`);
  const payload=await response.json();
  if(payload.errors)throw new Error(JSON.stringify(payload.errors));
  drafts=payload.data.posts.edges.map(({node})=>({source:'producthunt',sourceId:node.id,name:node.name,shortDescription:node.tagline,fullDescription:node.description,website:node.website||node.url,sourcePayload:node}));
}else{
  throw new Error('Supported sources: apple, producthunt');
}

const target=path.join(root,'data','software.drafts.json');
let existing=[];
try{existing=JSON.parse(await readFile(target,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
const merged=new Map(existing.map(item=>[`${item.source}:${item.sourceId}`,item]));
for(const item of drafts)merged.set(`${item.source}:${item.sourceId}`,item);
await writeFile(target,JSON.stringify([...merged.values()],null,2)+'\n');
console.log(`Imported ${drafts.length} drafts from ${source}. Review ${target} before publishing.`);
