// Popup: cài đặt nhanh + xem trước phụ đề + chọn/nghe thử/tải giọng đọc.
const $ = (id) => document.getElementById(id);
const RANGES = {
  fontSizeTranslated: v => v + 'px', fontSizeOriginal: v => v + 'px', fontSizePhonetic: v => v + 'px', subBottom: v => v + '%',
  dubRate: v => Number(v).toFixed(2) + '×', dubPitch: v => Number(v).toFixed(2) + '×',
  dubVolume: v => Math.round(v * 100) + '%', originalVolume: v => Math.round(v * 100) + '%', duckVolume: v => Math.round(v * 100) + '%',
};
const CHECKS = ['enabled', 'dubEnabled', 'hideNativeCaptions', 'muteOriginal', 'wordLookup', 'lookupPause', 'preferHumanTranslation'];
const FLAGS = ['showPhonetic', 'showOriginal', 'showTranslation'];
const PV_IPA = { us: 'ˈɛvri ɡreɪt ˈprɑːdʌkt stɑːrts wɪð ə ˈsɪŋɡəl aɪˈdiə', uk: 'ˈɛvri ɡreɪt ˈprɒdʌkt stɑːts wɪð ə ˈsɪŋɡəl aɪˈdɪə' };
const SELECTS = ['targetLang', 'subFont', 'subOrigFont'];
const SAMPLE = {
  vi: 'Xin chào, đây là giọng thuyết minh của bạn.', en: 'Hello, this is your dubbing voice.', ja: 'こんにちは、これは吹き替えの声です。',
  ko: '안녕하세요, 더빙 목소리입니다.', zh: '你好，这是你的配音声音。', fr: 'Bonjour, voici votre voix de doublage.',
  de: 'Hallo, das ist Ihre Synchronstimme.', es: 'Hola, esta es tu voz de doblaje.', th: 'สวัสดี นี่คือเสียงพากย์ของคุณ',
  ru: 'Привет, это ваш голос озвучки.', pt: 'Olá, esta é a sua voz de dublagem.', id: 'Halo, ini suara sulih suara Anda.',
};
const PREVIEW_TR = {
  vi: 'Mọi sản phẩm tuyệt vời đều bắt đầu từ một ý tưởng.', en: 'Every great product starts with a single idea.',
  ja: '素晴らしい製品はすべて一つのアイデアから始まります。', ko: '모든 훌륭한 제품은 하나의 아이디어에서 시작됩니다.',
  'zh-CN': '每一个伟大的产品都始于一个想法。', 'zh-TW': '每一個偉大的產品都始於一個想法。', fr: 'Tout grand produit commence par une seule idée.',
  de: 'Jedes großartige Produkt beginnt mit einer einzigen Idee.', es: 'Todo gran producto comienza con una sola idea.',
  th: 'ผลิตภัณฑ์ที่ยอดเยี่ยมทุกชิ้นเริ่มต้นจากความคิดเดียว', ru: 'Каждый великий продукт начинается с одной идеи.',
  pt: 'Todo grande produto começa com uma única ideia.', id: 'Setiap produk hebat dimulai dari satu ide.',
};
const GENDER = { female: 'Nữ', male: 'Nam', unknown: 'Chưa rõ' };

let voiceList = [];        // danh mục giọng cho ngôn ngữ đích
let voiceListVer = 0;      // tăng mỗi lần dựng lại danh mục (chỉ vẽ lại danh sách giọng khi cần)
let tabId = null, tabWeb = false;
let tabState = {};         // bật/tắt riêng của tab đang mở (phụ đề, thuyết minh) — đè lên cài đặt chung
let sysVoices = [];
let cloudVoices = [];
let piperCached = {};
const downloading = {};    // path → {loaded, total}
let lastState = null;

// ---------- tiện ích ----------
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }
// Gửi tới đúng khung đang có video (video thường nằm trong iframe trên các trang phim); không có thì gửi cả tab.
async function sendToTab(msg) {
  const t = await activeTab();
  if (!t?.id) return null;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_FRAME', tabId: t.id });
    if (r?.frame) {
      const res = await chrome.tabs.sendMessage(t.id, msg, { frameId: r.frame.frameId }).catch(() => undefined);
      if (res !== undefined) return res;
    }
  } catch { /* bỏ qua */ }
  try { return await chrome.tabs.sendMessage(t.id, msg); } catch { return null; }
}

