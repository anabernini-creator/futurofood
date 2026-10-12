/*
 * FuturoFood — extra Google Analytics 4 events for the share-to-subscribe
 * funnel. GA4 itself (gtag.js, G-DB7ETK6YM5) is loaded async in each page's
 * <head> and already measures engagement time, views per session, traffic
 * source / medium (including the utm_* tags on shared links) and bounce rate.
 *
 *   share   { method: whatsapp | x | linkedin | copy }   — share buttons
 *   sign_up { method: newsletter }                        — successful signup
 */
(function () {
  function track(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-share]');
    if (el) track('share', { method: el.getAttribute('data-share'), content_type: 'article' });
  });
  document.addEventListener('ff:subscribed', function () {
    track('sign_up', { method: 'newsletter' });
  });
})();
