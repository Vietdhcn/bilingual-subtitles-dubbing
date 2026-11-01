// Site adapters: mỗi trang cung cấp cách tìm video, id video, container để vẽ overlay,
// cách lấy cue và cách ẩn phụ đề gốc. YouTube có adapter riêng; mọi trang khác (Coursera,
// Udemy, …) dùng adapter generic dựa trên HTML5 <video> + textTracks / <track> WebVTT.

const YSNVtt = {
  _sec(ts) { const p = String(ts).trim().replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]; },
  // Parse WebVTT / SRT → [{start,end,text}]
  parse(vtt) {
    const toSec = (ts) => this._sec(ts);
    const out = [];
    const blocks = vtt.replace(/\r/g, '').split(/\n\n+/);
    for (const b of blocks) {
      const lines = b.split('\n');
      const ti = lines.findIndex(l => l.includes('-->'));
      if (ti < 0) continue;
      const [a, rest] = lines[ti].split('-->');
      const end = rest.trim().split(/\s+/)[0];
      const text = ysnDecodeEntities(lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (text) out.push({ start: toSec(a), end: toSec(end), text });
    }
    return out;
  },
};

const YSNYouTubeSite = {
  name: 'youtube',
  matches: () => /(^|\.)youtube\.com$/.test(location.hostname),
  findVideo: () => document.querySelector('#movie_player video, video.html5-main-video'),
  getVideoId: () => YSNCaptions.getVideoId(),
  container: () => document.getElementById('movie_player'),
  // Đang chiếu quảng cáo: trình phát bỏ qua lệnh bật phụ đề, currentTime là của quảng cáo
  isAd: () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'),
  async waitForAds(maxMs = 240000) {
    const t0 = Date.now();
    while (this.isAd() && Date.now() - t0 < maxMs) await new Promise(r => setTimeout(r, 500));
  },
  async getCues(videoId) {
    await this.waitForAds();
    const info = await YSNCaptions.getTracks(videoId);
    const track = YSNCaptions.pickTrack(info);
    this._last = { videoId, info, track };
    // ngôn ngữ NÓI của video = ngôn ngữ của phụ đề tự động (ASR); phụ đề mặc định có thể là bản dịch (vd. video tiếng Việt có phụ đề Anh)
    const spokenLang = info.tracks.find(t => t.kind === 'asr')?.languageCode || null;
    if (!track) return { cues: [], lang: null, spokenLang };
    return { cues: await YSNCaptions.fetchCues(videoId, track), lang: track.languageCode, kind: track.kind, spokenLang };
  },
  // Xem nhanh ngôn ngữ nói (không chờ): undefined = chưa biết (trình phát chưa chuyển sang video này)
  async peekSpokenLang(videoId) {
    const r = await YSNCaptions._bridge('YSN_GET_PLAYER_RESPONSE', {}, 600);
    if (!r || r.videoId !== videoId) return undefined;
    return (r.tracks || []).find(t => t.kind === 'asr')?.languageCode || null;
  },
  // Video có sẵn phụ đề ngôn ngữ đích do người làm (không phải tự dịch) → dùng làm bản dịch
  // keep(): tiện ích còn cần phụ đề của trình phát không (người dùng có thể vừa tắt hết trong lúc đang tải)
  async getHumanTranslation(videoId, res, targetLang, _video, keep) {
    const last = this._last;
    if (!last || last.videoId !== videoId || !last.track) return null;
    const base = (x) => (x || '').toLowerCase().split('-')[0];
    if (base(res.lang) === base(targetLang)) return null;
    const tt = last.info.tracks.find(t => t.kind !== 'asr' && base(t.languageCode) === base(targetLang));
    if (!tt) return null;
    await this.waitForAds();
    const cues = await YSNCaptions.fetchCues(videoId, tt);
    // trả trình phát về track nguồn (YouTube nhớ ngôn ngữ phụ đề vừa chọn cho các video sau)
    const src = last.track;
    if (keep && !keep()) YSNCaptions.disableCaptions();          // đã tắt hết → trả CC về như cũ, đừng bật lại
    else YSNCaptions._bridge('YSN_ENABLE_CAPTIONS', { languageCode: src.languageCode, kind: src.kind === 'asr' ? 'asr' : '' });
    return { cues, lang: tt.languageCode };
  },
  // Extension đã bật CC trong player để lấy phụ đề → tắt lại khi không còn dùng.
  release() { YSNCaptions.disableCaptions(); },
  hideNative(hide) { document.getElementById('movie_player')?.classList.toggle('ysn-hide-native', !!hide); },
  onNavigate(cb) {
    document.addEventListener('yt-navigate-finish', () => setTimeout(cb, 300));
    window.addEventListener('popstate', () => setTimeout(cb, 300));
  },
};