// ---------- bật/tắt theo trang ----------
const KNOWN_SITES = /(^|\.)(youtube\.com|youtube-nocookie\.com|coursera\.org|udemy\.com|edx\.org|linkedin\.com|pluralsight\.com|skillshare\.com|ted\.com|vimeo\.com)$|^(localhost|127\.0\.0\.1)$/;
let tabHost = '';
function siteOn(s, host = tabHost) {
  const m = (s.siteMode || {})[host];
  return m === 'on' || (m !== 'off' && (KNOWN_SITES.test(host) || s.autoAllSites !== false));
}
function renderSite(s) {
  const row = $('siteRow');
  const web = /^https?:/.test(row.dataset.url || '');
  row.hidden = !web;
  if (!web) return;
  $('siteHost').textContent = tabHost;
  $('siteOn').checked = siteOn(s);
  row.title = siteOn(s) ? `Đang bật trên ${tabHost}. Tắt để extension không chạy ở trang này.` : `Đang tắt trên ${tabHost}.`;
}
async function toggleSite(on) {
  const s = YSNSettings.get();
  const siteMode = { ...(s.siteMode || {}) };
  const def = KNOWN_SITES.test(tabHost) || s.autoAllSites !== false;
  if (on === def) delete siteMode[tabHost]; else siteMode[tabHost] = on ? 'on' : 'off';
  await save({ siteMode });
  if (on) { const t = await activeTab(); if (t?.id) chrome.tabs.sendMessage(t.id, { type: 'YSN_DETECT_NOW' }).catch(() => {}); }
}
// Lưu cài đặt chung: giao diện đổi NGAY (không chờ ghi xong)
const save = (patch) => { const p = YSNSettings.save(patch); render(); return p.then(() => render()); };
// Bật/tắt riêng cho tab đang mở
function setTab(patch) {
  if (tabId == null || !tabWeb) { render(); return Promise.resolve(); }   // trang không có video (chrome://…): không bật được
  // bản store: hết phút miễn phí hôm nay → không bật, nhắc nâng cấp (tắt thì luôn được)
  const cur = { ...YSNSettings.get(), ...tabState };
  if (Object.keys(patch).some(k => patch[k] && !cur[k]) && YSNPlan.blocked()) { blockedNote = true; render(); return Promise.resolve(); }
  tabState = { ...tabState, ...patch };
  render();
  return chrome.runtime.sendMessage({ type: 'TAB_STATE_SET', tabId, patch }).then(r => {
    if (r?.ok) { tabState = r.state; if (r.blocked) blockedNote = true; render(); }
  }).catch(() => {});
}
// ---------- gói (bản store) ----------
let blockedNote = false;
function renderPlan() {
  const chip = $('planChip'), p = YSNPlan.get();
  chip.hidden = p.edition !== 'store';
  if (chip.hidden) return;
  chip.className = 'plan-chip' + (p.pro ? ' pro' : p.blocked ? ' out' : '');
  chip.textContent = p.pro ? 'Pro' : p.blocked ? 'Nâng cấp Pro' : `Miễn phí · còn ${Math.ceil(p.remainingMs / 60000)} phút`;
  chip.title = p.pro ? 'Song Ngữ Pro — không giới hạn' : `Miễn phí ${YSN_PRO.freeMinutes} phút mỗi ngày. Pro không giới hạn, từ ${YSN_PRO.prices.monthly}/tháng`;
}
// Thanh trượt: xem trước ngay, gộp các lần lưu trong cùng một khung hình (kéo nhanh không làm nghẽn các tab)
let pendingPatch = null;
function saveSoon(patch) {
  const first = !pendingPatch;
  pendingPatch = { ...(pendingPatch || {}), ...patch };
  if (first) requestAnimationFrame(() => { const pt = pendingPatch; pendingPatch = null; save(pt); });
}
function playUrl(url, s) {
  const a = new Audio(url); a.volume = s.dubVolume ?? 1;
  if ((s.dubPitch || 1) !== 1) { a.preservesPitch = false; a.playbackRate = s.dubPitch; }
  return a.play();
}

