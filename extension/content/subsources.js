// Nguồn phụ đề cho trang bất kỳ (ngoài YouTube/Udemy có adapter riêng):
//  1) textTracks của <video> — kể cả HLS/DASH nạp cue dần theo đoạn (hls.js, video.js, Shaka…)
//  2) <track src> và các file phụ đề trang đã tải (.vtt .srt .ass .ttml .json — theo Resource Timing)
//  3) chế độ TRỰC TIẾP: đọc phụ đề trình phát tự vẽ lên trang (Netflix, JW Player, ArtPlayer, Vimeo…)

// ---------- đọc nhiều định dạng phụ đề ----------
const YSNSubParse = {
  any(text) {
    const t = (text || '').replace(/^﻿/, '');
    if (/^\s*\[Script Info\]/m.test(t) || /^Dialogue:\s*\d/m.test(t)) return this.ass(t);
    if (/<tt[\s>]/.test(t.slice(0, 4000))) return this.ttml(t);
    if (/^\s*[\[{]/.test(t)) { try { const j = this.json(JSON.parse(t)); if (j.length) return j; } catch { /* không phải JSON */ } }
    return YSNVtt.parse(t);                                         // WebVTT và SRT
  },
  _clean(s) {
    return ysnDecodeEntities(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  },
  // Advanced SubStation Alpha (.ass/.ssa)
  ass(t) {
    const out = []; let inEvents = false, fmt = null;
    const time = (x) => { const m = x.trim().match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/); return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : NaN; };
    for (const line of t.split(/\r?\n/)) {
      if (/^\[.*\]\s*$/.test(line)) { inEvents = /^\[Events\]/i.test(line); fmt = null; continue; }
      if (!inEvents) continue;
      if (/^Format:/i.test(line)) { fmt = line.slice(7).split(',').map(x => x.trim().toLowerCase()); continue; }
      if (!/^Dialogue:/i.test(line)) continue;
      const f = fmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const parts = line.slice(9).split(',');
      const head = parts.slice(0, f.length - 1), body = parts.slice(f.length - 1).join(',');
      const get = (k) => head[f.indexOf(k)];
      const text = this._clean(body.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, ' ').replace(/\\h/g, ' '));
      const start = time(get('start') || ''), end = time(get('end') || '');
      if (text && end > start) out.push({ start, end, text });
    }
    return out.sort((a, b) => a.start - b.start);
  },
  // TTML / DFXP (Netflix, Prime, nhiều trình phát truyền hình)
  ttml(t) {
    const tick = +(t.match(/tickRate="(\d+)"/) || [])[1] || 10000000;
    const fps = +(t.match(/frameRate="(\d+)"/) || [])[1] || 30;
    const time = (x) => {
      if (!x) return NaN;
      let m = x.match(/^([\d.]+)(h|ms|m|s|t|f)$/);
      if (m) { const v = parseFloat(m[1]); return { h: v * 3600, m: v * 60, s: v, ms: v / 1000, t: v / tick, f: v / fps }[m[2]]; }
      m = x.match(/^(\d+):(\d{2}):(\d{2})(?:([.:])(\d+))?$/);
      if (!m) return NaN;
      const base = +m[1] * 3600 + +m[2] * 60 + +m[3];
      return m[4] === ':' ? base + +m[5] / fps : base + (m[5] ? parseFloat('0.' + m[5]) : 0);
    };
    const out = [];
    for (const m of t.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const attr = (k) => (m[1].match(new RegExp(`\\b${k}="([^"]+)"`)) || [])[1];
      const start = time(attr('begin'));
      let end = time(attr('end'));
      if (!(end > start)) end = start + time(attr('dur'));
      const text = this._clean(m[2]);
      if (text && end > start) out.push({ start, end, text });
    }
    return out.sort((a, b) => a.start - b.start);
  },
  // JSON: Bilibili {body:[{from,to,content}]}, YouTube json3 {events}, mảng [{start,end,text}] …
  json(d) {
    if (d?.events) return (d.events || []).filter(e => e.segs).map(e => ({ start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs || 0)) / 1000, text: this._clean(e.segs.map(s => s.utf8).join('')) })).filter(c => c.text);
    const arr = Array.isArray(d) ? d : (d?.body || d?.cues || d?.captions || d?.subtitles || d?.items || d?.data || []);
    if (!Array.isArray(arr) || !arr.length) return [];
    const pick = (o, ks) => { for (const k of ks) if (o[k] != null) return o[k]; };
    const ms = Object.keys(arr[0]).some(k => /ms$/i.test(k));
    const out = arr.map(o => {
      let s = pick(o, ['from', 'start', 'startTime', 'begin', 'startMs', 'start_ms', 'startTimeMs']);
      let e = pick(o, ['to', 'end', 'endTime', 'stop', 'endMs', 'end_ms', 'endTimeMs']);
      const dur = pick(o, ['dur', 'duration', 'durationMs']);
      const text = this._clean(pick(o, ['content', 'text', 'caption', 'line', 'value']) || '');
      if (typeof s === 'string' && s.includes(':')) s = YSNVtt._sec?.(s) ?? NaN;
      if (typeof e === 'string' && e.includes(':')) e = YSNVtt._sec?.(e) ?? NaN;
      s = +s; e = e != null ? +e : s + +(dur || 0);
      return { start: s, end: e, text };
    }).filter(c => c.text && c.end > c.start);
    const scale = ms || (out.length && out[out.length - 1].end > 36000) ? 1000 : 1;   // > 10 giờ → chắc là mili-giây
    return out.map(c => ({ start: c.start / scale, end: c.end / scale, text: c.text })).sort((a, b) => a.start - b.start);
  },
};

