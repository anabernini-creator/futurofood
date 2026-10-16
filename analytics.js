/*
 * FuturoFood — extra Google Analytics 4 events for the share-to-subscribe
 * funnel. GA4 itself (gtag.js, G-DB7ETK6YM5) is loaded async in each page's
 * <head> and already measures engagement time, views per session, traffic
 * source / medium (including the utm_* tags on shared links) and bounce rate.
 *
 *   share   { method: whatsapp | x | linkedin | copy | share_sheet,
 *             content_type: article | card }               — share buttons, the
 *             phone's share sheet, and blog/home card share menus
 *   sign_up { method: newsletter, placement: inline | exit_intent | mobile_bar }
 *   popup_view / popup_close { popup: exit_intent }       — capture.js popup
 *   join_whatsapp_channel { placement: footer | article_end | sponsors }
 *   story_tip_click { placement: article_end | archive } — "Send us a story"
 *                                                         — WhatsApp Channel button
 */
(function () {
  function track(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-share]');
    if (!el) return;
    var menu = el.closest('.share-menu');
    track('share', { method: el.getAttribute('data-share'), content_type: (menu && menu.dataset.shareContext) || 'article' });
  });
  // WhatsApp Channel button (wa-channel.css). It opens in a new tab, so the
  // beacon transport is only a safeguard.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-wa-channel]');
    if (!el) return;
    track('join_whatsapp_channel', { placement: el.getAttribute('data-wa-channel'), link_url: el.href, transport_type: 'beacon' });
  });
  // "Send us a story" (reader tips by email)
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-story-tip]');
    if (!el) return;
    track('story_tip_click', { placement: el.getAttribute('data-story-tip'), transport_type: 'beacon' });
  });
  // Shares through the phone's native share sheet (share.js)
  document.addEventListener('ff:share', function (e) {
    track('share', { method: e.detail.method, content_type: e.detail.content_type });
  });
  document.addEventListener('ff:subscribed', function (e) {
    track('sign_up', { method: 'newsletter', placement: (e.detail && e.detail.placement) || 'inline' });
  });
  document.addEventListener('ff:popup', function (e) {
    var d = e.detail || {};
    track(d.action === 'view' ? 'popup_view' : 'popup_close', { popup: d.popup, close_via: d.via });
  });
})();