// ---------- hiển thị ----------
function render(s = YSNSettings.get()) {
  s = { ...s, ...tabState };                       // phụ đề / thuyết minh: theo tab đang mở
  for (const k of CHECKS) $(k).checked = !!s[k];
  for (const k of SELECTS) $(k).value = s[k];
  for (const [k, fmt] of Object.entries(RANGES)) { $(k).value = s[k]; document.querySelector(`output[data-for="${k}"]`).textContent = fmt(s[k]); }
  document.querySelectorAll('[data-setting]').forEach(g => {
    const val = s[g.dataset.setting];
    g.querySelectorAll('button').forEach(b => {
      const on = String(b.dataset.v).toLowerCase() === String(val).toLowerCase();
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);           // trình đọc màn hình biết mục đang chọn
    });
  });
  // ô "Màu khác…": sáng lên + hiện đúng màu khi người dùng chọn màu ngoài bảng có sẵn
  document.querySelectorAll('[data-color-for]').forEach(inp => {
    const v = String(s[inp.dataset.colorFor] || '').toLowerCase();
    const preset = [...inp.closest('.swatches').querySelectorAll('button')].some(b => b.dataset.v.toLowerCase() === v);
    const sw = inp.parentElement;
    sw.classList.toggle('on', !preset);
    if (preset) sw.style.removeProperty('--c'); else sw.style.setProperty('--c', v);
    if (/^#[0-9a-f]{6}$/.test(v) && document.activeElement !== inp) inp.value = v;
  });
  document.querySelectorAll('.chips button').forEach(b => b.setAttribute('aria-pressed', !!s[b.dataset.flag]));
  document.querySelectorAll('[data-when]').forEach(r => { r.hidden = !s[r.dataset.when]; });
  document.body.classList.toggle('dub-on', !!s.dubEnabled);
  const lines = [s.showPhonetic && 'phiên âm', s.showOriginal && 'gốc', s.showTranslation && 'dịch'].filter(Boolean);
  $('enabledHint').textContent = !s.enabled ? 'Đang tắt' : lines.length ? lines.join(', ').replace(/^./, c => c.toUpperCase()) : 'Chưa chọn dòng nào';
  renderPreview(s);
  renderVoices(s);
  renderSite(s);
  renderTabNote(s);
}

function renderTabNote(e) {
  const on = e.enabled !== false || !!e.dubEnabled;
  for (const k of YSN_TAB_KEYS) $(k).disabled = !tabWeb;
  const out = tabWeb && !on && YSNPlan.blocked();
  if (!out) blockedNote = false;
  $('tabNote').classList.toggle('out', out && blockedNote);
  $('tabNoteText').textContent = !tabWeb ? 'Mở một trang có video để bật'
    : out && blockedNote ? `Hết ${YSN_PRO.freeMinutes} phút miễn phí hôm nay` : on ? 'Chỉ bật ở tab này' : 'Mặc định tắt — bật riêng tab này';
  renderPlan();
}

