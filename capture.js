/*
 * FuturoFood subscriber capture, without crowding the reader.
 *
 * Desktop (mouse, wide screen): an exit-intent popup — only when the pointer
 * leaves through the top of the window, never in the first 15 seconds, at
 * most once per visit. Closes with ×, Esc or a click outside.
 * Phones: no popup. The bottom bar on article pages (.share-dock, shown by
 * share.js) carries a "Subscribe" button that opens an email field in place.
 * Readers who already subscribed (localStorage "ff-subscribed", also set by
 * newsletter.js) see no subscription prompts at all.
 *
 * Signups go to /api/subscribe (Beehiiv), with the landing UTM tags.
 * GA4 (analytics.js): "popup_view" / "popup_close" through the "ff:popup"
 * event, and "sign_up" with placement exit_intent | mobile_bar through
 * "ff:subscribed".
 */
(function () {
  var SUBSCRIBED = 'ff-subscribed';
  var EXIT_SHOWN = 'ff-exit-shown';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var loadedAt = Date.now();

  function get(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
  function set(store, key, value) { try { window[store].setItem(key, value); } catch (e) {} }
  function es() { return document.documentElement.lang === 'es'; }
  function subscribed() { return !!get('localStorage', SUBSCRIBED); }

  var T = {
    pitch: { en: 'The LATAM food-tech stories that matter this week. Free, every week, in your inbox.',
             es: 'Las historias de food-tech de LATAM que importan esta semana. Gratis, cada semana, en tu correo.' },
    cta: { en: 'Subscribe free', es: 'Suscribirme gratis' },
    note: { en: 'No spam · Unsubscribe anytime', es: 'Sin spam · Cancela cuando quieras' },
    close: { en: 'Close', es: 'Cerrar' },
    email: { en: 'Email address', es: 'Correo electrónico' },
    placeholder: { en: 'your@email.com', es: 'tu@correo.com' },
    sending: { en: 'Subscribing…', es: 'Suscribiendo…' },
    ok: { en: "✓ You're subscribed! Check your inbox.", es: '✓ ¡Listo! Revisa tu correo.' },
    invalid: { en: 'Please enter a valid email.', es: 'Ingresa un correo válido.' },
    error: { en: 'Something went wrong. Try again.', es: 'Algo salió mal. Intenta de nuevo.' },
  };
  function t(key) { return T[key][es() ? 'es' : 'en']; }

  function landingUtm() {
    try { return JSON.parse(get('sessionStorage', 'ff-utm') || '{}'); } catch (e) { return {}; }
  }

  // Shared signup: same endpoint and attribution as newsletter.js
  function subscribe(email, placement, note, button, onDone) {
    if (!EMAIL_RE.test(email)) { note.textContent = t('invalid'); note.className = 'cap-note is-error'; return; }
    var utm = landingUtm();
    button.disabled = true;
    note.textContent = t('sending'); note.className = 'cap-note';
    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email, utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign, page: location.pathname }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          set('localStorage', SUBSCRIBED, '1');
          document.dispatchEvent(new CustomEvent('ff:subscribed', { detail: { placement: placement } }));
          note.textContent = t('ok'); note.className = 'cap-note is-ok';
          onDone && onDone();
        } else {
          note.textContent = t(d.error === 'invalid_email' ? 'invalid' : 'error'); note.className = 'cap-note is-error';
          button.disabled = false;
        }
      })
      .catch(function () { note.textContent = t('error'); note.className = 'cap-note is-error'; button.disabled = false; });
  }

  // ── Desktop exit-intent popup ──
  var overlay = null;
  function closePopup(how) {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
    document.dispatchEvent(new CustomEvent('ff:popup', { detail: { popup: 'exit_intent', action: 'close', via: how } }));
  }
  function onKey(e) {
    if (!overlay) return;
    if (e.key === 'Escape') return closePopup('esc');
    if (e.key === 'Tab') { // keep focus inside the dialog
      var f = overlay.querySelectorAll('input, button');
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function showPopup() {
    set('sessionStorage', EXIT_SHOWN, '1');
    overlay = document.createElement('div');
    overlay.className = 'cap-overlay';
    overlay.innerHTML =
      '<div class="cap-dialog" role="dialog" aria-modal="true" aria-labelledby="cap-title">' +
        '<button type="button" class="cap-close" aria-label="' + t('close') + '">×</button>' +
        '<span class="cap-eyebrow">FuturoFood Weekly</span>' +
        '<h2 class="cap-title" id="cap-title">' + t('pitch') + '</h2>' +
        '<form class="cap-form" novalidate>' +
          '<input type="email" required autocomplete="email" aria-label="' + t('email') + '" placeholder="' + t('placeholder') + '"/>' +
          '<button type="submit" class="cap-submit">' + t('cta') + '</button>' +
        '</form>' +
        '<p class="cap-note">' + t('note') + '</p>' +
      '</div>';
    document.body.appendChild(overlay);
    var form = overlay.querySelector('form');
    var input = overlay.querySelector('input');
    overlay.querySelector('.cap-close').addEventListener('click', function () { closePopup('x'); });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closePopup('outside'); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      subscribe(input.value.trim(), 'exit_intent', overlay.querySelector('.cap-note'), overlay.querySelector('.cap-submit'), function () {
        setTimeout(function () { closePopup('subscribed'); }, 2500);
      });
    });
    document.addEventListener('keydown', onKey);
    input.focus();
    document.dispatchEvent(new CustomEvent('ff:popup', { detail: { popup: 'exit_intent', action: 'view' } }));
  }
  function initExitIntent() {
    var desktop = window.matchMedia('(pointer: fine)').matches && window.innerWidth > 960;
    if (!desktop || subscribed() || get('sessionStorage', EXIT_SHOWN)) return;
    document.addEventListener('mouseout', function (e) {
      if (e.relatedTarget || e.clientY > 0) return;          // only leaving through the top
      if (Date.now() - loadedAt < 15000) return;             // never in the first 15 s
      if (overlay || subscribed() || get('sessionStorage', EXIT_SHOWN)) return;
      if (document.documentElement.classList.contains('consent-open') || document.querySelector('.share-menu')) return;
      showPopup();
    });
  }

  // ── Phone bar: "Subscribe" opens an email field in place ──
  function initDock() {
    var dock = document.querySelector('.share-dock');
    var btn = dock && dock.querySelector('[data-dock-subscribe]');
    if (!btn) return;
    if (subscribed()) { btn.hidden = true; return; }
    var form = null;
    btn.addEventListener('click', function () {
      if (form) { form.remove(); form = null; dock.classList.remove('is-expanded'); return; }
      form = document.createElement('form');
      form.className = 'dock-form';
      form.noValidate = true;
      form.innerHTML =
        '<p class="dock-pitch">' + t('pitch') + '</p>' +
        '<div class="dock-form-row"><input type="email" required autocomplete="email" aria-label="' + t('email') + '" placeholder="' + t('placeholder') + '"/>' +
        '<button type="submit" class="cap-submit">' + (es() ? 'Suscribirme' : 'Subscribe') + '</button></div>' +
        '<p class="cap-note">' + t('note') + '</p>';
      dock.insertBefore(form, dock.firstChild);
      dock.classList.add('is-expanded');
      var input = form.querySelector('input');
      input.focus();
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        subscribe(input.value.trim(), 'mobile_bar', form.querySelector('.cap-note'), form.querySelector('.cap-submit'), function () {
          btn.hidden = true;
          setTimeout(function () { if (form) { form.remove(); form = null; } dock.classList.remove('is-expanded'); }, 2500);
        });
      });
    });
  }

  // Subscribed somewhere else on the page (newsletter.js): stop asking
  document.addEventListener('ff:subscribed', function () {
    var b = document.querySelector('[data-dock-subscribe]');
    if (b) b.hidden = true;
  });

  function init() { initExitIntent(); initDock(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
