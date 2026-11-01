// YouTube: lấy danh sách track và nội dung phụ đề từ CHÍNH trình phát YouTube (qua page-bridge.js),
// chuyển thành mảng cue {start, end, text} (giây).
const YSNCaptions = {
  getVideoId(url = location.href) {
    const u = new URL(url);
    if (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/embed/') || u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || null;
    return u.searchParams.get('v');
  },

  // Gửi yêu cầu tới page-bridge (MAIN world) và chờ trả lời.
  _bridge(type, data = {}, timeout = 2000) {
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2);
      const replyType = type.replace('YSN_', 'YSN_R_');
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, timeout);
      function onMsg(ev) {
        if (ev.source !== window || ev.data?.type !== replyType || ev.data.requestId !== requestId) return;
        clearTimeout(timer); window.removeEventListener('message', onMsg);
        resolve(ev.data);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ type, requestId, ...data }, '*');
    });
  },

  // Danh sách track của video đang mở. Chờ tới khi player đã chuyển sang đúng video (SPA).
  async getTracks(videoId) {
    for (let i = 0; i < 20; i++) {
      const r = await this._bridge('YSN_GET_PLAYER_RESPONSE');
      if (r && r.videoId === videoId) return { tracks: r.tracks || [], defaultIndex: r.defaultIndex ?? -1 };
      await new Promise(res => setTimeout(res, 300));
    }
    return { tracks: [], defaultIndex: -1 };
  },

  // Chọn track nguồn: (1) track YouTube gợi ý, (2) thủ công cùng ngôn ngữ với ASR (= ngôn ngữ nói), (3) ASR, (4) en.
  pickTrack({ tracks, defaultIndex }, preferLang) {
    if (!tracks.length) return null;
    if (preferLang) {
      const hit = tracks.find(t => (t.languageCode || '').toLowerCase().startsWith(preferLang.toLowerCase()) && t.kind !== 'asr')
        || tracks.find(t => (t.languageCode || '').toLowerCase().startsWith(preferLang.toLowerCase()));
      if (hit) return hit;
    }
    if (defaultIndex >= 0 && tracks[defaultIndex]) return tracks[defaultIndex];
    const asr = tracks.find(t => t.kind === 'asr');
    if (asr) {
      const spoken = (asr.languageCode || '').split('-')[0];
      return tracks.find(t => t.kind !== 'asr' && (t.languageCode || '').split('-')[0] === spoken) || asr;
    }
    return tracks.find(t => (t.languageCode || '').startsWith('en')) || tracks[0];
  },

  // Bật track trong player rồi nhận nội dung phụ đề player tải về.
  async loadTrack(videoId, track) {
    const lang = track.languageCode, kind = track.kind === 'asr' ? 'asr' : '';
    const matches = (d) => d && d.v === videoId && d.lang === lang && (d.kind || '') === kind;
    // đã có sẵn (người dùng bật CC từ trước)?
    const cached = await this._bridge('YSN_GET_TIMEDTEXT', { v: videoId, lang, kind });
    if (cached?.body) return cached.body;

    const waitBody = (ms) => new Promise((resolve) => {
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, ms);
      function onMsg(ev) {
        if (ev.source !== window || ev.data?.type !== 'YSN_TIMEDTEXT' || !matches(ev.data)) return;
        clearTimeout(timer); window.removeEventListener('message', onMsg);
        resolve(ev.data.body);
      }
      window.addEventListener('message', onMsg);
    });
    // Bật track trong player rồi chờ player tải phụ đề; thử lại tối đa 3 lần (mỗi lần chờ 4 giây).
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = waitBody(4000);
      let enabled = null;
      for (let i = 0; i < 10 && !enabled?.ok; i++) {         // player có thể chưa sẵn sàng ngay
        enabled = await this._bridge('YSN_ENABLE_CAPTIONS', { languageCode: lang, kind });
        if (!enabled?.ok) await new Promise(r => setTimeout(r, 400));
      }
      if (enabled?.ok) this.weEnabledCaptions = true;
      const body = await got;
      if (body) return body;
    }
    // Dự phòng: tải trực tiếp URL track của trang web (có thể rỗng nếu YouTube yêu cầu token)
    try {
      const u = new URL(track.baseUrl); u.searchParams.set('fmt', 'json3');
      const r = await fetch(u.toString(), { credentials: 'include' });
      const t = await r.text();
      if (t.trim()) return t;
    } catch { /* ignore */ }
    throw new Error('không nhận được phụ đề từ trình phát YouTube');
  },

  // Trả phụ đề của trình phát về như trước khi tiện ích bật (page-bridge nhớ trạng thái CC của người dùng)
  disableCaptions() {
    this._bridge('YSN_DISABLE_CAPTIONS', {}, 1000); this.weEnabledCaptions = false;
  },

  async fetchCues(videoId, track) {
    const body = await this.loadTrack(videoId, track);
    const raw = body.trim().startsWith('<') ? this._parseXml(body) : this._parseJson3(JSON.parse(body));
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].end <= raw[i].start) raw[i].end = raw[i + 1] ? raw[i + 1].start : raw[i].start + 3;
      if (raw[i + 1] && raw[i].end > raw[i + 1].start) raw[i].end = raw[i + 1].start;
    }
    return raw.map((c, i) => ({ ...c, index: i }));        // gom thành câu ở main.js (toSentences)
  },

  // Phụ đề tự động (ASR) có thời điểm của TỪNG TỪ (tOffsetMs) → giữ lại để cắt câu đúng chỗ
  _parseJson3(data) {
    const events = (data.events || []).filter(e => e.segs && e.segs.some(s => (s.utf8 || '').trim() && s.utf8 !== '\n'));
    return events.map(e => {
      const c = {
        start: e.tStartMs / 1000,
        end: (e.tStartMs + (e.dDurationMs || 0)) / 1000,
        text: e.segs.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim(),
      };
      if (e.segs.length > 1 && e.segs.some(s => s.tOffsetMs)) {
        c.words = e.segs.map(s => ({ t: (e.tStartMs + (s.tOffsetMs || 0)) / 1000, w: (s.utf8 || '').trim() })).filter(x => x.w);
      }
      return c;
    }).filter(c => c.text);
  },

  // <timedtext format="3"><body><p t="ms" d="ms">…</p>
  _parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return [...doc.querySelectorAll('body > p, text')].map(p => {
      const isText = p.tagName === 'text';  // format cũ: <text start="s" dur="s">
      const t = isText ? Number(p.getAttribute('start')) * 1000 : Number(p.getAttribute('t') || 0);
      const d = isText ? Number(p.getAttribute('dur') || 0) * 1000 : Number(p.getAttribute('d') || 0);
      return { start: t / 1000, end: (t + d) / 1000, text: ysnDecodeEntities(p.textContent || '').replace(/\s+/g, ' ').trim() };
    }).filter(c => c.text);
  },

  // Phụ đề đích có thể lệch giờ so với phụ đề nguồn (vd. bản dịch làm cho bản video có đoạn mở đầu khác).
  // Tìm độ lệch d (giây) sao cho nhiều mốc bắt đầu câu của hai track trùng nhau nhất.
  // Trả về { offset, score } hoặc null nếu hai track không khớp (khi đó KHÔNG dùng bản dịch có sẵn).
  estimateOffset(src, tgt, { range = 60, step = 0.1, tol = 0.35 } = {}) {
    const S = src.map(c => c.start).sort((a, b) => a - b), T = tgt.map(c => c.start);
    if (S.length < 5 || T.length < 5) return null;
    const nearest = (x) => {
      let lo = 0, hi = S.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (S[m] < x) lo = m + 1; else hi = m; }
      return lo > 0 && Math.abs(S[lo - 1] - x) < Math.abs(S[lo] - x) ? S[lo - 1] : S[lo];
    };
    const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
    // chỉ dùng tối đa 400 mốc (đủ chính xác, nhanh)
    const sample = T.length > 400 ? T.filter((_, i) => i % Math.ceil(T.length / 400) === 0) : T;
    const score = (d) => { let n = 0; for (const t of sample) if (Math.abs(nearest(t + d) - t - d) < tol) n++; return n / sample.length; };
    // tinh chỉnh: lấy trung vị độ lệch của các mốc đã khớp
    const refine = (d) => {
      const r = []; for (const t of sample) { const s = nearest(t + d); if (Math.abs(s - t - d) < tol) r.push(s - t); }
      return r.length ? Math.round(median(r) * 100) / 100 : d;
    };
    const s0 = score(0);
    if (s0 >= 0.8) return { offset: refine(0), score: s0 };            // khớp sẵn (trường hợp thường gặp)
    // Cách 1: quét độ lệch, chọn chỗ nhiều mốc bắt đầu câu trùng nhau nhất (phải nổi bật hẳn so với mức ngẫu nhiên)
    const scores = [];
    let best = { offset: 0, score: s0 };
    for (let d = -range; d <= range + 1e-9; d += step) {
      const sc = score(d); scores.push(sc);
      if (sc > best.score + 1e-9) best = { offset: d, score: sc };
    }
    if (best.score >= 0.5 && best.score >= 2.5 * median(scores)) return { offset: refine(best.offset), score: best.score };
    // Cách 2: neo theo các dòng tiếng động có ở cả hai track — (Laughter)/(Cười), (Applause)/(Vỗ tay), ♪…
    const isTag = (t) => t.length < 40 && /^\s*[\[(（【♪]/.test(t) && /[\])）】♪]\s*$/.test(t);
    const A = src.filter(c => isTag(c.text)).map(c => c.start), B = tgt.filter(c => isTag(c.text)).map(c => c.start);
    if (A.length < 3 || B.length < 3) return null;
    const diffs = [];
    for (const x of A) for (const y of B) if (Math.abs(x - y) <= range) diffs.push(x - y);
    let bestD = null, cnt = 0;
    for (const d of diffs) { const c = diffs.filter(e => Math.abs(e - d) <= 1).length; if (c > cnt) { cnt = c; bestD = d; } }
    if (bestD == null || cnt < Math.max(3, 0.4 * Math.min(A.length, B.length))) return null;
    const offset = Math.round(median(diffs.filter(e => Math.abs(e - bestD) <= 1)) * 100) / 100;
    return { offset, score: cnt / Math.min(A.length, B.length), by: 'tags' };
  },

  // Bản dịch CÓ SẴN của video (phụ đề ngôn ngữ đích do người làm): ghép các dòng đích nằm chủ yếu trong
  // khoảng thời gian của từng câu nguồn. Trả về mảng (chuỗi | null) theo thứ tự câu nguồn.
  alignTranslations(src, tgt) {
    const out = new Array(src.length).fill(null);
    let j0 = 0;
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      while (j0 < tgt.length && tgt[j0].end <= s.start) j0++;
      const parts = [];
      for (let j = j0; j < tgt.length && tgt[j].start < s.end; j++) {
        const t = tgt[j], len = Math.max(0.01, t.end - t.start);
        if (Math.min(s.end, t.end) - Math.max(s.start, t.start) > 0.5 * len) parts.push(t.text);
      }
      if (parts.length) out[i] = parts.join(' ').replace(/\s+/g, ' ').trim();
    }
    return out;
  },

  // Chia lại phụ đề thành CÂU TRỌN Ý (dịch đúng nghĩa, thuyết minh đọc cả câu), bất kể phụ đề gốc cắt dòng thế nào:
  // phụ đề tự động cắt ngang câu theo khung 5–6 giây ("…But your" | "curiosity has been hijacked."), phụ đề
  // thủ công thì một dòng có khi chứa cuối câu này + đầu câu sau. Cách làm: trải chữ ra theo thời gian (thời điểm
  // từng từ nếu có, không thì ước theo vị trí ký tự trong dòng) rồi cắt ở dấu hết câu; câu quá dài thì cắt ở dấu phẩy
  // / liên từ gần cuối; phụ đề không có dấu câu thì cắt ở chỗ ngừng nói. Tag âm thanh giữa câu ([music]) bỏ đi.
  toSentences(raw, { maxWords = 40, maxDur = 18, pause = 1.4 } = {}) {
    const TAG = /[\[(（【][^\])）】]{1,40}[\])）】]|[♪♫]+/g;
    const isTagOnly = (t) => !t.replace(TAG, '').replace(/[\s.,!?…-]+/g, '');
    const out = [];
    let toks = [];                      // {t, w, lineEnd?}
    const flushTokens = () => { if (toks.length) out.push(...this._cut(toks, { maxWords, maxDur, pause })); toks = []; };
    for (const c of raw) {
      if (isTagOnly(c.text)) { flushTokens(); out.push({ start: c.start, end: c.end, text: c.text.trim() }); continue; }
      if (/^\s*[-–—]\s/.test(c.text)) flushTokens();                    // "- " = người nói khác
      const dur = Math.max(0.2, c.end - c.start);
      if (c.words?.length) {
        const ws = c.words.filter(x => !/^[\[(（【].*[\])）】]$/.test(x.w) && !/^[♪♫]+$/.test(x.w));
        ws.forEach(x => toks.push({ t: Math.min(x.t, c.end), w: x.w }));
      } else {
        const words = c.text.replace(TAG, ' ').split(/\s+/).filter(Boolean);
        const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
        let pos = 0;
        for (const w of words) { toks.push({ t: c.start + dur * (pos / total), w }); pos += w.length + 1; }
      }
      if (toks.length) toks[toks.length - 1].lineEnd = Math.max(c.end, toks[toks.length - 1].t + 0.2);
    }
    flushTokens();
    return out.filter(c => c.text).map((c, i) => ({ ...c, index: i }));
  },
  _cut(toks, { maxWords, maxDur, pause }) {
    const ABBR = /^(mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|e\.g|i\.e|no|vol|fig|approx|ca|u\.s|a\.m|p\.m)\.$/i;
    const CONJ = /^(and|but|because|so|which|who|whom|when|where|while|or|if|then|although|though|since|unless|until|và|nhưng|vì|nên|mà|khi|nếu|thì)$/i;
    const endsSent = (w, next) => /[.!?。！？…]["')\]»”’]*$/.test(w) && !ABBR.test(w) &&
      (!next || !/^[a-zà-ỹ]/.test(next.w) || /[!?。！？]["')\]»”’]*$/.test(w));          // "3 p.m. today" / "e.g. this"
    const out = [];
    let cur = [];
    const emit = (n, nextTok) => {               // n từ đầu của cur thành một câu; nextTok = từ đầu tiên của câu sau
      const part = cur.slice(0, n); cur = cur.slice(n);
      if (!part.length) return;
      const last = part[part.length - 1];
      const nextT = (cur[0] || nextTok)?.t;
      let end = last.lineEnd ?? nextT ?? last.t + 0.6;
      if (nextT != null) end = Math.min(end, nextT);
      const start = part[0].t;
      out.push({ start, end: Math.max(end, start + 0.4), text: part.map(x => x.w).join(' ').replace(/\s+([,.!?;:…])/g, '$1') });
    };
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i], next = toks[i + 1];
      // ngừng nói lâu (phụ đề không dấu câu) → hết câu
      if (cur.length >= 4 && tk.t - (cur[cur.length - 1].lineEnd ?? cur[cur.length - 1].t) > pause) emit(cur.length, tk);
      cur.push(tk);
      if (endsSent(tk.w, next)) { emit(cur.length, next); continue; }
      const tooLong = cur.length >= maxWords || (cur.length >= 6 && tk.t - cur[0].t >= maxDur);
      if (tooLong) {
        // câu dài: cắt ở dấu phẩy/chấm phẩy hoặc trước liên từ, trong nửa sau của câu
        let k = -1;
        for (let j = cur.length - 1; j >= Math.floor(cur.length * 0.45); j--) {
          if (/[,;:—–]["')\]»”’]*$/.test(cur[j].w)) { k = j + 1; break; }
          if (j > 0 && CONJ.test(cur[j].w)) { k = j; break; }
        }
        emit(k > 0 ? k : cur.length, next);
      }
    }
    emit(cur.length);
    return out;
  },

};

// Giải mã ký tự HTML (&amp; &#39; &#x27; &quot; &nbsp; …) — làm thủ công, không dùng innerHTML (YouTube bật Trusted Types).
const YSN_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
function ysnDecodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return YSN_ENTITIES[e.toLowerCase()] ?? m;
  });
}