function renderPreview(s) {
  const pv = $('preview');
  const scale = 0.58;                                     // màn chiếu nhỏ hơn video thật
  $('pvPh').style.fontSize = Math.max(8, s.fontSizePhonetic * scale) + 'px';
  $('pvOrig').style.fontSize = Math.max(9, s.fontSizeOriginal * scale) + 'px';
  $('pvTr').style.fontSize = Math.max(10, s.fontSizeTranslated * scale) + 'px';
  $('pvPh').hidden = !s.showPhonetic;
  $('pvPh').textContent = PV_IPA[s.phoneticAccent] || PV_IPA.us;
  $('pvOrig').hidden = !s.showOriginal;
  $('pvTr').hidden = !s.showTranslation;
  pv.style.setProperty('--pv-ph', s.subPhoneticColor);
  $('pvTr').textContent = PREVIEW_TR[s.targetLang] || PREVIEW_TR[(s.targetLang || '').split('-')[0]] || PREVIEW_TR.vi;
  pv.style.setProperty('--pv-tr', s.subColor);
  pv.style.setProperty('--pv-or', s.subOrigColor);
  pv.style.setProperty('--pv-bottom', Math.round(112 * (s.subBottom / 100)) + 'px');
  const fonts = { serif: '"Cambria", "Times New Roman", serif', rounded: '"Nunito", "Segoe UI Rounded", "Arial Rounded MT Bold", sans-serif', condensed: '"Arial Narrow", "Roboto Condensed", sans-serif' };
  // dòng dịch và dòng gốc (+ phiên âm) có nền / phông riêng
  const orFont = fonts[s.subOrigFont || s.subFont] || 'var(--font)', orBg = s.subOrigBg || s.subBg;
  $('pvTr').style.fontFamily = fonts[s.subFont] || 'var(--font)';
  $('pvTr').dataset.bg = s.subBg;
  for (const id of ['pvOrig', 'pvPh']) { $(id).style.fontFamily = orFont; $(id).dataset.bg = orBg; }
}

function rebuildVoiceList(s = YSNSettings.get()) {
  voiceList = ysnBuildVoiceList({ target: s.targetLang, sysVoices, cloudVoices, piperCached });
  voiceListVer++;
}

let lastVoiceKey = '';
function renderVoices(s) {
  const vk = [s.voiceId, s.dubGender, s.targetLang, s.dubEnabled, voiceListVer, JSON.stringify(downloading)].join('|');
  if (vk === lastVoiceKey) return;                 // không đổi gì liên quan tới giọng → khỏi dựng lại danh sách
  lastVoiceKey = vk;
  const ul = $('voiceList');
  ul.replaceChildren();
  const auto = ysnResolveVoice(voiceList, { ...s, voiceId: 'auto' });
  const chosen = s.voiceId === 'auto' ? auto : ysnResolveVoice(voiceList, { ...s, allowPiperDownload: true });
  $('voiceNow').textContent = s.dubEnabled ? (chosen ? `${chosen.name}${chosen.gender !== 'unknown' ? ', ' + GENDER[chosen.gender].toLowerCase() : ''}` : 'Chưa có giọng') : 'Đang tắt';

  ul.appendChild(voiceRow({
    id: 'auto', name: 'Tự động', sub: auto ? `Đang chọn ${auto.name}, ${YSN_ENGINE_INFO[auto.engine].label}` : 'Chưa có giọng phù hợp',
  }, s.voiceId === 'auto', s));
  for (const v of voiceList) ul.appendChild(voiceRow(v, s.voiceId === v.id, s));

  // gợi ý
  const g = s.dubGender;
  const ready = voiceList.filter(v => v.ready);
  let note = '';
  if (g !== 'any' && !ready.some(v => v.gender === g)) {
    const dl = voiceList.find(v => v.engine === 'piper' && v.gender === g);
    note = dl ? `Chưa có giọng ${GENDER[g].toLowerCase()} sẵn trên máy. Tải ${dl.name} (${dl.mb} MB) để dùng offline.`
              : `Ngôn ngữ này chưa có giọng ${GENDER[g].toLowerCase()} miễn phí. Nhập key Azure, Google Cloud, Gemini, OpenAI hoặc ElevenLabs ở trang Nâng cao để có thêm giọng.`;
  }
  $('voiceNote').textContent = note;
}

