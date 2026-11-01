// Vẽ phụ đề lên player: tối đa 3 dòng — phiên âm, phụ đề gốc, bản dịch.
// Khi bật "tra từ", mỗi từ là một <span> bấm được; mọi cú bấm trên phụ đề bị chặn không lan xuống player.
const YSNOverlay = {
  el: null, badge: null, lastKey: '', host: null, getContainer: null, onWordClick: null, onBarAction: null, onDragEnd: null,
  setContainerProvider(fn) { this.getContainer = fn; },
  _resolveHost() {
    const fs = document.fullscreenElement;
    let host = this.getContainer ? this.getContainer() : null;
    if (fs && host && !fs.contains(host) && host.contains(fs)) host = fs; // fullscreen vào chính video/một div con
    return host;
  },
  mount() {
    const host = this._resolveHost();
    if (!host) return false;
    if (host.tagName === 'VIDEO') return false; // không thể chèn con vào <video>
    if (this.host !== host || !this.el || !host.contains(this.el)) {
      this.el?.remove();
      this.el = document.createElement('div');
      this.el.id = 'ysn-overlay';
      this._isolate(this.el);
      if (getComputedStyle(host).position === 'static') host.classList.add('ysn-host');
      host.classList.add('ysn-bar-host');
      this._watchHover(host);
      host.appendChild(this.el);
      this.host = host;
      this.lastKey = '';
      if (this.badge) { this.badge.remove(); this.badge = null; this._barKey = ''; }
      if (this._barState) queueMicrotask(() => this.setBar(this._barState));   // đổi khung (toàn màn hình) → vẽ lại thanh công cụ
    }
    return true;
  },
  // Rê chuột trên video → thêm class ysn-hover (hiện thanh công cụ, tay nắm); đứng yên 2.5s → ẩn như trình phát
  _hovered: new WeakSet(),
  _watchHover(host) {
    if (this._hovered.has(host)) return;
    this._hovered.add(host);
    let timer = 0;
    const on = () => { host.classList.add('ysn-hover'); clearTimeout(timer); timer = setTimeout(() => host.classList.remove('ysn-hover'), 2500); };
    host.addEventListener('pointermove', on, { passive: true });
    host.addEventListener('pointerdown', on, { passive: true });
    host.addEventListener('pointerleave', () => { clearTimeout(timer); host.classList.remove('ysn-hover'); });
  },
  // Chặn sự kiện chuột trên phụ đề để player không hiểu là bấm dừng/phát hoặc toàn màn hình.
  _isolate(el) {
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'contextmenu']) {
      el.addEventListener(type, (e) => {
        if (!e.target.closest?.('.ysn-line')) return;
        e.stopPropagation();
        if (type === 'mousedown' || type === 'dblclick') e.preventDefault();
        if (type === 'click') {
          const w = e.target.closest('.ysn-w');
          if (w && this.onWordClick) this.onWordClick(w, e);
        }
      });
    }
  },
  _words(text, lang, kind) {
    const frag = document.createDocumentFragment();
    let seg = null;
    try { seg = new Intl.Segmenter(lang || undefined, { granularity: 'word' }); } catch { /* trình duyệt cũ */ }
    if (!seg) { frag.append(text); return frag; }
    for (const s of seg.segment(text)) {
      if (s.isWordLike) {
        const sp = document.createElement('span');
        sp.className = 'ysn-w'; sp.dataset.kind = kind; sp.textContent = s.segment;
        frag.append(sp);
      } else frag.append(s.segment);
    }
    return frag;
  },
  // ctx: { phonetic, srcLang, tgtLang, sameLang }
  render(cue, translation, settings, ctx = {}) {
    if (!this.mount()) return;
    const s = settings;
    const showPh = s.showPhonetic && !!ctx.phonetic;
    const showOr = ctx.sameLang ? true : s.showOriginal;
    const showTr = ctx.sameLang ? false : s.showTranslation;
    const key = [cue?.index, translation, ctx.phonetic, showPh, showOr, showTr, s.fontSizePhonetic, s.fontSizeOriginal, s.fontSizeTranslated,
      s.subColor, s.subOrigColor, s.subPhoneticColor, s.subBg, s.subOrigBg, s.subBottom, s.subFont, s.subOrigFont, s.wordLookup].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.applyStyle(s);
    this.el.classList.toggle('ysn-interactive', !!s.wordLookup);
    this.el.replaceChildren();
    // sang câu mới → hiện dần rất nhanh (mượt, không giật); cùng câu mà bản dịch vừa tới thì không nháy lại dòng gốc
    this.el.classList.toggle('ysn-fresh', !!cue && cue.index !== this._lastIdx);
    this._lastIdx = cue?.index;
    if (!cue) return;
    // mỗi dòng một kiểu nền riêng: dòng dịch theo subBg, dòng gốc + phiên âm theo subOrigBg
    const bgTr = s.subBg || 'soft', bgOr = s.subOrigBg || bgTr;
    const line = (cls, size, bg) => {
      const d = document.createElement('div'); d.className = 'ysn-line ' + cls; d.style.fontSize = size + 'px'; d.dataset.bg = bg; return d;
    };
    if (showPh) {
      const p = line('ysn-phonetic', s.fontSizePhonetic || 15, bgOr);
      p.textContent = ctx.phonetic;
      this.el.appendChild(p);
    }
    if (showOr) {
      const o = ctx.sameLang ? line('ysn-translated', s.fontSizeTranslated || 24, bgTr) : line('ysn-original', s.fontSizeOriginal || 18, bgOr);
      o.dataset.lang = ctx.srcLang || '';
      if (s.wordLookup) o.append(this._words(cue.text, ctx.srcLang, 'src')); else o.textContent = cue.text;
      this.el.appendChild(o);
    }
    if (showTr) {
      const t = line('ysn-translated', s.fontSizeTranslated || 24, bgTr);
      t.dataset.lang = ctx.tgtLang || '';
      const text = translation == null ? '…' : (translation || cue.text);
      if (s.wordLookup && translation) t.append(this._words(text, ctx.tgtLang, 'tgt')); else t.textContent = text;
      this.el.appendChild(t);
    }
    const last = this.el.lastElementChild;
    if (last) last.appendChild(this._grip());
  },
  // Tay nắm kéo phụ đề lên/xuống (hiện khi rê chuột vào phụ đề); thả ra → lưu độ cao mới
  _grip() {
    const g = document.createElement('span');
    g.className = 'ysn-grip'; g.title = 'Kéo để đổi vị trí phụ đề';
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const host = this.host; if (!host) return;
      g.setPointerCapture(e.pointerId);
      const box = host.getBoundingClientRect();
      const lineH = this.el.getBoundingClientRect().bottom - e.clientY;      // giữ khoảng cách con trỏ ↔ đáy khối phụ đề
      let pct = null;
      const move = (ev) => {
        pct = Math.max(1, Math.min(70, ((box.bottom - ev.clientY - lineH) / box.height) * 100));
        this.el.style.setProperty('--ysn-bottom', pct.toFixed(1) + '%');
      };
      const up = () => {
        g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
        if (pct != null) this.onDragEnd?.(Math.round(pct));
      };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
    return g;
  },
  applyStyle(s) {
    const el = this.el; if (!el) return;
    el.style.setProperty('--ysn-tr', s.subColor || '#FFD23F');
    el.style.setProperty('--ysn-or', s.subOrigColor || '#E6E9EF');
    el.style.setProperty('--ysn-ph', s.subPhoneticColor || '#A8D8FF');
    el.style.setProperty('--ysn-bottom', (s.subBottom ?? 9) + '%');
    const fonts = {
      system: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif',
      serif: '"Cambria", "Times New Roman", "Noto Serif", serif',
      rounded: '"Nunito", "Segoe UI Rounded", "Arial Rounded MT Bold", "Segoe UI", sans-serif',
      condensed: '"Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif',
    };
    el.style.setProperty('--ysn-font', fonts[s.subFont] || fonts.system);                       // dòng dịch
    el.style.setProperty('--ysn-font-or', fonts[s.subOrigFont || s.subFont] || fonts.system);  // dòng gốc + phiên âm
    el.dataset.bg = s.subBg || 'soft';
  },
  setSpeaking(on) {
    if (this._speakingShown === !!on && this._dubBtn?.isConnected) return;
    this._speakingShown = !!on;
    this._dubBtn?.classList.toggle('live', !!on);
  },
  status(text) {
    if (!this.mount()) return;
    this.lastKey = 'status:' + text;
    this.el.replaceChildren();
    if (!text) return;
    const d = document.createElement('div');
    d.className = 'ysn-line ysn-status';
    d.textContent = text;
    this.el.appendChild(d);
  },
  // Thanh công cụ góc trên-phải của video: luôn hiện đèn "Thuyết minh" khi đang bật; rê chuột vào video
  // thì hiện thêm các nút (phụ đề, phiên âm, câu trước / nghe lại / câu sau, tự dừng, bảng câu).
  setBar(st) {
    if (!this.mount()) return;
    const key = JSON.stringify(st);
    if (this.badge && this.host.contains(this.badge) && key === this._barKey) return;
    this._barKey = key;
    if (!this.badge || !this.host.contains(this.badge)) {
      this.badge?.remove();
      this.badge = document.createElement('div');
      this.badge.id = 'ysn-dub-badge';
      this.badge.className = 'ysn-bar';
      this._isolateBar(this.badge);
      this.host.appendChild(this.badge);
    }
    const bar = this.badge;
    bar.replaceChildren();
    const ICON = {
      subs: 'M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5zM6.5 11.5h4M13 11.5h4.5M6.5 14.5h7.5',
      prev: 'M6.5 5.5v13M18 5.5l-9 6.5 9 6.5z',
      replay: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4',
      next: 'M17.5 5.5v13M6 5.5l9 6.5-9 6.5z',
      pause: 'M8.5 6v12M15.5 6v12',
      list: 'M4 6.5h16M4 12h16M4 17.5h10',
    };
    const btn = (action, title, icon, opts = {}) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ysn-b' + (opts.cls ? ' ' + opts.cls : '') + (opts.on ? ' on' : '');
      b.title = title; b.setAttribute('aria-label', title); b.dataset.action = action;
      if (opts.text) b.textContent = opts.text;
      else {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', ICON[icon]);
        svg.appendChild(p); b.appendChild(svg);
      }
      bar.appendChild(b);
      return b;
    };
    if (st.tools) {
      btn('subs', 'Phụ đề song ngữ — bật/tắt riêng tab này (Alt+Shift+S)', 'subs', { on: st.subs });
      btn('phonetic', 'Dòng phiên âm', null, { text: '/ə/', on: st.phonetic, cls: 'txt' });
      btn('prev', 'Câu trước (A)', 'prev');
      btn('replay', 'Nghe lại câu này (S)', 'replay');
      btn('next', 'Câu sau (D)', 'next');
      btn('autopause', 'Tự dừng sau mỗi câu (Q)', 'pause', { on: st.autoPause });
      btn('panel', 'Bảng câu: xem cả bài, bấm để tua, tìm kiếm', 'list', { on: st.panel });
    }
    const dub = btn('dub', st.dub ? 'Đang bật thuyết minh ở tab này — bấm để tắt (Alt+Shift+D)' : 'Bật thuyết minh cho tab này (Alt+Shift+D)', null, { text: 'Thuyết minh', cls: 'ysn-b-dub' + (st.dub ? ' dub-on' : ''), on: st.dub });
    bar.classList.toggle('has-dub', !!st.dub);
    bar.classList.toggle('no-tools', !st.tools);
    this._dubBtn = dub; this._speakingShown = null;
    return dub;
  },
  _isolateBar(el) {
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'contextmenu']) {
      el.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'mousedown' || type === 'dblclick') e.preventDefault();
        if (type === 'click') { const b = e.target.closest('.ysn-b'); if (b) this.onBarAction?.(b.dataset.action); }
      });
    }
  },
  setDubBadge(on) { this.setBar({ ...(this._barState || {}), dub: !!on }); },
  clear() { this.lastKey = ''; if (this.el) this.el.replaceChildren(); this.badge?.remove(); this.badge = null; this._barKey = ''; },
};
document.addEventListener('fullscreenchange', () => { YSNOverlay.lastKey = ''; YSNOverlay.mount(); });
