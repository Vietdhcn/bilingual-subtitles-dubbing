// Cài đặt người dùng (chrome.storage.local, chép sang sync) + default + bật/tắt theo tab. Dùng chung cho content/popup.
if (typeof window !== 'undefined') window.__ysnLoaded = true;   // đánh dấu: phần chính đã nạp trong khung này
const YSN_DEFAULT_SETTINGS = {
  enabled: false,             // bật phụ đề song ngữ — luôn theo TỪNG TAB, mặc định tắt (xem YSN_TAB_DEFAULTS)
  targetLang: 'vi',
  showPhonetic: false,        // dòng phiên âm (IPA / pinyin / Latinh hoá) của câu gốc
  showOriginal: true,         // dòng phụ đề gốc
  showTranslation: true,      // dòng bản dịch
  fontSizePhonetic: 15,       // px dòng phiên âm
  subPhoneticColor: '#A8D8FF',
  phoneticAccent: 'us',       // phiên âm tiếng Anh: 'us' (Anh-Mỹ) | 'uk' (Anh-Anh)
  mergeSentences: true,       // gom các dòng ngắn thành câu trọn vẹn
  preferHumanTranslation: true, // video có sẵn phụ đề ngôn ngữ đích (người làm) → dùng thay dịch máy
  wordLookup: true,           // bấm vào chữ trong phụ đề để tra phiên âm, phát âm, nghĩa
  lookupPause: true,          // tạm dừng video khi đang tra từ
  fontSizeOriginal: 18,       // px dòng gốc
  fontSizeTranslated: 24,     // px dòng dịch
  hideNativeCaptions: true,
  subColor: '#FFD23F',        // màu dòng dịch
  subOrigColor: '#E6E9EF',    // màu dòng gốc
  subBg: 'soft',              // nền dòng dịch: 'none' (viền chữ) | 'soft' (nền mờ) | 'solid' (nền đậm)
  subOrigBg: 'soft',          // nền dòng gốc (+ phiên âm) — chỉnh riêng, khác dòng dịch được
  subBottom: 9,               // khoảng cách từ đáy video (% chiều cao)
  subFont: 'system',          // phông dòng dịch: 'system' | 'serif' | 'rounded' | 'condensed'
  subOrigFont: 'system',      // phông dòng gốc (+ phiên âm)
  dubEnabled: false,
  voiceId: 'auto',            // 'auto' | 'piper:<model>' | 'sys:<voiceURI>' | 'google' | 'cloud:<id>' (xem voices.js)
  dubPitch: 1.0,              // cao độ giọng đọc (0.8 trầm … 1.25 cao)
  dubGender: 'female',        // 'any' | 'female' | 'male'
  dubRate: 1.0,
  dubMaxRate: 1.5,
  dubVolume: 1.0,             // âm lượng giọng dịch (0..1)
  originalVolume: 1.0,        // âm lượng tiếng gốc khi KHÔNG đang thuyết minh (0..1)
  duckVolume: 0.15,           // âm lượng tiếng gốc KHI đang thuyết minh (0..1)
  muteOriginal: false,
  devMode: false,             // kênh postMessage cho công cụ test (bật trong trang Nâng cao)
  showToolbar: true,          // thanh nút nhỏ góc trên-phải video (hiện khi rê chuột)
  learningKeys: true,         // phím A/S/D/Q: câu trước / nghe lại / câu sau / tự dừng
  autoAllSites: true,         // tự bật trên mọi trang có video (ngoài YouTube/Coursera/Udemy…)
  siteMode: {},               // { 'tên-miền': 'on' | 'off' } — bật/tắt riêng từng trang
};