function voiceRow(v, on, s) {
  const li = document.createElement('li');
  li.className = 'voice' + (on ? ' on' : '');
  li.setAttribute('role', 'radio'); li.setAttribute('aria-checked', on); li.tabIndex = 0;
  const dot = document.createElement('span'); dot.className = 'dot';
  const meta = document.createElement('span'); meta.className = 'meta';
  const name = document.createElement('span'); name.className = 'name'; name.textContent = v.name;
  const sub = document.createElement('span'); sub.className = 'sub';
  if (v.id === 'auto') sub.textContent = v.sub;
  else {
    const gspan = document.createElement('span'); gspan.className = 'g'; gspan.textContent = GENDER[v.gender] || 'Chưa rõ';
    sub.append(gspan, `, ${YSN_ENGINE_INFO[v.engine].label}${v.engine === 'piper' && !v.ready ? `, ${v.mb} MB` : ''}`);
    if (v.title) li.title = v.title;
  }
  meta.append(name, sub);
  const acts = document.createElement('span'); acts.className = 'acts';
  if (v.id !== 'auto') {
    if (v.engine === 'piper' && !v.ready) {
      const d = downloading[v.path];
      const b = document.createElement('button'); b.className = 'vbtn';
      b.textContent = d ? (d.total ? Math.round(d.loaded / d.total * 100) + '%' : 'Đang tải…') : 'Tải về';
      b.disabled = !!d;
      b.addEventListener('click', (e) => { e.stopPropagation(); downloadPiper(v); });
      acts.append(b);
    } else {
      const p = document.createElement('button'); p.className = 'vbtn play'; p.title = 'Nghe thử'; p.setAttribute('aria-label', `Nghe thử ${v.name}`);
      p.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l12.5-7.5z"/></svg>';
      p.addEventListener('click', (e) => { e.stopPropagation(); previewVoice(v, p); });
      acts.append(p);
    }
  }
  li.append(dot, meta, acts);
  if (v.engine === 'piper' && downloading[v.path]) {
    const bar = document.createElement('span'); bar.className = 'progress';
    const i = document.createElement('i'); const d = downloading[v.path];
    i.style.width = d.total ? (d.loaded / d.total * 100) + '%' : '10%'; bar.append(i); li.append(bar);
  }
  const pick = () => {
    save({ voiceId: v.id });
    if (v.engine === 'piper' && !v.ready && !downloading[v.path]) downloadPiper(v);
  };
  li.addEventListener('click', pick);
  li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  return li;
}

// ---------- giọng ----------
// Danh sách giọng lần trước (lưu trong máy) → popup hiện ngay, rồi mới cập nhật danh sách mới ở nền
async function loadVoicesCached() {
  try {
    const { popupVoices: c } = await chrome.storage.local.get('popupVoices');
    if (!c || sysVoices.length) return false;
    sysVoices = c.sysVoices || []; cloudVoices = c.cloudVoices || []; piperCached = c.piperCached || {};
    rebuildVoiceList();
    return true;
  } catch { return false; }
}
async function loadVoices() {
  sysVoices = await new Promise((resolve) => {
    const v = speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 800);
  });
  sysVoices = sysVoices.map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI }));
  try { const r = await chrome.runtime.sendMessage({ type: 'LIST_CLOUD_VOICES' }); cloudVoices = r?.ok ? r.voices : []; } catch { cloudVoices = []; }
  await refreshPiper();
  chrome.storage.local.set({ popupVoices: { sysVoices, cloudVoices, piperCached, t: Date.now() } }).catch(() => {});
}

async function refreshPiper() {
  const s = YSNSettings.get();
  const paths = YSN_PIPER_VOICES.filter(v => ysnSameLang(v.lang, s.targetLang)).map(v => v.path);
  try { if (paths.length) { const r = await chrome.runtime.sendMessage({ type: 'PIPER_STATUS', paths }); if (r?.ok) piperCached = { ...piperCached, ...r.cached }; } } catch { /* ignore */ }
  rebuildVoiceList(s);
}

async function downloadPiper(v) {
  downloading[v.path] = { loaded: 0, total: 0 };
  render();
  const r = await chrome.runtime.sendMessage({ type: 'PIPER_DOWNLOAD', path: v.path }).catch(e => ({ ok: false, error: e.message }));
  delete downloading[v.path];
  if (r?.ok) piperCached[v.path] = true;
  else $('voiceNote').textContent = `Không tải được ${v.name}: ${r?.error || 'lỗi mạng'}`;
  rebuildVoiceList(); render();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'PIPER_PROGRESS' && downloading[msg.path]) {
    downloading[msg.path] = { loaded: msg.loaded, total: msg.total };
    render();
  }
});

