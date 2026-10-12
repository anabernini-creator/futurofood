/*
 * FuturoFood — Google Analytics 4, loaded late so it never slows the page.
 *
 * Inactive while GA_MEASUREMENT_ID is empty: no request to Google, no cookies.
 * To activate, paste the GA4 measurement ID (G-XXXXXXXXXX) below — and update
 * futurofood-privacy.html, which currently says analytics are cookieless.
 *
 * GA4 measures engagement time (time on page), views per session (pages per
 * visit), session source / medium (traffic source — including the utm_* tags
 * on shared links) and bounce rate out of the box. On top of that this sends:
 *   share   { method: whatsapp | x | linkedin | copy }   — share buttons
 *   sign_up { method: newsletter }                        — successful signup
 */
(function () {
  var GA_MEASUREMENT_ID = '';
  if (!GA_MEASUREMENT_ID) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);

  // Events can be queued before gtag.js arrives; dataLayer replays them.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-share]');
    if (el) gtag('event', 'share', { method: el.getAttribute('data-share'), content_type: 'article' });
  });
  document.addEventListener('ff:subscribed', function () {
    gtag('event', 'sign_up', { method: 'newsletter' });
  });

  function load() {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
  }
  // After the page has loaded and the browser is idle (max 2 s wait)
  function whenIdle() {
    if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 2000 });
    else setTimeout(load, 1);
  }
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle);
})();