// ---------- đoán ngôn ngữ từ URL / nhãn ----------
const YSN_LANG_HINTS = {
  en: ['en', 'eng', 'english', 'en-us', 'en-gb', 'en_us', 'en_gb'], vi: ['vi', 'vie', 'vietnamese', 'tiengviet', 'vi-vn', 'vi_vn'],
  ja: ['ja', 'jpn', 'japanese'], ko: ['ko', 'kor', 'korean'], zh: ['zh', 'chi', 'zho', 'chinese', 'zh-cn', 'zh-tw', 'zh-hans', 'zh-hant', 'chs', 'cht'],
  fr: ['fr', 'fre', 'fra', 'french'], de: ['de', 'ger', 'deu', 'german'], es: ['es', 'spa', 'spanish', 'es-es', 'es-419'],
  ru: ['ru', 'rus', 'russian'], pt: ['pt', 'por', 'portuguese', 'pt-br'], id: ['id', 'ind', 'indonesian'], th: ['th', 'tha', 'thai'],
  it: ['it', 'ita', 'italian'], ar: ['ar', 'ara', 'arabic'], hi: ['hi', 'hin', 'hindi'], tr: ['tr', 'tur', 'turkish'],
};
function ysnLangFromString(s) {
  const toks = String(s || '').toLowerCase().split(/[^a-z0-9-_]+/).flatMap(x => [x, ...x.split(/[-_]/)]);
  for (const [code, names] of Object.entries(YSN_LANG_HINTS)) if (names.some(n => toks.includes(n))) return code;
  return null;
}