async function previewVoice(v, btn) {
  const s = YSNSettings.get();
  const text = SAMPLE[ysnBaseLang(s.targetLang)] || SAMPLE.en;
  btn.disabled = true;
  try {
    if (v.engine === 'sys') {
      const sv = speechSynthesis.getVoices().find(x => x.voiceURI === v.uri);
      const u = new SpeechSynthesisUtterance(text);
      if (sv) { u.voice = sv; u.lang = sv.lang; }
      u.rate = s.dubRate; u.pitch = s.dubPitch; u.volume = s.dubVolume;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } else {
      const msg = v.engine === 'piper' ? { type: 'TTS_PIPER', path: v.path, rate: s.dubRate / (s.dubPitch || 1), text }
        : v.engine === 'cloud' ? { type: 'TTS_CLOUD', voice: v.cloudId, rate: v.fixedRate ? 1 : s.dubRate, pitch: v.fixedRate ? 1 : s.dubPitch, text, lang: s.targetLang }
        : { type: 'TTS_GOOGLE', lang: s.targetLang, text };
      const r = await chrome.runtime.sendMessage(msg);
      if (!r?.ok) throw new Error(r?.error || 'lỗi');
      if (v.kind === 'mms') { const a = new Audio(r.dataUrl); a.volume = s.dubVolume ?? 1; a.playbackRate = Math.max(1.3, s.dubRate); await a.play(); }
      else await playUrl(r.dataUrl, v.engine === 'cloud' ? { ...s, dubPitch: 1 } : s);
    }
  } catch (e) { $('voiceNote').textContent = `Không phát được ${v.name}: ${e.message}`; }
  finally { btn.disabled = false; }
}

// ---------- gói dịch trên máy (Translator API của Chrome) ----------
const chromeLang = (c) => { c = (c || '').toLowerCase(); if (/^zh[-_](tw|hk|hant)/.test(c)) return 'zh-Hant'; if (c.startsWith('zh')) return 'zh'; return c.split(/[-_]/)[0]; };
const LANG_VI = { en: 'Anh', vi: 'Việt', ja: 'Nhật', ko: 'Hàn', zh: 'Trung', 'zh-Hant': 'Trung (phồn thể)', fr: 'Pháp', de: 'Đức', es: 'Tây Ban Nha', th: 'Thái', ru: 'Nga', pt: 'Bồ Đào Nha', id: 'Indonesia', it: 'Ý' };
let packPair = null, packBusy = false;
async function refreshLocalPack(st) {
  const s = YSNSettings.get();
  const src = chromeLang(st?.trackLang || 'en'), tgt = chromeLang(s.targetLang);
  if (src === tgt || packBusy) { if (!packBusy) $('localPack').hidden = true; return; }
  if (packPair === src + tgt && !$('localPack').dataset.status) return;
  packPair = src + tgt;
  let status = 'unsupported';
  try { const r = await chrome.runtime.sendMessage({ type: 'LOCAL_AVAILABILITY', source: src, target: tgt }); status = r?.status || status; } catch { /* ignore */ }
  const card = $('localPack');
  card.hidden = !(status === 'downloadable' || status === 'downloading');
  card.dataset.status = card.hidden ? '' : status;
  $('localPackText').textContent = `Tải gói ${LANG_VI[src] || src} → ${LANG_VI[tgt] || tgt} một lần, sau đó dịch offline, không giới hạn, không bị chặn.`;
  $('localPackBtn').dataset.src = src; $('localPackBtn').dataset.tgt = tgt;
}
async function downloadLocalPack() {
  const b = $('localPackBtn');
  if (typeof Translator === 'undefined') { $('localPackText').textContent = 'Chrome này chưa hỗ trợ dịch trên máy.'; return; }
  packBusy = true; b.disabled = true; b.textContent = 'Đang tải…';
  try {
    const tr = await Translator.create({
      sourceLanguage: b.dataset.src, targetLanguage: b.dataset.tgt,
      monitor(m) { m.addEventListener('downloadprogress', (e) => { b.textContent = `Đang tải ${Math.round((e.loaded || 0) * 100)}%`; }); },
    });
    await tr.translate('ok');
    $('localPackText').textContent = 'Đã tải xong. Phụ đề sẽ được dịch trên máy.';
    b.textContent = 'Xong';
    sendToTab({ type: 'RETRY_TRANSLATE' });
    setTimeout(() => { $('localPack').hidden = true; packBusy = false; }, 1500);
  } catch (e) {
    packBusy = false; b.disabled = false; b.textContent = 'Thử lại';
    $('localPackText').textContent = 'Chưa tải được gói dịch: ' + e.message;
  }
}