const YSNGenericSite = {
  name: 'generic',
  matches: () => true,
  // Video lớn nhất đang hiển thị
  findVideo() {
    const vids = [...document.querySelectorAll('video')].filter(v => v.offsetWidth > 200 && v.offsetHeight > 100);
    vids.sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight);
    return vids[0] || null;
  },
  getVideoId() {
    const u = new URL(location.href);
    // Udemy: /course/<slug>/learn/lecture/<id>  — Coursera: /learn/<slug>/lecture/<id>/<name>
    const m = u.pathname.match(/\/lecture\/([^/?#]+)/) || u.pathname.match(/\/(?:watch|video|v|media)\/([^/?#]+)/);
    const base = m ? m[1] : u.pathname.replace(/\W+/g, '_');
    return `${u.hostname}:${base}`;
  },
  container(video) {
    // Udemy / Coursera / video.js đều bọc video trong một div player.
    // Bắt đầu tìm từ cha của <video> (closest() tính cả chính phần tử → có thể trả về <video>).
    const p = video.parentElement;
    if (!p) return null;
    const host = p.closest('[class*="video-player"], [class*="videoPlayer"], .video-js, [data-purpose="video-display"], [class*="player"]');
    // Không leo quá xa: container phải bao sát video (≤ 1.6 lần diện tích)
    const area = (el) => el.offsetWidth * el.offsetHeight;
    if (host && area(host) <= area(video) * 1.6 + 1) return host;
    return p;
  },
  // Lấy phụ đề cho trang bất kỳ. Trả về một trong:
  //   { cues, lang, kind }        — danh sách đầy đủ (file .vtt/.srt…, <track>)
  //   { stream, lang, kind }      — textTrack nạp cue dần (HLS/DASH): stream.read() / stream.start(onChange)
  //   { live, lang, kind:'live' } — đọc phụ đề trình phát tự vẽ lên trang, theo thời gian thực
  async getCues(_videoId, video, targetLang) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // 1) textTracks của <video>: ép mode=hidden để trình duyệt / hls.js tải cue mà không tự vẽ
    for (const tt of YSNSubSources.rankTracks(video, targetLang).slice(0, 2)) {
      const was = tt.mode;
      if (tt.mode === 'disabled') tt.mode = 'hidden';
      for (let i = 0; i < 30 && !(tt.cues && tt.cues.length); i++) await sleep(200);
      if (tt.cues && tt.cues.length) {
        return { stream: new YSNTrackStream(video, tt), lang: tt.language || ysnLangFromString(tt.label), kind: 'track' };
      }
      if (was === 'disabled') tt.mode = 'disabled';
    }
    // 2) <track src="…"> (track bị chặn CORS nên textTracks rỗng) → tự tải
    const els = [...video.querySelectorAll('track')].filter(t => t.src && t.kind !== 'chapters' && t.kind !== 'metadata');
    const elUrl = YSNSubSources.pickUrl(els.map(t => t.src), targetLang, (u) => ysnLangFromString(els.find(t => t.src === u)?.srclang || els.find(t => t.src === u)?.label));
    if (elUrl) {
      try {
        const cues = YSNSubParse.any(await YSNSubSources.fetchText(elUrl));
        const el = els.find(t => t.src === elUrl);
        if (cues.length) return { cues, lang: el?.srclang || ysnLangFromString(el?.label) || null, kind: 'vtt' };
      } catch { /* thử nguồn khác */ }
    }
    // 3) file phụ đề trang đã tải về (trình phát tự vẽ phụ đề từ .vtt/.srt/.ass/.ttml/.json)
    for (const url of YSNSubSources.resourceUrls().sort((a, b) => (YSNSubSources.pickUrl([a, b], targetLang) === a ? -1 : 1)).slice(0, 4)) {
      try {
        const cues = YSNSubParse.any(await YSNSubSources.fetchText(url));
        if (cues.length >= 3) return { cues, lang: ysnLangFromString(decodeURIComponent(url)), kind: 'file' };
      } catch { /* file khác */ }
    }
    // 4) phụ đề vẽ bằng DOM đang hiện chữ → chế độ trực tiếp
    const box = this.container(video);
    if (YSNLiveCaptions.hasText(video, box)) return { live: new YSNLiveCaptions(video, box), lang: null, kind: 'live' };
    return { cues: [], lang: null };
  },
  // Trang có sẵn track ngôn ngữ đích (vd. phim có phụ đề tiếng Việt) → dùng làm bản dịch của người
  async getHumanTranslation(_videoId, res, targetLang, video) {
    if (!res.stream || !video) return null;
    const base = (x) => (x || '').toLowerCase().split('-')[0];
    const tt = [...(video.textTracks || [])].find(t => (t.kind === 'subtitles' || t.kind === 'captions') && t !== res.stream.track &&
      base(t.language || ysnLangFromString(t.label)) === base(targetLang));
    if (!tt) return null;
    if (tt.mode === 'disabled') tt.mode = 'hidden';
    for (let i = 0; i < 30 && !(tt.cues && tt.cues.length); i++) await new Promise(r => setTimeout(r, 200));
    if (!tt.cues?.length) return null;
    return { stream: new YSNTrackStream(video, tt), lang: tt.language || targetLang };
  },
  // Chưa có phụ đề: theo dõi nhẹ (2s/lần) — khi người dùng bật CC trong trình phát, track mới / file mới / chữ mới xuất hiện
  watchForSource(video, onFound) {
    const sig = () => {
      const tracks = [...(video.textTracks || [])].map(t => t.kind + t.language + (t.cues?.length || 0) + t.mode).join(',');
      return tracks + '|' + YSNSubSources.resourceUrls().length;
    };
    let last = sig(), n = 0;
    const timer = setInterval(() => {
      if (++n > 900) return clearInterval(timer);                     // ~30 phút
      if (document.hidden) return;
      const now = sig();
      if (now !== last || (n % 2 === 0 && YSNLiveCaptions.hasText(video, this.container(video)))) { clearInterval(timer); onFound(); }
      last = now;
    }, 2000);
    return () => clearInterval(timer);
  },
  hideNative(hide, video, cueText) {
    if (!video) return;
    for (const t of video.textTracks || []) if (t.mode === 'showing') t._ysnWasShowing = true;
    for (const t of video.textTracks || []) {
      if (hide) { if (t.mode === 'showing') t.mode = 'hidden'; }
      else if (t._ysnWasShowing) t.mode = 'showing';
    }
    document.documentElement.classList.toggle('ysn-hide-native-generic', !!hide);
    // Trình phát tự vẽ phụ đề bằng DOM (class lạ): tìm phần tử đang hiện ĐÚNG câu phụ đề hiện tại để ẩn đi
    if (hide && cueText && !this._nativeEl?.isConnected) this._nativeEl = this._findCaptionByText(video, cueText);
    if (this._nativeEl?.isConnected) this._nativeEl.classList.add('ysn-live-src');
  },
  _findCaptionByText(video, cueText) {
    const norm = (x) => (x || '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const want = norm(cueText);
    if (want.length < 6) return null;
    const root = video.parentElement?.parentElement || video.parentElement;
    if (!root) return null;
    const vr = video.getBoundingClientRect();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), k = 0; n && k < 3000; n = walker.nextNode(), k++) {
      const t = norm(n.nodeValue);
      if (t.length < 6 || !want.includes(t)) continue;
      let el = n.parentElement;
      if (!el || el.closest('#ysn-overlay, #ysn-panel, #ysn-lookup, #ysn-dub-badge')) continue;
      while (el.parentElement && el.parentElement !== root && norm(el.parentElement.textContent) === norm(el.textContent)) el = el.parentElement;
      const r = el.getBoundingClientRect();
      if (r.width && r.left < vr.right && r.right > vr.left && r.top < vr.bottom && r.bottom > vr.top) return el;
    }
    return null;
  },
  onNavigate(cb) {
    let last = location.href;
    setInterval(() => { if (location.href !== last) { last = location.href; setTimeout(cb, 500); } }, 800);
  },
};

