// Dịch trên máy NGAY TRONG TRANG (Translator API của Chrome theo từng trang web): không phụ thuộc Google,
// không bị chặn. Chrome chỉ cho trang dùng gói dịch sau một cú bấm của người dùng (lần đầu trên mỗi trang).
const YSNPageTranslator = {
  _tr: new Map(),
  _lang(c) { c = (c || '').toLowerCase(); if (/^zh[-_](tw|hk|hant)/.test(c)) return 'zh-Hant'; if (c.startsWith('zh')) return 'zh'; return c.split(/[-_]/)[0]; },
  async status(src, tgt) {
    if (typeof Translator === 'undefined' || !src || src === 'auto') return 'unsupported';
    try { return await Translator.availability({ sourceLanguage: this._lang(src), targetLanguage: this._lang(tgt) }); } catch { return 'unavailable'; }
  },
  async needsGesture(src, tgt) { const s = await this.status(src, tgt); return s === 'downloadable' || s === 'downloading'; },
  // gọi trong lúc người dùng vừa bấm (có user activation)
  enable(src, tgt) {
    const key = this._lang(src) + '|' + this._lang(tgt);
    const p = Translator.create({ sourceLanguage: this._lang(src), targetLanguage: this._lang(tgt) });
    this._tr.set(key, p); p.catch(() => this._tr.delete(key));
    return p;
  },
  async translate(texts, src, tgt) {
    if (typeof Translator === 'undefined' || !src || src === 'auto') return null;
    const key = this._lang(src) + '|' + this._lang(tgt);
    try {
      if (!this._tr.has(key)) {
        if ((await this.status(src, tgt)) !== 'available') return null;
        this.enable(src, tgt);
      }
      const tr = await this._tr.get(key);
      const out = [];
      for (const t of texts) out.push(t && t.trim() ? (await tr.translate(t)).trim() : '');
      return out;
    } catch { this._tr.delete(key); return null; }
  },
};

// Hàng đợi dịch: ưu tiên các câu gần vị trí đang xem, có cache theo video.
// Bản dịch được giữ THEO NỘI DUNG câu (Map text → bản dịch): danh sách câu có thể lớn dần / thay đổi
// (HLS nạp dần, chế độ trực tiếp) mà không lệch bản dịch; câu lặp lại chỉ dịch một lần.
class YSNTranslator {
  constructor({ videoId, cues, sourceLang, targetLang, onUpdate, streaming = false }) {
    this.videoId = videoId;
    this.cues = cues;
    this.sourceLang = sourceLang || 'auto';
    this.targetLang = targetLang;
    this.onUpdate = onUpdate || (() => {});
    this.streaming = streaming;          // danh sách câu còn thay đổi → không thoát khi dịch xong, không lưu cache
    this.passthrough = false;            // cùng ngôn ngữ đích → bản "dịch" chính là câu gốc
    this.byText = new Map();
    this.pendingText = new Set();
    this.translations = new Array(cues.length).fill(null);
    this.cancelled = false;
    this.cacheKey = `cache:v2:${videoId}:${this.sourceLang}:${targetLang}`;   // v2: chia câu mới
    this.BATCH = 20;
  }

  setCues(cues) { this.cues = cues; this._remap(); this._wake(); }

  // Bản dịch có sẵn của video (người làm): ưu tiên hơn dịch máy, không bị dịch máy ghi đè
  seedHuman(cues, aligned) {
    this.humanTexts ||= new Set();
    let n = 0;
    cues.forEach((c, i) => { if (aligned[i]) { this.byText.set(c.text, this._tidy(aligned[i])); this.humanTexts.add(c.text); n++; } });
    this.human = n;
    this._remap();
    this.onUpdate();
    return n;
  }
  _remap() { this.translations = this.cues.map(c => (this.byText.has(c.text) ? this.byText.get(c.text) : null)); }

  async loadCache() {
    const got = await chrome.storage.local.get(this.cacheKey);
    const raw = got[this.cacheKey];
    const cached = Array.isArray(raw) ? raw : raw?.tr;              // v0.1 lưu mảng trần
    if (cached && cached.length === this.cues.length) {
      this.cues.forEach((c, i) => { if (cached[i] != null) this.byText.set(c.text, this._tidy(cached[i])); });
      this._remap();
      this.onUpdate();
      YSNTranslator._touch(this.cacheKey);
      return this.done;
    }
    return false;
  }

  async saveCache() {
    try {
      await chrome.storage.local.set({ [this.cacheKey]: { t: Date.now(), tr: this.translations } });
      await YSNTranslator._touch(this.cacheKey);
    } catch (e) { console.warn('[YSN] cache save', e); }
  }

  // Chỉ mục LRU (giữ tối đa 150 video): service worker cập nhật tuần tự — nhiều tab cùng lưu không ghi đè nhau.
  static async _touch(key) {
    try { await chrome.runtime.sendMessage({ type: 'CACHE_TOUCH', key }); } catch { /* tiện ích vừa tải lại */ }
  }

