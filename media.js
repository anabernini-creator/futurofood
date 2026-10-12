/*
 * FuturoFood media frames.
 *
 * Any element with class "media-frame" can carry a data-video-url:
 *   - YouTube  (youtube.com/watch?v=…, youtu.be/…, /shorts/…, /embed/…)
 *   - Vimeo    (vimeo.com/123, vimeo.com/123/hash, player.vimeo.com/video/123)
 *   - a direct video file (.mp4, .webm, .ogv/.ogg, .m4v)
 * With a supported URL the frame shows the video; with no URL (or one that
 * can't be played) it keeps the editorial placeholder already inside it.
 * Thumbnails (class "is-thumb", inside clickable cards) never embed a player:
 * they only get a "▶ Video" badge, and the video plays on the article page.
 *
 * Also loaded from Node (scripts/weekly-content-agent.mjs) to validate URLs.
 */
(function () {
  function parseStart(t) {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    var m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
  }

  function parseVideoUrl(raw) {
    if (!raw) return null;
    var url;
    try { url = new URL(String(raw).trim()); } catch (e) { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    var host = url.hostname.replace(/^(www|m)\./, '');

    if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
      var path = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      var id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0]
        : path ? path[1] : url.searchParams.get('v');
      if (!/^[\w-]{11}$/.test(id || '')) return null;
      var start = parseStart(url.searchParams.get('t') || url.searchParams.get('start'));
      return { type: 'youtube', id: id, src: 'https://www.youtube-nocookie.com/embed/' + id + (start ? '?start=' + start : '') };
    }

    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      var v = url.pathname.match(/^\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?\/?$/);
      if (!v) return null;
      var hash = v[2] || url.searchParams.get('h');
      return { type: 'vimeo', id: v[1], src: 'https://player.vimeo.com/video/' + v[1] + (hash ? '?h=' + hash : '') };
    }

    if (/\.(mp4|webm|ogv|ogg|m4v)$/i.test(url.pathname)) {
      return { type: 'file', src: url.href };
    }
    return null;
  }

  function mount(frame) {
    var raw = frame.getAttribute('data-video-url');
    if (!raw) return;
    var video = parseVideoUrl(raw);
    if (!video) {
      console.warn('[FuturoFood] Unsupported video URL, showing placeholder:', raw);
      return;
    }

    if (frame.classList.contains('is-thumb')) {
      var badge = document.createElement('span');
      badge.className = 'media-badge';
      badge.textContent = '▶ Video';
      frame.appendChild(badge);
      return;
    }

    var title = frame.getAttribute('data-video-title') || 'Video';
    var el;
    if (video.type === 'file') {
      el = document.createElement('video');
      el.controls = true;
      el.preload = 'metadata';
      el.playsInline = true;
      el.src = video.src;
      el.setAttribute('aria-label', title);
      // A broken file falls back to the placeholder instead of an empty player
      el.addEventListener('error', function () {
        el.remove();
        frame.classList.remove('has-video');
      });
    } else {
      el = document.createElement('iframe');
      el.src = video.src;
      el.title = title;
      el.loading = 'lazy';
      el.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      el.allowFullscreen = true;
      el.referrerPolicy = 'strict-origin-when-cross-origin';
    }
    el.className = 'media-embed';
    frame.appendChild(el);
    frame.classList.add('has-video');
    // It is a player now, not a picture: drop the placeholder's image semantics
    frame.removeAttribute('role');
    frame.removeAttribute('aria-label');
    frame.removeAttribute('data-es-aria-label');
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { parseVideoUrl: parseVideoUrl };
    return;
  }

  function init() {
    document.querySelectorAll('.media-frame[data-video-url]').forEach(mount);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