// Tải text qua service worker (tránh CORS với CDN phụ đề như udemycdn.com, coursera…)
async function ysnFetchText(url) {
  const r = await chrome.runtime.sendMessage({ type: 'FETCH_TEXT', url });
  if (!r?.ok) throw new Error(r?.error || 'fetch lỗi');
  return r.text;
}

// Chọn phụ đề nguồn: ưu tiên ngôn ngữ gốc của bài (thường là tiếng Anh), không phải ngôn ngữ đích, ưu tiên bản thủ công.
function ysnPickCaption(list, targetLang, { lang = c => c.lang, manual = c => true } = {}) {
  const tgt = (targetLang || '').split('-')[0].toLowerCase();
  const norm = c => (lang(c) || '').toLowerCase().replace('_', '-');
  const pool = list.filter(c => norm(c).split('-')[0] !== tgt);
  const cand = pool.length ? pool : list;
  const score = c => (norm(c).startsWith('en') ? 4 : 0) + (manual(c) ? 2 : 0);
  return [...cand].sort((a, b) => score(b) - score(a))[0] || null;
}

// ---------- Udemy (udemy.com + Udemy Business *.udemy.com) ----------
// Player của Udemy tự vẽ phụ đề (không có textTracks) → lấy danh sách phụ đề qua API của chính trang.
const YSNUdemySite = {
  ...YSNGenericSite,
  name: 'udemy',
  matches: () => /(^|\.)udemy\.com$/.test(location.hostname),
  _ids() {
    const m = location.pathname.match(/\/course\/([^/]+)\/learn\/lecture\/(\d+)/);
    return m ? { slug: m[1], lectureId: m[2] } : null;
  },
  getVideoId() {
    const ids = this._ids();
    return ids ? `udemy:${ids.lectureId}` : null;   // chỉ chạy trên trang bài giảng
  },
  // ngôn ngữ giảng của khoá (đã biết từ bài trước) — undefined nếu chưa biết
  peekSpokenLang() { const ids = this._ids(); return ids ? this._courses[ids.slug]?.lang : undefined; },
  _courses: {},
  // id + ngôn ngữ giảng của khoá học (= ngôn ngữ nói trong video)
  async _course(slug) {
    if (this._courses[slug]) return this._courses[slug];
    const r = await fetch(`/api-2.0/courses/${slug}/?fields[course]=id,locale`, { credentials: 'include' });
    if (!r.ok) throw new Error(`Udemy course HTTP ${r.status}`);
    const j = await r.json();
    const c = { id: j.id, lang: (j.locale?.locale || '').replace('_', '-') || null };
    this._courses[slug] = c;
    return c;
  },
  async getCues(_videoId, video, targetLang) {
    const ids = this._ids();
    if (!ids) return { cues: [], lang: null };
    const course = await this._course(ids.slug);
    const courseId = course.id;
    const r = await fetch(`/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${ids.lectureId}/?fields[lecture]=asset&fields[asset]=captions,asset_type`, { credentials: 'include' });
    if (!r.ok) throw new Error(`Udemy lecture HTTP ${r.status}`);
    const caps = ((await r.json()).asset?.captions || []).filter(c => c.url && c.status !== 0);
    this._caps = { lectureId: ids.lectureId, caps };
    // Ưu tiên phụ đề đúng ngôn ngữ giảng của khoá (kể cả khi trùng ngôn ngữ đích → chỉ hiện phụ đề gốc, không dịch);
    // không có thì chọn như cũ (tránh lấy phụ đề tự dịch sang tiếng khác rồi dịch lại lần nữa)
    const base = (x) => (x || '').toLowerCase().replace('_', '-').split('-')[0];
    const own = caps.filter(c => course.lang && base(c.locale_id) === base(course.lang));
    const cap = own.find(c => c.source !== 'auto') || own[0] || ysnPickCaption(caps, targetLang, { lang: c => c.locale_id, manual: c => c.source !== 'auto' });
    if (!cap) {
      // dự phòng: có thể player khác (vd. bài giảng dạng HTML5 có textTracks)
      return YSNGenericSite.getCues.call(this, _videoId, video, targetLang);
    }
    const cues = YSNVtt.parse(await ysnFetchText(cap.url));
    return { cues, lang: (cap.locale_id || '').replace('_', '-'), kind: cap.source === 'auto' ? 'udemy-auto' : 'udemy', spokenLang: course.lang };
  },
  hideNative(hide) {
    document.documentElement.classList.toggle('ysn-hide-native-generic', !!hide);
  },
  async getHumanTranslation(_videoId, res, targetLang) {
    const base = (x) => (x || '').toLowerCase().replace('_', '-').split('-')[0];
    const ids = this._ids(); const c = this._caps;
    if (!ids || !c || c.lectureId !== ids.lectureId || base(res.lang) === base(targetLang)) return null;
    const tgt = c.caps.find(x => base(x.locale_id) === base(targetLang) && x.source !== 'auto');
    if (!tgt) return null;
    return { cues: YSNVtt.parse(await ysnFetchText(tgt.url)), lang: (tgt.locale_id || '').replace('_', '-') };
  },
};

const YSNSites = {
  current() {
    if (YSNYouTubeSite.matches()) return YSNYouTubeSite;
    if (YSNUdemySite.matches()) return YSNUdemySite;
    return YSNGenericSite;
  },
};
