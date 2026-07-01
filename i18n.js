(function(){
  var STORAGE_KEY = 'ff-lang';
  var ATTRS = ['placeholder','aria-label','title'];

  function getSaved(){
    try{ return localStorage.getItem(STORAGE_KEY); }catch(e){ return null; }
  }
  function setSaved(lang){
    try{ localStorage.setItem(STORAGE_KEY, lang); }catch(e){}
  }

  function applyLang(lang){
    document.documentElement.setAttribute('lang', lang);

    document.querySelectorAll('[data-es]').forEach(function(el){
      if(el.dataset.en === undefined) el.dataset.en = el.innerHTML;
      el.innerHTML = lang === 'es' ? el.dataset.es : el.dataset.en;
    });

    ATTRS.forEach(function(attr){
      var cacheAttr = 'data-en-' + attr;
      var esAttr = 'data-es-' + attr;
      document.querySelectorAll('[' + esAttr + ']').forEach(function(el){
        if(!el.hasAttribute(cacheAttr)){
          el.setAttribute(cacheAttr, el.getAttribute(attr) || '');
        }
        var val = lang === 'es' ? el.getAttribute(esAttr) : el.getAttribute(cacheAttr);
        if(val !== null) el.setAttribute(attr, val);
      });
    });

    document.querySelectorAll('.lang-btn').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });

    setSaved(lang);
  }

  function init(){
    applyLang(getSaved() || 'en');
    document.addEventListener('click', function(e){
      var btn = e.target.closest('.lang-btn');
      if(!btn) return;
      applyLang(btn.getAttribute('data-lang'));
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
