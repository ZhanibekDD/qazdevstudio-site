(function(){
  var releaseCache=new Map();
  var toastTimer;

  function toast(message,isError){
    var element=document.getElementById('downloadToast');
    if(!element)return;
    element.textContent=message;
    element.classList.toggle('is-error',Boolean(isError));
    element.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){element.classList.remove('is-visible')},6500);
  }

  async function getLatestRelease(repo){
    if(releaseCache.has(repo))return releaseCache.get(repo);
    var request=fetch('https://api.github.com/repos/'+repo+'/releases/latest',{
      headers:{Accept:'application/vnd.github+json'}
    }).then(async function(response){
      if(!response.ok){
        if(response.status===403)throw new Error('Лимит GitHub временно исчерпан. Попробуйте через несколько минут.');
        throw new Error('GitHub не вернул последний релиз.');
      }
      return response.json();
    });
    releaseCache.set(repo,request);
    return request;
  }

  async function download(button){
    var original=button.innerHTML;
    button.disabled=true;
    button.textContent='Ищу последний файл…';
    button.classList.remove('is-error');
    try{
      var release=await getLatestRelease(button.dataset.repo);
      var matcher=new RegExp(button.dataset.pattern,'i');
      var asset=(release.assets||[]).find(function(item){return matcher.test(item.name)});
      if(!asset)throw new Error('Подходящий файл не найден в последнем релизе. Мы уже можем исправить правило загрузки.');
      toast('Загрузка '+asset.name+' · версия '+release.tag_name);
      var link=document.createElement('a');
      link.href=asset.browser_download_url;
      link.rel='noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }catch(error){
      button.classList.add('is-error');
      toast(error.message||'Не удалось начать загрузку.',true);
    }finally{
      button.disabled=false;
      button.innerHTML=original;
    }
  }

  document.addEventListener('click',function(event){
    var button=event.target.closest('.download-btn');
    if(!button)return;
    if(button.dataset.repo){event.preventDefault();download(button);return}
    if(button.dataset.direct)toast('Загрузка оригинального файла '+(button.dataset.file||''));
  });

  var search=document.getElementById('catalogSearch');
  var buttons=Array.from(document.querySelectorAll('.filter-btn'));
  var cards=document.getElementById('softwareCards');
  var count=document.getElementById('resultsCount');
  var empty=document.getElementById('emptyState');
  var loadMore=document.getElementById('loadMore');
  if(!search||!cards||!count||!empty)return;

  var params=new URLSearchParams(location.search);
  var active=params.get('category')||'all';
  var allItems=null;
  var filtered=[];
  var visible=60;
  var timer;
  search.value=params.get('q')||'';

  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]});
  }
  function normalize(value){return String(value||'').toLocaleLowerCase('ru').trim()}
  function initials(name){return name.split(/\s+/).map(function(word){return word[0]}).join('').slice(0,2).toUpperCase()}
  function plural(n,one,few,many){var n10=n%10,n100=n%100;return n10===1&&n100!==11?one:n10>=2&&n10<=4&&(n100<12||n100>14)?few:many}
  function sourceBadge(item){return item.source==='flathub'?'✓ Проверено Flathub':item.downloads.some(function(download){return download.url})?'✓ SHA-256 из WinGet':'✓ GitHub Release'}
  function fileName(url){try{return decodeURIComponent(new URL(url).pathname.split('/').pop())}catch(_){return 'официального файла'}}
  function downloadButtons(item){
    var icons={windows:'⊞',macos:'◆',linux:'◉'};
    return item.downloads.map(function(download){
      if(download.url)return '<a class="download-btn" href="'+escapeHtml(download.url)+'" data-direct="true" data-file="'+escapeHtml(fileName(download.url))+'" rel="noopener nofollow"><span aria-hidden="true">'+icons[download.os]+'</span> Скачать · '+escapeHtml(download.label)+'</a>';
      return '<button class="download-btn" type="button" data-repo="'+escapeHtml(item.github)+'" data-pattern="'+escapeHtml(download.pattern)+'" data-os="'+escapeHtml(download.os)+'"><span aria-hidden="true">'+icons[download.os]+'</span> Скачать · '+escapeHtml(download.label)+'</button>';
    }).join('');
  }
  function card(item){
    var searchText=[item.name,item.categoryLabel,item.shortDescription].concat(item.features||[]).join(' ');
    return '<article class="software-card" data-category="'+escapeHtml(item.category)+'" data-search="'+escapeHtml(searchText)+'"><div class="card-top"><div class="software-logo"><span aria-hidden="true">'+escapeHtml(initials(item.name))+'</span><img src="'+escapeHtml(item.icon)+'" alt="Логотип '+escapeHtml(item.name)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"></div><div><a class="card-title" href="/programmy/'+escapeHtml(item.slug)+'.html">'+escapeHtml(item.name)+'</a><a class="card-category" href="/programmy/kategorii/'+escapeHtml(item.category)+'.html">'+escapeHtml(item.categoryLabel)+'</a></div></div><p class="card-desc">'+escapeHtml(item.shortDescription)+'</p><div class="tags">'+(item.features||[]).slice(0,3).map(function(feature){return '<span class="tag">'+escapeHtml(feature)+'</span>'}).join('')+'</div><div class="download-actions">'+downloadButtons(item)+'</div><div class="card-bottom"><span class="source-badge">'+escapeHtml(sourceBadge(item))+'</span><a class="details" href="/programmy/'+escapeHtml(item.slug)+'.html">Подробнее →</a></div></article>';
  }

  async function loadData(){
    if(allItems)return allItems;
    var response=await fetch('/programmy/catalog-data.json',{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('Каталог временно не загрузился');
    allItems=await response.json();
    return allItems;
  }

  function updateUrl(){
    var next=new URLSearchParams();
    if(search.value.trim())next.set('q',search.value.trim());
    if(active!=='all')next.set('category',active);
    history.replaceState(null,'',location.pathname+(next.size?'?'+next:''));
  }

  function render(){
    cards.innerHTML=filtered.slice(0,visible).map(card).join('');
    count.textContent=filtered.length+' '+plural(filtered.length,'программа','программы','программ');
    empty.style.display=filtered.length?'none':'block';
    if(loadMore){
      loadMore.hidden=visible>=filtered.length;
      loadMore.textContent='Показать ещё · '+Math.min(60,Math.max(0,filtered.length-visible));
    }
  }

  async function apply(reset){
    try{
      var items=await loadData();
      if(reset)visible=60;
      var query=normalize(search.value);
      filtered=items.filter(function(item){
        var haystack=normalize([item.name,item.categoryLabel,item.shortDescription].concat(item.features||[]).join(' '));
        return (active==='all'||item.category===active)&&(!query||haystack.includes(query));
      });
      buttons.forEach(function(button){
        var selected=button.dataset.category===active;
        button.classList.toggle('is-active',selected);
        button.setAttribute('aria-pressed',String(selected));
      });
      updateUrl();
      render();
    }catch(error){toast(error.message||'Не удалось загрузить каталог.',true)}
  }

  buttons.forEach(function(button){button.addEventListener('click',function(){active=button.dataset.category;apply(true)})});
  search.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(function(){apply(true)},120)});
  if(loadMore)loadMore.addEventListener('click',function(){visible+=60;render()});
  if(!buttons.some(function(button){return button.dataset.category===active}))active='all';
  apply(true);
})();
