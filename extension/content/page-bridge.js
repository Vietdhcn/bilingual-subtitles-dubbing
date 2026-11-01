// Chạy trong "MAIN world" của trang YouTube (document_start).
// 1) Quan sát (không sửa) các response phụ đề /api/timedtext mà CHÍNH trình phát YouTube tải về
//    → chuyển cho content script. Nhờ vậy không cần tự gọi API YouTube bằng danh tính client khác.
// 2) Gọi API của player (loadModule/setOption 'captions') để bật đúng track khi extension cần phụ đề.
(() => {
  if (window.__ysnBridge) return;
  window.__ysnBridge = true;
  const store = new Map();                         // `${v}|${lang}|${kind}` → body (giữ ~20 mục gần nhất)

  function capture(url, body) {
    try {
      const u = new URL(url, location.href);
      if (!u.pathname.includes('/api/timedtext') || !body) return;
      if (u.searchParams.get('tlang')) return;     // bản YouTube tự dịch → không dùng làm nguồn
      const v = u.searchParams.get('v'), lang = u.searchParams.get('lang') || '', kind = u.searchParams.get('kind') || '';
      if (!v) return;
      const key = `${v}|${lang}|${kind}`;
      store.set(key, body);
      if (store.size > 20) store.delete(store.keys().next().value);
      window.postMessage({ type: 'YSN_TIMEDTEXT', v, lang, kind, body }, '*');
    } catch { /* ignore */ }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (url && url.includes('/api/timedtext')) p.then(r => r.clone().text()).then(b => capture(url, b)).catch(() => {});
    } catch { /* ignore */ }
    return p;
  };
  const origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__ysnUrl = String(url); return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (this.__ysnUrl && this.__ysnUrl.includes('/api/timedtext')) {
      this.addEventListener('load', () => {
        try { capture(this.__ysnUrl, (this.responseType === '' || this.responseType === 'text') ? this.responseText : (typeof this.response === 'string' ? this.response : '')); } catch { /* ignore */ }
      });
    }
    return origSend.apply(this, arguments);
  };

  const player = () => document.getElementById('movie_player');
  // Trạng thái CC của NGƯỜI DÙNG trước khi tiện ích đụng vào phụ đề của trình phát (undefined = chưa đụng)
  // → khi tiện ích thôi dùng phụ đề thì trả lại đúng như cũ: người dùng đang bật CC thì giữ, không bật thì tắt.
  let userTrack;
  const rememberUserTrack = (p) => {
    if (userTrack !== undefined) return;
    try { const t = p.getOption('captions', 'track'); userTrack = t && t.languageCode ? t : null; } catch { userTrack = null; }
  };
  function playerResponse() {
    const p = player();
    try { return p?.getPlayerResponse?.() || window.ytInitialPlayerResponse || null; } catch { return window.ytInitialPlayerResponse || null; }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || typeof ev.data.type !== 'string') return;
    const { type, requestId } = ev.data;
    const reply = (data) => window.postMessage({ type: type.replace('YSN_', 'YSN_R_'), requestId, ...data }, '*');

    if (type === 'YSN_GET_PLAYER_RESPONSE') {
      const pr = playerResponse();
      const r = pr?.captions?.playerCaptionsTracklistRenderer;
      const at = r?.audioTracks?.[r?.defaultAudioTrackIndex ?? 0];
      reply({ videoId: pr?.videoDetails?.videoId || null, tracks: r?.captionTracks || [], defaultIndex: Number.isInteger(at?.defaultCaptionTrackIndex) ? at.defaultCaptionTrackIndex : -1 });
    } else if (type === 'YSN_GET_TIMEDTEXT') {
      const { v, lang, kind } = ev.data;
      reply({ body: store.get(`${v}|${lang}|${kind || ''}`) || null });
    } else if (type === 'YSN_ENABLE_CAPTIONS') {
      const p = player();
      if (!p?.setOption) return reply({ ok: false, error: 'player chưa sẵn sàng' });
      rememberUserTrack(p);
      try { p.loadModule?.('captions'); } catch { /* ignore */ }
      let list = [];
      try { list = p.getOption('captions', 'tracklist') || []; } catch { /* ignore */ }
      const { languageCode, kind } = ev.data;
      const t = list.find(x => x.languageCode === languageCode && ((x.kind === 'asr') === (kind === 'asr'))) || list.find(x => x.languageCode === languageCode);
      // Tắt rồi bật lại track: đặt lại đúng track đang chọn đôi khi KHÔNG làm player tải phụ đề (đã kiểm chứng).
      try { p.setOption('captions', 'track', {}); } catch { /* ignore */ }
      setTimeout(() => {
        try { p.setOption('captions', 'track', t || { languageCode, ...(kind === 'asr' ? { kind: 'asr' } : {}) }); } catch { /* ignore */ }
      }, 250);
      reply({ ok: true, listed: list.length });
    } else if (type === 'YSN_DISABLE_CAPTIONS') {
      if (userTrack !== undefined) {                 // chỉ khi tiện ích đã đổi phụ đề của trình phát
        try { player()?.setOption?.('captions', 'track', userTrack || {}); } catch { /* ignore */ }
        userTrack = undefined;
      }
      reply({ ok: true });
    }
  });
})();
