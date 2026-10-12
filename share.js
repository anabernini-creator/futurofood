/*
 * FuturoFood share buttons (article pages).
 *
 * Fills every [data-share] link with a share URL for the current article:
 *   whatsapp · x · linkedin  → <a data-share="…">
 *   copy                     → <button data-share="copy">
 * Shared links carry utm_source=<channel>&utm_medium=share so a reader who
 * arrives from a share and subscribes is attributed in Beehiiv
 * (newsletter.js forwards the UTM tags with the signup).
 */
(function () {
  function articleUrl(source) {
    var base = location.origin + location.pathname;
    return base + '?utm_source=' + source + '&utm_medium=share&utm_campaign=article';
  }

  function htmlToText(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent.trim();
  }

  // Title in the requested language: the Spanish one for WhatsApp (LATAM
  // audience), the one currently shown for X. i18n.js keeps the English
  // original in data-en once the page has been switched to Spanish.
  function title(lang) {
    var h1 = document.querySelector('h1.article-title');
    if (!h1) return document.title;
    var es = h1.getAttribute('data-es');
    var en = h1.getAttribute('data-en');
    if (lang === 'es' && es) return htmlToText(es);
    return en !== null ? htmlToText(en) : h1.textContent.trim();
  }

  var builders = {
    whatsapp: function () {
      return 'https://wa.me/?text=' + encodeURIComponent('Mira este artículo de FuturoFood: ' + title('es') + ' ' + articleUrl('whatsapp'));
    },
    x: function () {
      return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(title(document.documentElement.lang)) +
        '&url=' + encodeURIComponent(articleUrl('x'));
    },
    linkedin: function () {
      return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(articleUrl('linkedin'));
    },
  };

  function copy(btn) {
    var url = articleUrl('copy_link');
    var done = function () {
      var es = document.documentElement.lang === 'es';
      var original = btn.innerHTML;
      btn.textContent = es ? '✓ Enlace copiado' : '✓ Link copied';
      btn.classList.add('is-copied');
      setTimeout(function () { btn.innerHTML = original; btn.classList.remove('is-copied'); }, 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
    } else {
      fallbackCopy(url);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  function init() {
    document.querySelectorAll('[data-share]').forEach(function (el) {
      var channel = el.getAttribute('data-share');
      if (channel === 'copy') {
        el.addEventListener('click', function () { copy(el); });
      } else if (builders[channel]) {
        el.href = builders[channel]();
        el.target = '_blank';
        el.rel = 'noopener';
        // Refresh on click so X uses the title in the language currently shown
        el.addEventListener('click', function () { el.href = builders[channel](); });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
