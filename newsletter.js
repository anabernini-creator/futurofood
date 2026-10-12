(function () {
  var MSG = {
    sending: { en: 'Subscribing…', es: 'Suscribiendo…' },
    success: { en: '✓ You\'re subscribed! Check your inbox.', es: '✓ ¡Listo! Revisa tu correo.' },
    invalid: { en: 'Please enter a valid email.', es: 'Ingresá un correo válido.' },
    error: { en: 'Something went wrong. Try again.', es: 'Algo salió mal. Intentá de nuevo.' }
  };

  // Remember how the reader arrived (e.g. ?utm_source=whatsapp&utm_medium=share
  // from a shared article) so the signup can be attributed in Beehiiv, even if
  // they subscribe on another page of the visit.
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'];
  function landingUtm() {
    var params = new URLSearchParams(location.search);
    var fromUrl = {};
    UTM_KEYS.forEach(function (k) { if (params.get(k)) fromUrl[k] = params.get(k).slice(0, 64); });
    try {
      if (Object.keys(fromUrl).length) sessionStorage.setItem('ff-utm', JSON.stringify(fromUrl));
      return JSON.parse(sessionStorage.getItem('ff-utm') || '{}');
    } catch (e) {
      return fromUrl;
    }
  }
  var UTM = landingUtm();

  function lang() {
    return document.documentElement.getAttribute('lang') === 'es' ? 'es' : 'en';
  }

  function findNote(container, button) {
    if (button && button.nextElementSibling && button.nextElementSibling.tagName === 'P') {
      return button.nextElementSibling;
    }
    if (container.nextElementSibling && container.nextElementSibling.tagName === 'P') {
      return container.nextElementSibling;
    }
    return null;
  }

  function setNote(note, text, isError) {
    if (!note) return;
    note.textContent = text;
    note.style.color = isError ? '#FF6B35' : '';
  }

  function wireForm(input) {
    var container = input.parentElement;
    var button = container.querySelector('button');
    if (!button || button.dataset.nlWired) return;
    button.dataset.nlWired = '1';

    var note = findNote(container, button);
    var originalNote = note ? note.textContent : '';
    var originalBtn = button.textContent;

    function reset(delay) {
      setTimeout(function () {
        button.disabled = false;
        input.disabled = false;
        button.textContent = originalBtn;
        setNote(note, originalNote, false);
      }, delay);
    }

    function submit() {
      var email = input.value.trim();
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        setNote(note, MSG.invalid[lang()], true);
        reset(2500);
        return;
      }

      button.disabled = true;
      input.disabled = true;
      button.textContent = MSG.sending[lang()];

      fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email,
          utm_source: UTM.utm_source,
          utm_medium: UTM.utm_medium,
          utm_campaign: UTM.utm_campaign,
          page: location.pathname
        })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok && data.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            input.value = '';
            button.textContent = originalBtn;
            setNote(note, MSG.success[lang()], false);
            reset(6000);
          } else {
            var isInvalid = result.data && result.data.error === 'invalid_email';
            setNote(note, isInvalid ? MSG.invalid[lang()] : MSG.error[lang()], true);
            button.disabled = false;
            input.disabled = false;
            button.textContent = originalBtn;
            setTimeout(function () { setNote(note, originalNote, false); }, 4000);
          }
        })
        .catch(function () {
          setNote(note, MSG.error[lang()], true);
          button.disabled = false;
          input.disabled = false;
          button.textContent = originalBtn;
          setTimeout(function () { setNote(note, originalNote, false); }, 4000);
        });
    }

    button.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
  }

  function init() {
    document.querySelectorAll('input[type="email"]').forEach(wireForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