// ---------- dò nguồn phụ đề ----------
const YSNSubSources = {
  // textTracks có thể dùng (phụ đề / CC), sắp theo ưu tiên: không phải ngôn ngữ đích, đang bật, tiếng Anh
  rankTracks(video, targetLang) {
    const tgt = (targetLang || '').split('-')[0];
    const subs = [...(video.textTracks || [])].filter(t => t.kind === 'subtitles' || t.kind === 'captions' || (!t.kind && t.label));
    const lang = (t) => (t.language || ysnLangFromString(t.label) || '').split('-')[0].toLowerCase();
    const score = (t) => (lang(t) && lang(t) !== tgt ? 8 : 0) + (t.mode === 'showing' ? 4 : 0) + (lang(t) === 'en' ? 2 : 0) + (t.cues?.length ? 1 : 0);
    return subs.sort((a, b) => score(b) - score(a));
  },
  readTrack(tt) {
    return [...(tt.cues || [])].map(c => ({ start: c.startTime, end: c.endTime, text: YSNSubParse._clean(c.text || '') }))
      .filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
  },
  // File phụ đề trang đã tải; bỏ các mảnh HLS (nhiều file đánh số trong cùng thư mục — đã có ở textTracks)
  resourceUrls() {
    const urls = [...new Set(performance.getEntriesByType('resource').map(e => e.name))].filter(u =>
      /\.(vtt|webvtt|srt|ass|ssa|ttml2?|dfxp)(\?|#|$)/i.test(u) ||
      (/(subtit|caption|texttrack|timedtext)/i.test(u) && !/\.(m3u8|mpd|m4s|ts|mp4|m4a|aac|webm|js|mjs|css|png|jpe?g|gif|svg|webp|woff2?|html?)(\?|#|$)/i.test(u)));
    const dir = (u) => u.split('?')[0].replace(/[^/]*$/, '');
    const count = {}; urls.forEach(u => { count[dir(u)] = (count[dir(u)] || 0) + 1; });
    return urls.filter(u => count[dir(u)] <= 4 || !/\d+\.(vtt|webvtt)(\?|$)/i.test(u.split('#')[0]));
  },
  async fetchText(url) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (r.ok) return await r.text();
    } catch { /* CORS → nhờ service worker */ }
    return ysnFetchText(url);
  },
  // Chọn 1 file phụ đề theo ngôn ngữ (không phải ngôn ngữ đích, ưu tiên tiếng Anh)
  pickUrl(urls, targetLang, extraLang = () => null) {
    const tgt = (targetLang || '').split('-')[0];
    const lang = (u) => extraLang(u) || ysnLangFromString(decodeURIComponent(u.split('/').slice(3).join('/')));
    const score = (u) => { const l = lang(u); return (l && l !== tgt ? 6 : l ? 0 : 3) + (l === 'en' ? 2 : 0); };
    return [...urls].sort((a, b) => score(b) - score(a))[0] || null;
  },
};

// ---------- phụ đề trình phát tự vẽ (chế độ trực tiếp) ----------
const YSN_CAPTION_SELECTORS = [
  '.player-timedtext-text-container',                       // Netflix
  '.jw-text-track-container', '.jw-captions',                // JW Player
  '.art-subtitle',                                           // ArtPlayer
  '.shaka-text-container',                                   // Shaka Player
  '.vp-captions',                                            // Vimeo
  '.dss-subtitle-renderer-wrapper',                          // Disney+
  '.atvwebplayersdk-captions-text',                          // Prime Video
  '[data-testid="CueBoxContainer"]',                         // Max
  '.bpx-player-subtitle-panel-text', '.bilibili-player-video-subtitle',   // Bilibili
  '.dplayer-subtitle', '.xgplayer-subtitle', '.mejs__captions-layer', '.mejs-captions-layer',
  '.fp-captions', '.plyr__captions', '.vjs-text-track-display', '.ytp-caption-window-container',
  '[class*="subtitle" i]:not(video):not(track)', '[class*="caption" i]:not(video):not(track)',
];

class YSNLiveCaptions {
  constructor(video, container) { this.video = video; this.container = container; this.last = ''; this.el = null; }
  // Phần tử phụ đề nằm trên video (cùng player), có chữ ngắn như phụ đề
  static find(video, container) {
    const vr = video.getBoundingClientRect();
    const near = container?.parentElement || container;
    for (const sel of YSN_CAPTION_SELECTORS) {
      const generic = sel.startsWith('[class*=');
      // bộ chọn chung chung chỉ tìm trong player; bộ chọn của trình phát quen thuộc tìm cả trang (phụ đề có thể nằm ngoài)
      const roots = generic ? [near].filter(Boolean) : [near, document].filter(Boolean);
      for (const root of roots) {
        for (const el of root.querySelectorAll(sel)) {
          if (el.closest('#ysn-overlay, #ysn-lookup, .ysn-panel, .ysn-bar')) continue;
          if (el.querySelector('button, input, a, video, img')) continue;
          const r = el.getBoundingClientRect();
          const over = r.width > 0 && r.left < vr.right && r.right > vr.left && r.top < vr.bottom + 4 && r.bottom > vr.top;
          const inside = near && near.contains(el);
          const txt = (el.textContent || '').trim();
          if ((over || (inside && !r.width)) && txt.length < 400) return el;
        }
      }
    }
    return null;
  }
  start(onText) {
    this.onText = onText;
    let lastFind = 0;
    const read = () => {
      if ((!this.el || !this.el.isConnected) && performance.now() - lastFind > 1500) {
        lastFind = performance.now();
        this.el = YSNLiveCaptions.find(this.video, this.container);
        this.el?.classList.add('ysn-live-src');                 // để ẩn phụ đề gốc (vẫn giữ chữ để đọc)
      }
      const el = this.el?.isConnected ? this.el : null;
      const txt = el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (txt !== this.last) { this.last = txt; this.onText(txt); }
    };
    this.mo = new MutationObserver(() => { clearTimeout(this.deb); this.deb = setTimeout(read, 60); });
    const root = this.container || document.body;
    this.mo.observe(root, { childList: true, subtree: true, characterData: true });
    this.timer = setInterval(read, 700);                    // phòng trường hợp phụ đề nằm ngoài container
    read();
  }
  stop() { this.mo?.disconnect(); clearInterval(this.timer); clearTimeout(this.deb); this.el?.classList.remove('ysn-live-src'); }
  // Có phụ đề tự vẽ đang hiện chữ không (dùng khi dò nguồn)
  static hasText(video, container) { const el = YSNLiveCaptions.find(video, container); return !!(el && el.textContent.trim()); }
}

// Theo dõi một textTrack nạp cue dần (HLS/DASH): báo khi danh sách cue thay đổi.
class YSNTrackStream {
  constructor(video, track) { this.video = video; this.track = track; this.sig = ''; }
  read() { return YSNSubSources.readTrack(this.track); }
  start(onChange) {
    const check = () => {
      if (this.track.mode === 'disabled') this.track.mode = 'hidden';   // trình phát tắt track → vẫn cần cue
      const c = this.track.cues;
      const sig = c && c.length ? `${c.length}|${c[0].startTime}|${c[c.length - 1].startTime}` : '0';
      if (sig !== this.sig) { this.sig = sig; onChange(this.read()); }
    };
    this.timer = setInterval(check, 1000);
    check();
  }
  stop() { clearInterval(this.timer); }
}
