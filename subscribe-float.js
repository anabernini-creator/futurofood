/*
 * FuturoFood floating subscribe banner (article pages).
 *
 * Slides in when the reader is halfway through the article, hides while the
 * end-of-article signup (#newsletter-cta) is on screen, and stays away for
 * 7 days once closed — or for good once the reader subscribes. Content is
 * never blocked: it is a small bar, not a wall.
 *
 * Load it BEFORE i18n.js and newsletter.js: it inserts its markup right away
 * so i18n translates it and newsletter.js wires its signup form.
 */
(function () {
  var DISMISS_KEY = 'ff-float-dismissed';
  var SUBSCRIBED_KEY = 'ff-subscribed';
  var WEEK = 7 * 24 * 60 * 60 * 1000;

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  var article = document.querySelector('.article-content');
  if (!article) return;
  if (get(SUBSCRIBED_KEY)) return;
  if (Number(get(DISMISS_KEY)) > Date.now() - WEEK) return;

  var bar = document.createElement('aside');
  bar.className = 'float-cta';
  bar.setAttribute('aria-label', 'Newsletter');
  bar.innerHTML =
    '<button type="button" class="float-cta-close" aria-label="Close" data-es-aria-label="Cerrar">×</button>' +
    '<div class="float-cta-text">' +
      '<strong data-es="¿Te está gustando FuturoFood?">Enjoying FuturoFood?</strong> ' +
      '<span data-es="Recibe las mejores historias cada semana — gratis">Get the best stories every week — free</span>' +
    '</div>' +
    '<div class="float-cta-form">' +
      '<input type="email" placeholder="your@email.com" data-es-placeholder="tu@correo.com" aria-label="Email address" data-es-aria-label="Correo electrónico"/>' +
      '<button type="button" class="float-cta-btn" data-es="Suscribirme">Subscribe</button>' +
    '</div>' +
    '<p class="float-cta-note" aria-live="polite"></p>';
  document.body.appendChild(bar);

  var closed = false;
  var endCtaVisible = false;

  function update() {
    if (closed) return;
    var rect = article.getBoundingClientRect();
    var halfway = rect.top + rect.height / 2 <= window.innerHeight;
    bar.classList.toggle('is-visible', halfway && !endCtaVisible);
  }

  function close(remember) {
    closed = true;
    bar.classList.remove('is-visible');
    if (remember) set(DISMISS_KEY, String(Date.now()));
  }

  bar.querySelector('.float-cta-close').addEventListener('click', function () { close(true); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && bar.classList.contains('is-visible')) close(true);
  });
  // newsletter.js announces a successful signup
  document.addEventListener('ff:subscribed', function () {
    set(SUBSCRIBED_KEY, '1');
    setTimeout(function () { close(false); }, 3500);
  });

  var endCta = document.getElementById('newsletter-cta');
  if (endCta && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      endCtaVisible = entries[0].isIntersecting;
      update();
    }).observe(endCta);
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
})();