// ---------- trạng thái trang ----------
async function refreshStatus() {
  const st = await sendToTab({ type: 'GET_STATE' });
  lastState = st;
  const el = $('status');
  el.className = 'status';
  $('exportSrt').disabled = !st?.cues;
  $('openPanel').disabled = !st?.hasVideo;
  if (!st) {
    const e = { ...YSNSettings.get(), ...tabState };
    el.textContent = !siteOn(YSNSettings.get()) ? 'Đang tắt trên trang này'
      : tabWeb && e.enabled === false && !e.dubEnabled ? 'Tab này đang tắt — bật công tắc bên dưới'
      : 'Mở một trang có video (YouTube, Coursera, Udemy, phim…) để bắt đầu';
    refreshLocalPack(null); return;
  }
  const site = { youtube: 'YouTube', udemy: 'Udemy', generic: 'trang này' }[st.site] || st.site;
  const msgs = {
    idle: 'Chưa thấy video', disabled: 'Tab này đang tắt — bật công tắc bên dưới', loading: 'Đang tìm phụ đề…', 'site-off': 'Đang tắt trên trang này',
    novideo: 'Chưa thấy video, bấm phát rồi chờ vài giây',
    nocaptions: st.error || 'Video không có phụ đề', error: st.error || 'Có lỗi',
    translating: st.translateError && /chặn/.test(st.translateError) ? 'Google đang tạm chặn, hãy tải gói dịch trên máy' : `Đang dịch ${st.translated}/${st.cues} câu trên ${site}`,
    ready: st.mode === 'live' ? `Đang dịch trực tiếp phụ đề của trình phát${st.cues ? ', ' + st.cues + ' câu' : ''}`
      : st.sameLang ? `Video đã là ngôn ngữ đích, ${st.cues} câu`
      : st.human ? `${st.cues} câu, ${st.human} câu dùng bản dịch có sẵn của video` : `Đã dịch ${st.cues} câu trên ${site}`,
  };
  el.textContent = msgs[st.status] || st.status;
  if (st.noDub && { ...YSNSettings.get(), ...tabState }.dubEnabled && (st.status === 'ready' || st.status === 'translating')) el.textContent += ' · video nói đúng ngôn ngữ đích nên giữ tiếng gốc, không thuyết minh';
  if (st.status === 'ready') el.classList.add('ok');
  if (st.status === 'nocaptions' || st.status === 'error') el.classList.add('err');
  if (st.translateError || st.engineError) { el.classList.add('warn'); el.title = st.translateError || st.engineError; }
  refreshLocalPack(st);
  if (st.voice && { ...YSNSettings.get(), ...tabState }.dubEnabled) $('voiceNow').textContent = `${st.voice.name}${st.voice.gender !== 'unknown' ? ', ' + GENDER[st.voice.gender].toLowerCase() : ''}`;
}

