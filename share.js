/*
 * FuturoFood sharing — article pages, the blog and the home page.
 *
 *   [data-share="whatsapp|x|linkedin|copy"]  links/buttons for the current article
 *   [data-share-native]                      "Share" button: the phone's share sheet
 *                                            (navigator.share), or our menu if the
 *                                            browser has none
 *   .card-share-btn (inside .article-card)   share that card's story, without
 *                                            opening it
 *   .share-dock                              phone bar fixed at the bottom while
 *                                            reading: WhatsApp, Share, Subscribe
 *                                            (capture.js) and × (closed for the
 *                                            rest of the visit)
 *
 * Every shared URL carries utm_source=<channel>&utm_medium=share and
 * utm_campaign=article (article page) or card (blog/home cards), so signups
 * are attributed in Beehiiv. Link clicks are tracked by analytics.js through
 * [data-share]; native-sheet shares are announced with the "ff:share" event.
 */
(function () {
  var SITE = location.origin;
  var isEs = function () { return document.documentElement.lang === 'es'; };

  function htmlToText(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent.replace(/\s+/g, ' ').trim();
  }
  // Text of an element in a language: Spanish from data-es, English from
  // data-en (kept by i18n.js after switching) or the visible text.
  function textIn(el, lang) {
    if (!el) return '';
    var es = el.getAttribute('data-es');
    var en = el.getAttribute('data-en');
    if (lang === 'es' && es) return htmlToText(es);
    return en !== null ? htmlToText(en) : el.textContent.replace(/\s+/g, ' ').trim();
  }

  function withUtm(url, source, campaign) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') +
      'utm_source=' + source + '&utm_medium=share&utm_campaign=' + campaign;
  }

  // t = { url, titleEs, titleShown, campaign }
  function links(t) {
    var enc = encodeURIComponent;
    return {
      whatsapp: 'https://wa.me/?text=' + enc('Mira este artículo de FuturoFood: ' + t.titleEs + ' ' + withUtm(t.url, 'whatsapp', t.campaign)),
      x: 'https://twitter.com/intent/tweet?text=' + enc(t.titleShown) + '&url=' + enc(withUtm(t.url, 'x', t.campaign)),
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(withUtm(t.url, 'linkedin', t.campaign)),
      copy: withUtm(t.url, 'copy_link', t.campaign),
    };
  }

  function articleTarget() {
    var h1 = document.querySelector('h1.article-title');
    return {
      url: SITE + location.pathname,
      titleEs: h1 ? textIn(h1, 'es') : document.title,
      titleShown: h1 ? textIn(h1, document.documentElement.lang) : document.title,
      campaign: 'article',
    };
  }

  function cardTarget(card) {
    var link = card.querySelector('.card-link, a[href]') || (card.matches('a[href]') ? card : null);
    var titleEl = card.querySelector('.card-title [data-es], .article-title [data-es]') || card.querySelector('.card-title, .article-title');
    var href = link ? link.getAttribute('href') : '';
    var titleEn = textIn(titleEl, 'en');
    var url;
    if (/futurofood-article/.test(href)) {
      url = SITE + '/' + href.replace(/^\//, '').replace(/\.html$/, '');
    } else {
      // Brief stories have no page of their own: share the blog filtered to them
      url = SITE + '/futurofood-blog?q=' + encodeURIComponent(titleEn.split(/\s+/).slice(0, 4).join(' '));
    }
    return { url: url, titleEs: textIn(titleEl, 'es'), titleShown: textIn(titleEl, document.documentElement.lang), campaign: 'card' };
  }

  function announce(method, campaign) {
    document.dispatchEvent(new CustomEvent('ff:share', { detail: { method: method, content_type: campaign } }));
  }

  // ── Copy ──
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
  function copy(url, btn) {
    var done = function () {
      var original = btn.innerHTML;
      btn.textContent = isEs() ? '✓ Enlace copiado' : '✓ Link copied';
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

  // ── Menu (desktop, or phones without a native share sheet) ──
  var menu = null;
  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('click', outside, true);
    document.removeEventListener('keydown', onKey);
  }
  function outside(e) { if (menu && !menu.contains(e.target)) closeMenu(); }
  function onKey(e) { if (e.key === 'Escape') closeMenu(); }

  function openMenu(anchor, t) {
    closeMenu();
    var l = links(t);
    var es = isEs();
    menu = document.createElement('div');
    menu.className = 'share-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
      '<span class="share-menu-title">' + (es ? 'Compartir' : 'Share') + '</span>' +
      '<a role="menuitem" class="share-menu-item share-menu-wa" data-share="whatsapp" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a role="menuitem" class="share-menu-item" data-share="x" target="_blank" rel="noopener">X</a>' +
      '<a role="menuitem" class="share-menu-item" data-share="linkedin" target="_blank" rel="noopener">LinkedIn</a>' +
      '<button role="menuitem" type="button" class="share-menu-item" data-share="copy">' + (es ? '⎘ Copiar enlace' : '⎘ Copy link') + '</button>';
    menu.dataset.shareContext = t.campaign;
    menu.querySelector('[data-share="whatsapp"]').href = l.whatsapp;
    menu.querySelector('[data-share="x"]').href = l.x;
    menu.querySelector('[data-share="linkedin"]').href = l.linkedin;
    menu.querySelector('[data-share="copy"]').addEventListener('click', function (e) { copy(l.copy, e.currentTarget); });
    menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setTimeout(closeMenu, 0); }); });
    document.body.appendChild(menu);

    if (window.innerWidth > 640) {
      // Pop over below the button, kept on screen
      var r = anchor.getBoundingClientRect();
      var w = menu.offsetWidth;
      var left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      var top = r.bottom + 6;
      if (top + menu.offsetHeight > window.innerHeight - 8) top = r.top - menu.offsetHeight - 6;
      menu.style.left = (left + window.scrollX) + 'px';
      menu.style.top = (top + window.scrollY) + 'px';
    } else {
      menu.classList.add('is-sheet'); // bottom sheet on phones
    }
    setTimeout(function () {
      document.addEventListener('click', outside, true);
      document.addEventListener('keydown', onKey);
      menu && menu.querySelector('.share-menu-item').focus();
    }, 0);
  }

  // Phone share sheet first (WhatsApp, Telegram, Messages…), our menu otherwise
  function share(anchor, t) {
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      navigator.share({
        title: t.titleShown,
        text: 'Mira este artículo de FuturoFood: ' + t.titleEs,
        url: withUtm(t.url, 'share_sheet', t.campaign),
      }).then(function () { announce('share_sheet', t.campaign); }).catch(function () {});
    } else {
      openMenu(anchor, t);
    }
  }

  // ── Phone bar: visible while reading, between the top buttons and the end ones ──
  function initDock() {
    var dock = document.querySelector('.share-dock');
    var article = document.querySelector('.article-content');
    if (!dock || !article) return;
    var CLOSED = 'ff-dock-closed';
    var closed = false;
    try { closed = !!sessionStorage.getItem(CLOSED); } catch (e) {}
    if (closed) { dock.remove(); return; }
    var closeBtn = dock.querySelector('[data-dock-close]');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      try { sessionStorage.setItem(CLOSED, '1'); } catch (e) {}
      dock.classList.remove('is-visible');
      setTimeout(function () { dock.remove(); }, 300);
    });
    var top = document.querySelector('.share-top');
    var end = document.querySelector('.share-inline');
    var endVisible = false;
    if (end && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { endVisible = entries[0].isIntersecting; update(); }).observe(end);
    }
    function update() {
      var pastTop = top ? top.getBoundingClientRect().bottom < 0 : window.scrollY > 300;
      var blocked = document.documentElement.classList.contains('consent-open');
      // stays up while someone is typing their email in it (capture.js)
      var show = (pastTop && !endVisible && !blocked) || dock.classList.contains('is-expanded');
      dock.classList.toggle('is-visible', show);
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    document.addEventListener('ff:consent-closed', update);
    update();
  }

  function init() {
    var t = articleTarget();
    // Static article buttons
    document.querySelectorAll('[data-share]').forEach(function (el) {
      var channel = el.getAttribute('data-share');
      if (channel === 'copy') {
        el.addEventListener('click', function () { copy(links(articleTarget()).copy, el); });
      } else if (links(t)[channel]) {
        el.href = links(t)[channel];
        el.target = '_blank';
        el.rel = 'noopener';
        // Refresh on click so X uses the title in the language currently shown
        el.addEventListener('click', function () { el.href = links(articleTarget())[channel]; });
      }
    });
    document.querySelectorAll('[data-share-native]').forEach(function (btn) {
      btn.addEventListener('click', function () { share(btn, articleTarget()); });
    });
    // Card share buttons (blog and home); the card's own link must not open
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.card-share-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var card = btn.closest('.article-card');
      if (card) share(btn, cardTarget(card));
    }, true);
    initDock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