  get done() { return this.translations.every(t => t !== null); }
  get progress() { return this.translations.filter(t => t !== null).length; }

  _sleep(ms) {
    return new Promise(r => {
      const done = () => { clearTimeout(timer); this._wakers?.delete(done); r(); };
      const timer = setTimeout(done, ms);
      (this._wakers ||= new Set()).add(done);
    });
  }
  _wake() { for (const w of [...(this._wakers || [])]) w(); }

  // Chọn câu cần dịch: "gấp" = câu đang chiếu + 3 câu kế (tua tới đoạn chưa dịch → dịch ngay chỗ đó, không chờ lô khác),
  // "nền" = lần lượt từ chỗ đang xem về cuối, rồi phần trước đó.
  _pick(urgent) {
    const t = this._getT?.() || 0;
    let startIdx = this.cues.findIndex(c => c.end >= t);
    if (startIdx < 0) startIdx = 0;
    const texts = [];
    const want = (i) => {
      const tx = this.cues[i]?.text;
      if (tx && this.translations[i] === null && !this.pendingText.has(tx) && !texts.includes(tx)) texts.push(tx);
    };
    if (urgent) { for (let i = Math.max(0, startIdx - 1); i < Math.min(this.cues.length, startIdx + 4); i++) want(i); return texts; }
    for (let i = startIdx; i < this.cues.length && texts.length < this.BATCH; i++) want(i);
    for (let i = 0; i < startIdx && texts.length < this.BATCH; i++) want(i);
    return texts;
  }

  async _translate(texts) {
    texts.forEach(tx => this.pendingText.add(tx));
    try {
      let results;
      if (this.passthrough) results = texts;
      else if ((results = await YSNPageTranslator.translate(texts, this.sourceLang, this.targetLang))) this.provider = 'chrome';
      else {
        const resp = await chrome.runtime.sendMessage({ type: 'TRANSLATE', texts, source: this.sourceLang, target: this.targetLang });
        if (!resp?.ok) {
          // gói dịch trên máy đã có trong Chrome nhưng trang này chưa được bật → cần 1 cú bấm của người dùng
          this.needsLocalGesture = await YSNPageTranslator.needsGesture(this.sourceLang, this.targetLang);
          throw new Error(resp?.error || 'translate error');
        }
        this.provider = resp.provider;
        results = resp.results;
      }
      if (this.cancelled) return true;
      this.lastError = null;
      texts.forEach((tx, k) => { if (!this.humanTexts?.has(tx)) this.byText.set(tx, this._tidy(results[k] ?? '')); });
      this._remap();
      this.failures = 0;
      this.onUpdate();
      return true;
    } catch (e) {
      console.warn('[YSN] batch failed', e.message);
      this.lastError = e.message;
      this.failures = (this.failures || 0) + 1;
      this.onUpdate();
      return false;
    } finally {
      texts.forEach(tx => this.pendingText.delete(tx));
    }
  }

  // Hai luồng song song: luồng gấp lo câu đang chiếu (nhỏ, nhanh), luồng nền dịch dần cả bài.
  async run(getCurrentTime) {
    this._getT = getCurrentTime;
    if (!this.streaming && await this.loadCache()) return;
    const lane = async (urgent) => {
      while (!this.cancelled) {
        if (this.done) { if (!this.streaming) return; await this._sleep(1500); continue; }
        if (this.failures && Date.now() < (this._retryAt || 0)) { await this._sleep(Math.min(1000, this._retryAt - Date.now())); continue; }
        const texts = this._pick(urgent);
        if (!texts.length) { await this._sleep(urgent ? 200 : 300); continue; }
        const ok = await this._translate(texts);
        // backoff khi lỗi: 2s, 4s, 8s … tối đa 30s (chung cho cả hai luồng)
        if (!ok) this._retryAt = Date.now() + Math.min(30000, 2000 * 2 ** Math.min((this.failures || 1) - 1, 4));
      }
    };
    await Promise.all([lane(true), lane(false)]);
    if (this.done && !this.streaming && !this.passthrough && !this.cancelled) await this.saveCache();
  }

  // Bản dịch máy đôi khi để dấu cách trước dấu câu ("một mình .", "( ví dụ )") → bỏ (trừ tiếng Pháp: có cách trước ! ? : ;)
  _tidy(t) {
    if (!t || /^fr/i.test(this.targetLang || '')) return t;
    return t.replace(/\s+([.,!?;:…%)\]}”])/g, '$1').replace(/([(\[{“])\s+/g, '$1');
  }

  // Thử lại ngay (vd. vừa tải xong gói dịch trên máy)
  nudge() { this.failures = 0; this._retryAt = 0; this._wake(); }
  cancel() { this.cancelled = true; this._wake(); }
}
