// Dòng phiên âm cho câu gốc: tính theo lô quanh vị trí đang xem (offline: espeak IPA / pinyin / Latinh hoá).
// Kết quả giữ theo nội dung câu → danh sách câu thay đổi (HLS nạp dần, chế độ trực tiếp) không bị lệch.
class YSNPhoneticTrack {
  constructor({ cues, lang, accent, onUpdate, streaming = false }) {
    this.cues = cues;
    this.lang = lang || 'en';
    this.accent = accent || 'us';
    this.onUpdate = onUpdate || (() => {});
    this.streaming = streaming;
    this.byText = new Map();
    this.results = new Array(cues.length).fill(null);
    this.cancelled = false;
    this.BATCH = 40;
  }
  setCues(cues) { this.cues = cues; this._remap(); this._wake?.(); }
  _remap() { this.results = this.cues.map(c => (this.byText.has(c.text) ? this.byText.get(c.text) : null)); }
  get done() { return this.results.every(r => r !== null); }
  _sleep(ms) { return new Promise(r => { this._wake = r; setTimeout(r, ms); }); }
  async run(getCurrentTime) {
    let failures = 0;
    while (!this.cancelled) {
      if (this.done) { if (!this.streaming) break; await this._sleep(1500); continue; }
      const t = getCurrentTime();
      let start = this.cues.findIndex(c => c.end >= t); if (start < 0) start = 0;
      const texts = [];
      const want = (i) => { const tx = this.cues[i].text; if (this.results[i] === null && !texts.includes(tx)) texts.push(tx); };
      for (let i = start; i < this.cues.length && texts.length < this.BATCH; i++) want(i);
      for (let i = 0; i < start && texts.length < this.BATCH; i++) want(i);
      if (!texts.length) { await this._sleep(300); continue; }
      try {
        const r = await chrome.runtime.sendMessage({ type: 'PHONETIC', lang: this.lang, accent: this.accent, texts });
        if (!r?.ok) throw new Error(r?.error || 'phiên âm lỗi');
        if (this.cancelled) return;
        texts.forEach((tx, k) => this.byText.set(tx, r.results[k] || ''));
        this._remap();
        failures = 0;
        this.onUpdate();
      } catch (e) {
        this.lastError = e.message;
        if (++failures >= 3) { texts.forEach(tx => this.byText.set(tx, '')); this._remap(); failures = 0; }   // bỏ qua lô lỗi, không treo
        await this._sleep(1500);
      }
    }
  }
  cancel() { this.cancelled = true; this._wake?.(); }
}
