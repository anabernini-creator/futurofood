/*
 * FuturoFood cookie consent (GDPR / LGPD) for Google Analytics 4.
 *
 * Each page's <head> starts GA4 with analytics cookies OFF (Google Consent
 * Mode) and re-applies a stored choice (localStorage "ff-consent"). This script
 * asks /api/geo (Cloudflare's country for the request) whether the visitor is
 * in the EU/EEA, UK, Switzerland or Brazil:
 *   - no  → cookies on, no notice;
 *   - yes → a small notice, Accept / Decline, until they choose.
 * If /api/geo fails, cookies simply stay off.
 * Any [data-consent-open] button (privacy page) reopens it to change the choice.
 */
(function () {
  var KEY = 'ff-consent';

  function stored() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function save(granted) {
    try { localStorage.setItem(KEY, JSON.stringify({ analytics: granted, date: new Date().toISOString().slice(0, 10) })); } catch (e) {}
  }
  function deleteGaCookies() {
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^_ga/.test(name)) return;
      ['', '; domain=.futurofood.com', '; domain=futurofood.com'].forEach(function (domain) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + domain;
      });
    });
  }
  function apply(granted) {
    if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
    if (!granted) deleteGaCookies();
  }

  // The notice can appear after i18n.js has run, so translate it here too
  // (keeping the English in data-en, as i18n.js expects).
  function localize(root) {
    var es = document.documentElement.lang === 'es';
    root.querySelectorAll('[data-es]').forEach(function (el) {
      el.dataset.en = el.innerHTML;
      if (es) el.innerHTML = el.dataset.es;
    });
  }

  var bar = null;
  function build() {
    bar = document.createElement('div');
    bar.className = 'consent-banner';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Cookies');
    bar.innerHTML =
      '<p class="consent-text" data-es="Usamos cookies de Google Analytics para saber qué historias se leen más. ¿Nos lo permites? <a href=&quot;futurofood-privacy.html#cookies&quot;>Privacidad</a>">' +
        'We use Google Analytics cookies to learn which stories people read most. Is that OK? <a href="futurofood-privacy.html#cookies">Privacy</a></p>' +
      '<div class="consent-actions">' +
        '<button type="button" class="consent-btn consent-decline" data-es="Rechazar">Decline</button>' +
        '<button type="button" class="consent-btn consent-accept" data-es="Aceptar">Accept</button>' +
      '</div>';
    localize(bar);
    bar.querySelector('.consent-accept').addEventListener('click', function () { save(true); apply(true); hide(); });
    bar.querySelector('.consent-decline').addEventListener('click', function () { save(false); apply(false); hide(); });
    document.body.appendChild(bar);
  }
  function show() {
    if (!bar) build();
    bar.classList.add('is-visible');
    document.documentElement.classList.add('consent-open');
  }
  function hide() {
    bar.classList.remove('is-visible');
    document.documentElement.classList.remove('consent-open');
    document.dispatchEvent(new CustomEvent('ff:consent-closed'));
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-consent-open]')) show();
  });

  if (stored()) return;
  var cached = null;
  try { cached = sessionStorage.getItem('ff-consent-required'); } catch (e) {}
  if (cached !== null) {
    if (cached === '1') show();
    return; // '0' was already granted in <head>
  }
  fetch('/api/geo', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      try { sessionStorage.setItem('ff-consent-required', d.consent_required ? '1' : '0'); } catch (e) {}
      if (d.consent_required) show();
      else apply(true);
    })
    .catch(function () { /* cookies stay off: the <head> default is "denied" */ });
})();
