// Tiện ích khi xem/học: bảng câu (danh sách cả bài, bấm để tua, tìm kiếm), câu trước / nghe lại / câu sau,
// tự dừng sau mỗi câu, phím tắt A/S/D/Q. main.js gọi các hàm update/onIndex/onTranslations/onTick.
const YSNPanel = {
  state: null, el: null, list: null, rows: [], open: false, autoScroll: true, query: '', pauseScrollUntil: 0,
  autoPause: false, pausedFor: -1,

  // ---------- điều hướng theo câu ----------
  _video() { return this.state?.video || null; },
  _cueIndexAt(t) {
    const st = this.state; if (!st?.cues.length) return -1;
    if (st.mode === 'live') return st.liveIndex;
    const i = st.findCueIndex?.(t) ?? -1;
    if (i >= 0) return i;
    // giữa hai câu → câu vừa qua
    let k = -1; for (let j = 0; j < st.cues.length && st.cues[j].start <= t; j++) k = j;
    return k;
  },
  seekTo(i, play = true) {
    const st = this.state, v = this._video();
    if (!st || !v || i < 0 || i >= st.cues.length) return;
    v.currentTime = Math.max(0, st.cues[i].start - 0.05);
    if (st.dubber) { st.dubber.stop(); st.dubber.lastSpokenIndex = -1; }
    this.pausedFor = -1;
    if (play && v.paused) v.play().catch(() => {});
  },
  prev() {
    const v = this._video(); if (!v) return;
    const i = this._cueIndexAt(v.currentTime);
    const cue = this.state.cues[i];
    // đang ở giữa câu (>1.2s) → về đầu câu này; ngược lại → câu trước
    this.seekTo(cue && v.currentTime - cue.start > 1.2 ? i : Math.max(0, i - 1));
  },
  replay() { const v = this._video(); if (v) this.seekTo(Math.max(0, this._cueIndexAt(v.currentTime))); },
  next() {
    const v = this._video(); if (!v) return;
    const st = this.state, t = v.currentTime;
    const i = st.cues.findIndex(c => c.start > t + 0.05);
    if (i >= 0) this.seekTo(i);
  },
  toggleAutoPause(force) {
    this.autoPause = force ?? !this.autoPause;
    this.pausedFor = -1;
    this.toast(this.autoPause ? 'Tự dừng sau mỗi câu: BẬT (Q để tắt, S nghe lại, D câu sau)' : 'Tự dừng sau mỗi câu: TẮT');
    this.apBtn?.setAttribute('aria-pressed', this.autoPause);
    this.refreshBar();
  },
  // gọi mỗi khung hình: tự dừng khi hết câu (chờ thuyết minh đọc xong câu đó)
  onTick(t, idx) {
    if (!this.autoPause || this.state?.mode === 'live') return;
    const st = this.state, v = this._video();
    if (!v || v.paused || v.seeking) return;
    const i = idx >= 0 ? idx : this._cueIndexAt(t);
    const cue = st.cues[i];
    if (!cue || this.pausedFor === i) return;
    if (t >= cue.end - 0.12) {
      if (st.dubber?.speaking) return;                 // để giọng đọc nói hết câu
      this.pausedFor = i;
      v.pause();
    }
  },

  // ---------- thông báo nhỏ trên video ----------
  toast(text, ms = 1800) {
    const host = YSNOverlay.host; if (!host) return;
    let t = host.querySelector(':scope > .ysn-toast');
    if (!t) { t = document.createElement('div'); t.className = 'ysn-toast'; host.appendChild(t); }
    t.textContent = text; t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  },

  refreshBar() {
    const s = YSNSettings.get();
    YSNOverlay._barState = { tools: s.showToolbar !== false && !!this.state?.video, subs: !!s.enabled, phonetic: !!s.showPhonetic, dub: !!s.dubEnabled, autoPause: this.autoPause, panel: this.open };
    YSNOverlay.setBar(YSNOverlay._barState);
  },

  // ---------- bảng câu ----------
  toggle(state, force) {
    this.state = state || this.state;
    this.open = force ?? !this.open;
    if (this.open) { this._build(); this._fill(); this.onIndex(this.state.currentIndex, this.state, true); }
    else this.el?.remove();
    this.refreshBar();
  },
  _build() {
    if (this.el && this.el.isConnected) return;
    const el = document.createElement('div');
    el.id = 'ysn-panel';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Bảng câu song ngữ');
    const head = document.createElement('div'); head.className = 'yp-head';
    const title = document.createElement('div'); title.className = 'yp-title'; title.textContent = 'Bảng câu';
    this.countEl = document.createElement('span'); this.countEl.className = 'yp-count'; title.appendChild(this.countEl);
    const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'yp-chip';
    const setFollow = () => { follow.textContent = this.autoScroll ? 'Tự cuộn: bật' : 'Tự cuộn: tắt'; follow.setAttribute('aria-pressed', this.autoScroll); };
    follow.addEventListener('click', () => { this.autoScroll = !this.autoScroll; setFollow(); if (this.autoScroll) this.onIndex(this.state.currentIndex, this.state, true); });
    setFollow();
    const close = document.createElement('button'); close.type = 'button'; close.className = 'yp-x'; close.textContent = '✕'; close.title = 'Đóng'; close.setAttribute('aria-label', 'Đóng bảng câu');
    close.addEventListener('click', () => this.toggle(null, false));
    head.append(title, follow, close);
    const search = document.createElement('input');
    search.type = 'search'; search.className = 'yp-search'; search.placeholder = 'Tìm trong phụ đề (gốc hoặc bản dịch)…';
    search.addEventListener('input', () => { this.query = search.value; this._filter(); });
    const list = document.createElement('div'); list.className = 'yp-list';
    list.addEventListener('click', (e) => { const r = e.target.closest('.yp-row'); if (r) this.seekTo(+r.dataset.i); });
    for (const ev of ['wheel', 'touchmove', 'pointerdown']) list.addEventListener(ev, () => { this.pauseScrollUntil = performance.now() + 4000; }, { passive: true });
    const foot = document.createElement('div'); foot.className = 'yp-foot';
    const fb = (label, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.addEventListener('click', fn); foot.appendChild(b); return b; };
    fb('◀ Câu trước', 'Phím A', () => this.prev());
    fb('↺ Nghe lại', 'Phím S', () => this.replay());
    fb('Câu sau ▶', 'Phím D', () => this.next());
    this.apBtn = fb('Tự dừng', 'Dừng sau mỗi câu — phím Q', () => this.toggleAutoPause());
    el.append(head, search, list, foot);
    // chặn sự kiện lọt xuống trình phát khi bảng nằm trong khung toàn màn hình
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel', 'contextmenu']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    this.el = el; this.list = list; this.search = search;
    this._place();
  },
  // Đặt bảng: thường thì nổi bên phải trang; toàn màn hình thì nằm trong khung đang toàn màn hình
  _place() {
    if (!this.el) return;
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.body;
    this.el.classList.toggle('yp-in-fs', parent !== document.body);
    this.el.classList.toggle('yp-in-frame', window !== window.top);
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  },
  _fmt(sec) {
    sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  },
  _fill() {
    const st = this.state; if (!this.list || !st) return;
    const tr = st.translator?.translations || [];
    const rows = [];
    const frag = document.createDocumentFragment();
    st.cues.forEach((c, i) => {
      const r = document.createElement('div'); r.className = 'yp-row'; r.dataset.i = i;
      const time = document.createElement('span'); time.className = 'yp-time'; time.textContent = this._fmt(c.start);
      const o = document.createElement('span'); o.className = 'yp-or'; o.textContent = c.text;
      const t = document.createElement('span'); t.className = 'yp-tr'; t.textContent = st.sameLang ? '' : (tr[i] ?? '…');
      r.append(time, o, t); frag.appendChild(r); rows.push({ r, t, text: c.text, trText: tr[i] ?? null });
    });
    this.list.replaceChildren(frag);
    this.rows = rows; this._activeRow = null;
    this.countEl.textContent = st.cues.length ? ` · ${st.cues.length} câu` : '';
    this.apBtn?.setAttribute('aria-pressed', this.autoPause);
    if (this.query) this._filter();
  },
  _norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); },
  _filter() {
    const q = this._norm(this.query.trim());
    for (const row of this.rows) row.r.hidden = !!q && !this._norm(row.text + ' ' + (row.trText || '')).includes(q);
  },
  // danh sách câu đổi (stream / live) → dựng lại (live: chỉ thêm dòng mới)
  update(state) {
    this.state = state;
    this.refreshBar();
    if (!this.open || !this.list) return;
    if (state.mode === 'live' && this.rows.length && this.rows.length < state.cues.length && this.rows[0].text === state.cues[0]?.text) {
      const tr = state.translator?.translations || [];
      for (let i = this.rows.length; i < state.cues.length; i++) {
        const c = state.cues[i];
        const r = document.createElement('div'); r.className = 'yp-row'; r.dataset.i = i;
        const time = document.createElement('span'); time.className = 'yp-time'; time.textContent = this._fmt(c.start);
        const o = document.createElement('span'); o.className = 'yp-or'; o.textContent = c.text;
        const t = document.createElement('span'); t.className = 'yp-tr'; t.textContent = tr[i] ?? '…';
        r.append(time, o, t); this.list.appendChild(r); this.rows.push({ r, t, text: c.text, trText: tr[i] ?? null });
      }
      this.countEl.textContent = ` · ${state.cues.length} câu`;
      return;
    }
    this._fill();
  },
  onTranslations(state) {
    if (!this.open || !this.rows.length) return;
    const tr = state.translator?.translations || [];
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i], v = tr[i] ?? null;
      if (v !== row.trText) { row.trText = v; row.t.textContent = state.sameLang ? '' : (v ?? '…'); }
    }
  },
  onIndex(idx, state, force = false) {
    if (!this.open || !this.rows.length) return;
    const row = this.rows[idx]?.r;
    if (this._activeRow && this._activeRow !== row) this._activeRow.classList.remove('on');
    if (!row) return;
    row.classList.add('on'); this._activeRow = row;
    if ((this.autoScroll && performance.now() > this.pauseScrollUntil) || force) {
      const l = this.list, top = row.offsetTop - l.clientHeight * 0.35;
      l.scrollTo({ top, behavior: force ? 'auto' : 'smooth' });
    }
  },
  applySettings(s, state) { this.state = state || this.state; this.refreshBar(); },
};
window.YSNPanel = YSNPanel;
document.addEventListener('fullscreenchange', () => YSNPanel._place());

// Phím học (không cần giữ phím nào): A câu trước · S nghe lại · D câu sau · Q tự dừng. Bỏ qua khi đang gõ chữ.
window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
  const st = YSNPanel.state;
  if (!st?.video || !st.cues.length || YSNSettings.get().learningKeys === false || YSNLookup.isOpen) return;
  const el = e.composedPath ? e.composedPath()[0] : e.target;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''))) return;
  // Chỉ bắt phím khi người dùng đang ở video — không nuốt phím tắt chữ cái của phần khác trên trang
  const host = YSNOverlay.host;
  const atVideo = YSNPanel.open || !!document.fullscreenElement ||
    (host && (host.matches(':hover') || host.contains(document.activeElement) || document.activeElement === st.video));
  if (!atVideo) return;
  const k = e.key.toLowerCase();
  const act = { a: () => YSNPanel.prev(), s: () => YSNPanel.replay(), d: () => YSNPanel.next(), q: () => YSNPanel.toggleAutoPause() }[k];
  if (!act || e.shiftKey) return;
  e.preventDefault(); e.stopPropagation();
  act();
}, true);
