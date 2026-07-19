(function(){
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
  function apply(){
    var query=normalize(search.value);
    var visible=0;
    cards.forEach(function(card){
      var matchesCategory=active==='all'||card.dataset.category===active;
      var matchesQuery=!query||normalize(card.dataset.search).includes(query);
      var show=matchesCategory&&matchesQuery;
      card.hidden=!show;
      if(show)visible++;
    });
    buttons.forEach(function(btn){
      var selected=btn.dataset.category===active;
      btn.classList.toggle('is-active',selected);
      btn.setAttribute('aria-pressed',String(selected));
    });
    count.textContent=visible+' '+plural(visible,'программа','программы','программ');
    empty.style.display=visible?'none':'block';
    var next=new URLSearchParams();
    if(search.value.trim())next.set('q',search.value.trim());
    if(active!=='all')next.set('category',active);
    history.replaceState(null,'',location.pathname+(next.size?'?'+next:''));
  }
  function plural(n,one,few,many){var n10=n%10,n100=n%100;return n10===1&&n100!==11?one:n10>=2&&n10<=4&&(n100<12||n100>14)?few:many}
  buttons.forEach(function(btn){btn.addEventListener('click',function(){active=btn.dataset.category;apply()})});
  search.addEventListener('input',apply);
  if(!buttons.some(function(btn){return btn.dataset.category===active}))active='all';
  apply();
})();
