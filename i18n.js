/*
 * FuturoFood languages: English at the root, Spanish under /es/ — each page
 * is already written in its language (scripts/build-i18n.mjs), so nothing is
 * translated or redirected here (automatic redirects confuse search engines).
 *
 *  - The EN/ES switch links to the same page in the other language, keeping
 *    the ?query and #section, and remembers the choice ("ff-lang-choice").
 *  - On an English page, readers whose browser is in Spanish (or who chose
 *    Spanish before) see a small "¿Prefieres leer en español?" bar with a link
 *    to /es/. Closing it (×) or choosing English hides it for good.
 */
(function () {
  var CHOICE = 'ff-lang-choice';
  var HINT_CLOSED = 'ff-lang-hint-closed';

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  function esUrl() {
    var es = document.querySelector('.lang-btn[data-lang="es"]');
    var path = es ? es.getAttribute('href') : '/es/';
    return path + location.search + location.hash;
  }

  function initSwitch() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest && e.target.closest('a.lang-btn');
      if (!link) return;
      set(CHOICE, link.getAttribute('data-lang'));
      if (link.classList.contains('active')) { e.preventDefault(); return; }
      link.href = link.getAttribute('href').split(/[?#]/)[0] + location.search + location.hash;
    });
  }

  function initHint() {
    if (document.documentElement.lang !== 'en' || get(HINT_CLOSED)) return;
    var choice = get(CHOICE);
    var spanish = choice ? choice === 'es' : /^es\b/i.test(navigator.language || '');
    if (!spanish) return;
    var style = document.createElement('style');
    style.textContent =
      '.lang-hint{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.25rem .75rem;padding:.5rem 2.75rem .5rem 1rem;position:relative;' +
      'background:#111A11;border-bottom:1px solid rgba(232,245,224,.1);font-family:"DM Sans",system-ui,sans-serif;font-size:.85rem;color:rgba(232,245,224,.8)}' +
      '.lang-hint a{color:#4ADE80;font-weight:600;text-decoration:none;white-space:nowrap}' +
      '.lang-hint a:hover{text-decoration:underline}' +
      '.lang-hint button{position:absolute;right:.4rem;top:50%;transform:translateY(-50%);width:2.25rem;height:2.25rem;background:none;border:none;cursor:pointer;color:rgba(232,245,224,.5);font-size:1.2rem;line-height:1}' +
      '.lang-hint button:hover{color:#E8F5E0}';
    document.head.appendChild(style);
    var bar = document.createElement('div');
    bar.className = 'lang-hint';
    bar.lang = 'es';
    bar.setAttribute('role', 'note');
    bar.innerHTML = '<span>¿Prefieres leer en español?</span><a href="' + esUrl() + '" hreflang="es" data-lang-hint>Leer en español →</a>' +
      '<button type="button" aria-label="Cerrar">×</button>';
    bar.querySelector('a').addEventListener('click', function () { set(CHOICE, 'es'); });
    bar.querySelector('button').addEventListener('click', function () { set(HINT_CLOSED, '1'); bar.remove(); });
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function init() { initSwitch(); initHint(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
