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
  var cards=Array.from(document.querySelectorAll('.software-card'));
  var count=document.getElementById('resultsCount');
  var empty=document.getElementById('emptyState');
  if(!search||!cards.length)return;
  var active='all';
  var params=new URLSearchParams(location.search);
  search.value=params.get('q')||'';
  if(params.get('category'))active=params.get('category');
  function normalize(value){return value.toLocaleLowerCase('ru').trim()}
  function plural(n,one,few,many){var n10=n%10,n100=n%100;return n10===1&&n100!==11?one:n10>=2&&n10<=4&&(n100<12||n100>14)?few:many}
  function apply(){
    var query=normalize(search.value),visible=0;
    cards.forEach(function(card){
      var show=(active==='all'||card.dataset.category===active)&&(!query||normalize(card.dataset.search).includes(query));
      card.hidden=!show;if(show)visible++;
    });
    buttons.forEach(function(button){
      var selected=button.dataset.category===active;
      button.classList.toggle('is-active',selected);button.setAttribute('aria-pressed',String(selected));
    });
    count.textContent=visible+' '+plural(visible,'программа','программы','программ');
    empty.style.display=visible?'none':'block';
    var next=new URLSearchParams();
    if(search.value.trim())next.set('q',search.value.trim());
    if(active!=='all')next.set('category',active);
    history.replaceState(null,'',location.pathname+(next.size?'?'+next:''));
  }
  buttons.forEach(function(button){button.addEventListener('click',function(){active=button.dataset.category;apply()})});
  search.addEventListener('input',apply);
  if(!buttons.some(function(button){return button.dataset.category===active}))active='all';
  apply();
})();