const YSN_LANGS = [
  ['vi', 'Tiếng Việt'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文 (简体)'],
  ['zh-TW', '中文 (繁體)'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['th', 'ไทย'],
  ['ru', 'Русский'], ['pt', 'Português'], ['id', 'Bahasa Indonesia'],
];

// Đoán giới tính giọng từ tên (Web Speech API không cung cấp trường gender).
const YSN_VOICE_FEMALE = /hoai ?my|female|woman|zira|aria|jenny|michelle|ana\b|emma|sonia|libby|maisie|natasha|hazel|susan|linda|heera|nanami|sun-?hi|xiaoxiao|yunxi(?!a)|hiu ?gaai|denise|katja|elvira|dalia|premwadee|svetlana|francisca|gadis|samantha|victoria|karen|moira|tessa|fiona|veena|kyoko|yuna|ting-?ting|mei-?jia|sin-?ji|google (us|uk) english female|female/i;
const YSN_VOICE_MALE = /nam ?minh|microsoft an\b|male|man\b|david|mark|guy|ryan|christopher|eric|brian|andrew|george|thomas|william|liam|steffan|roger|tony|keita|injoon|yunyang|wanlung|henri|conrad|alvaro|jorge|niwat|dmitry|antonio|ardi|daniel|alex\b|fred|rishi|aaron|arthur|google (us|uk) english male/i;
function ysnGuessGender(voice) {
  const n = voice.name || '';
  if (YSN_VOICE_FEMALE.test(n) && !/\bmale\b/i.test(n)) return 'female';
  if (YSN_VOICE_MALE.test(n)) return 'male';
  return 'unknown';
}

// Chạy trong trang web (content script) hay trong trang của tiện ích (popup, cài đặt)
const YSN_IN_PAGE = typeof location !== 'undefined' && location.protocol !== 'chrome-extension:';
// Các cài đặt bật/tắt được RIÊNG TỪNG TAB. Mặc định TẮT: tab nào người dùng bật thì tab đó mới chạy.
const YSN_TAB_KEYS = ['enabled', 'dubEnabled'];
const YSN_TAB_DEFAULTS = { enabled: false, dubEnabled: false };

const YSNSettings = {
  _cache: null,
  _tab: {},
  _listeners: new Set(),
  _migrate(s) {
    // v0.1 chỉ có fontSize → tách thành 2 cỡ
    if (s.fontSize && !s.fontSizeTranslated) { s.fontSizeTranslated = s.fontSize; s.fontSizeOriginal = Math.round(s.fontSize * 0.78); }
    delete s.fontSize;
    // v0.3 → v0.4: displayMode → 3 công tắc riêng
    if (s.displayMode) {
      s.showOriginal = s.displayMode !== 'translated';
      s.showTranslation = s.displayMode !== 'original';
      delete s.displayMode;
    }
    // v0.2 → v0.3: dubEngine/dubVoice/dubCloudVoice → voiceId
    if (!s.voiceId && s.dubEngine) {
      if (s.dubEngine === 'cloud' && s.dubCloudVoice) s.voiceId = 'cloud:' + s.dubCloudVoice;
      else if (s.dubEngine === 'webspeech' && s.dubVoice) s.voiceId = 'sys:' + s.dubVoice;
      else if (s.dubEngine === 'google') s.voiceId = 'google';
      else s.voiceId = 'auto';
    }
    delete s.dubEngine; delete s.dubVoice; delete s.dubCloudVoice; delete s.dubEdgeVoice;
    // v0.5.8 → v0.5.9: nền + phông tách riêng cho dòng gốc — giữ nguyên kiểu người dùng đã chọn trước đó
    if (s.subBg && !s.subOrigBg) s.subOrigBg = s.subBg;
    if (s.subFont && !s.subOrigFont) s.subOrigFont = s.subFont;
    return s;
  },
  // Cài đặt chung lưu ở storage.local (ghi nhanh, không giới hạn số lần ghi; service worker tự chép sang storage.sync
  // để đồng bộ máy khác). Trước đây ghi thẳng storage.sync: kéo thanh trượt vài giây là vượt 120 lần ghi/phút → mọi nút
  // bấm sau đó bị từ chối trong 1 phút ("bấm không ăn").
  // Bật/tắt phụ đề + thuyết minh có thể RIÊNG TỪNG TAB (_tab, do service worker giữ theo tab) — đè lên cài đặt chung.
  async load() {
    let { settings } = await chrome.storage.local.get('settings');
    if (!settings) {                                               // bản cũ chỉ có ở storage.sync → chuyển sang
      try { ({ settings } = await chrome.storage.sync.get('settings')); } catch { /* bỏ qua */ }
      if (settings) chrome.storage.local.set({ settings }).catch(() => {});
    }
    this._cache = { ...YSN_DEFAULT_SETTINGS, ...this._migrate(settings || {}) };
    if (YSN_IN_PAGE) {
      try { const r = await chrome.runtime.sendMessage({ type: 'TAB_STATE_GET' }); this._tab = r?.state || {}; } catch { /* bỏ qua */ }
    }
    return this.get();
  },
  get() { return { ...(this._cache || YSN_DEFAULT_SETTINGS), ...YSN_TAB_DEFAULTS, ...this._tab }; },
  global() { return { ...(this._cache || YSN_DEFAULT_SETTINGS) }; },
  // Đổi cài đặt chung: áp dụng NGAY trong trang này (không chờ storage), rồi lưu → các trang khác tự cập nhật
  async save(patch) {
    // trong trang web: phụ đề / thuyết minh là của riêng tab → chuyển sang saveTab
    if (YSN_IN_PAGE && YSN_TAB_KEYS.some(k => k in patch)) {
      const tab = {}, rest = { ...patch };
      for (const k of YSN_TAB_KEYS) if (k in rest) { tab[k] = rest[k]; delete rest[k]; }
      // lưu cài đặt chung TRƯỚC: bật tab làm tiện ích khởi động lại và đọc cài đặt đã lưu — làm ngược lại thì nó đọc phải bản cũ
      if (Object.keys(rest).length) await this.save(rest);
      return this.saveTab(tab);
    }
    const prev = this.get();
    this._cache = { ...this.global(), ...patch };
    this._emit(prev);
    await chrome.storage.local.set({ settings: this._cache });
    return this.get();
  },
  // Bật/tắt riêng cho tab này (content script). Áp dụng ngay, service worker báo cho các khung khác của tab.
  // Bản store: hết phút miễn phí hôm nay → không bật (tắt thì luôn được), gọi onBlocked để trang hiện lời mời nâng cấp.
  // force: tắt do hết giờ (không qua kiểm tra).
  onBlocked: null,
  async saveTab(patch, { force = false } = {}) {
    const prev = this.get();
    const turningOn = Object.keys(patch).some(k => patch[k] && !prev[k]);
    if (turningOn && !force && typeof YSNPlan !== 'undefined' && YSNPlan.blocked()) { this.onBlocked?.(); return prev; }
    this._tab = { ...this._tab, ...patch };
    this._emit(prev);
    try {
      const r = await chrome.runtime.sendMessage({ type: 'TAB_STATE_SET', patch, force });
      if (r?.blocked) { const p2 = this.get(); this._tab = r.state || {}; this._emit(p2); this.onBlocked?.(); }   // service worker chặn
    } catch { /* bỏ qua */ }
    return this.get();
  },
  onChange(fn) { this._listeners.add(fn); },
  _emit(prev) {
    const next = this.get();
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    this._listeners.forEach(fn => { try { fn(next, prev); } catch (e) { console.warn('[YSN] settings listener', e); } });
  },
  _init() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) {
        const prev = this.get();
        this._cache = { ...YSN_DEFAULT_SETTINGS, ...this._migrate(changes.settings.newValue || {}) };
        this._emit(prev);
      }
    });
    if (YSN_IN_PAGE) chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'TAB_STATE') return;
      const prev = this.get();
      this._tab = msg.state || {};
      this._emit(prev);
    });
  },
};
YSNSettings._init();