// ---------- khởi tạo ----------
const perf = window.__ysnPerf = {};                 // ms kể từ lúc trang popup bắt đầu tải (đo độ nhanh)
const mark = (k) => { perf[k] ??= Math.round(performance.now()); };
(async () => {
  const sel = $('targetLang');
  YSN_LANGS.forEach(([code, name]) => { const o = document.createElement('option'); o.value = code; o.textContent = name; sel.appendChild(o); });

  // Gắn sự kiện TRƯỚC (bấm được ngay khi popup vừa hiện, không chờ tải giọng / trạng thái)
  for (const k of CHECKS) $(k).addEventListener('change', e => (YSN_TAB_KEYS.includes(k) ? setTab : save)({ [k]: e.target.checked }));
  for (const k of SELECTS) $(k).addEventListener('change', async e => { await save({ [k]: e.target.value }); if (k === 'targetLang') { await refreshPiper(); render(); } });
  for (const k of Object.keys(RANGES)) {
    $(k).addEventListener('input', e => {
      const v = Number(e.target.value);
      document.querySelector(`output[data-for="${k}"]`).textContent = RANGES[k](v);
      saveSoon({ [k]: v });
    });
  }
  document.querySelectorAll('.chips button').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.flag; save({ [k]: !YSNSettings.get()[k] });
  }));
  $('localPackBtn').addEventListener('click', downloadLocalPack);
  document.querySelectorAll('[data-setting]').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    save({ [g.dataset.setting]: b.dataset.v });
  }));
  document.querySelectorAll('[data-color-for]').forEach(inp => inp.addEventListener('input', () => {
    saveSoon({ [inp.dataset.colorFor]: inp.value.toUpperCase() });
  }));
  // Chỉnh kiểu chữ cho dòng dịch hay dòng gốc (nhớ lựa chọn cho lần mở popup sau)
  const showLine = (line, flash) => {
    document.querySelectorAll('#styleLine button').forEach(b => {
      const on = b.dataset.line === line; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('[data-line-group]').forEach(g => { g.hidden = g.dataset.lineGroup !== line; });
    try { localStorage.setItem('ysnStyleLine', line); } catch { /* bỏ qua */ }
    if (!flash) return;
    const el = $(line === 'or' ? 'pvOrig' : 'pvTr');           // nháy nhẹ dòng đang chỉnh trong màn xem trước
    el.classList.remove('pv-focus'); void el.offsetWidth; el.classList.add('pv-focus');
  };
  $('styleLine').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showLine(b.dataset.line, true); });
  try { if (localStorage.getItem('ysnStyleLine') === 'or') showLine('or'); } catch { /* bỏ qua */ }
  document.querySelectorAll('.tabs button').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => { x.setAttribute('aria-selected', x === t); x.tabIndex = x === t ? 0 : -1; });
    document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== t.dataset.tab; });
  }));
  // Thanh tab theo chuẩn ARIA: chỉ tab đang chọn nhận phím Tab; ←/→/Home/End chuyển tab
  document.querySelectorAll('[role="tablist"]').forEach(list => list.addEventListener('keydown', e => {
    const all = [...list.querySelectorAll('[role="tab"]')], i = all.indexOf(e.target);
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (i < 0 || j === undefined) return;
    e.preventDefault();
    const t = all[(j + all.length) % all.length]; t.focus(); t.click();
  }));
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('planChip').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#pro') }); window.close(); });
  YSNPlan.onChange(() => render());
  YSNPlan.load().then(() => render());
  if (YSN_EDITION === 'store') chrome.runtime.sendMessage({ type: 'PLAN_GET' }).catch(() => {});   // kiểm tra mã định kỳ ở nền
  $('siteOn').addEventListener('change', (e) => toggleSite(e.target.checked));
  $('openPanel').addEventListener('click', async () => { await sendToTab({ type: 'PANEL' }); window.close(); });
  $('exportSrt').addEventListener('click', async () => {
    const r = await sendToTab({ type: 'EXPORT_SRT' });
    if (!r?.srt) return;
    const url = URL.createObjectURL(new Blob([r.srt], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(r.videoId || 'phude').replace(/[^\w.-]+/g, '_')}.song-ngu.srt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  mark('listeners');

  const [, tab] = await Promise.all([YSNSettings.load(), activeTab()]);
  try { const u = new URL(tab?.url || ''); tabHost = u.hostname; $('siteRow').dataset.url = u.href; tabWeb = /^https?:$/.test(u.protocol); } catch { tabHost = ''; }
  tabId = tab?.id ?? null;
  if (tabWeb && tabId != null) {
    try { const r = await chrome.runtime.sendMessage({ type: 'TAB_STATE_GET', tabId }); tabState = r?.state || {}; } catch { /* bỏ qua */ }
  }
  await loadVoicesCached();
  render(); mark('settings');
  refreshStatus().then(() => mark('status'));
  setInterval(refreshStatus, 1500);
  loadVoices().then(() => { render(); mark('voices'); });
})();
