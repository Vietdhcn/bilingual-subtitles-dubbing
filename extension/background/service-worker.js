importScripts('../edition.js', 'license.js', 'cloud-tts.js');

// Kênh test chỉ bật khi thư mục extension có dev-mode.json {"devChannel": true} (trang web không thể tạo file này).
(async () => {
  let on = false;
  try { const r = await fetch(chrome.runtime.getURL('dev-mode.json')); if (r.ok) on = !!(await r.json()).devChannel; } catch { /* không có file */ }
  await chrome.storage.local.set({ devChannel: on });
})();

// Service worker: xử lý mọi request ra ngoài (dịch, TTS) để content script không bị CORS.
// Messages:
//   {type:'TRANSLATE', texts:[], source, target}  -> {ok, results:[], provider, error?}
//   {type:'TTS_GOOGLE', text, lang}               -> {ok, dataUrl}
//   {type:'CLEAR_CACHE'}                          -> {ok, removed}
//   {type:'GET_OPTIONS'}                          -> {ok, options}
//   {type:'RELOAD'}                               -> nạp lại extension (dev)

const DEFAULT_OPTIONS = {
  provider: 'auto',            // 'auto' (Google → Azure nếu có key) | 'google' | 'azure' | 'claude'
  azureTranslatorKey: '', azureTranslatorRegion: '',
  claudeApiKey: '',
  claudeModel: 'claude-sonnet-5-5',
  claudeBatchSize: 30,
  ttsProvider: 'azure',        // 'azure' | 'gcloud' | 'gemini' | 'openai' | 'elevenlabs' — engine "Giọng online"
  azureKey: '', azureRegion: 'southeastasia',
  gcloudKey: '',
  geminiKey: '', geminiTtsModel: 'gemini-3.8-flash-tts',
  openaiKey: '', openaiTtsModel: 'gpt-4o-mini-tts',
  elevenKey: '', elevenModel: 'eleven_v4_turbo',
  ttsStyle: '',                // cách đọc (Gemini/OpenAI); trống = YSN_TTS_STYLE_DEFAULT trong cloud-tts.js
};

async function getOptions() {
  const stored = await chrome.storage.sync.get('options');
  return { ...DEFAULT_OPTIONS, ...(stored.options || {}) };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const LANG_NAMES = { vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', fr: 'French', de: 'German', es: 'Spanish', th: 'Thai', ru: 'Russian', pt: 'Portuguese', id: 'Indonesian' };

// ---------- Google Translate (free, không cần key) ----------
// Endpoint /translate_a/t nhận nhiều q trong một request → giảm số request ~25 lần so với /single.
class RateLimitError extends Error {}

// Ngắt mạch: khi Google báo chặn (429/403 hoặc trả trang "Sorry"), ngừng gọi Google 20 phút —
// không thử lại dồn dập (tránh làm mạng người dùng bị chặn nặng hơn).
const GOOGLE_PAUSE_MS = 20 * 60 * 1000;
async function googleBlockedUntil() { return (await chrome.storage.session.get('googleBlockedUntil')).googleBlockedUntil || 0; }
async function googleCheck(res) {
  const ct = res.headers.get('content-type') || '';
  if (res.status === 429 || res.status === 403 || (res.ok && /text\/html/.test(ct))) {
    await chrome.storage.session.set({ googleBlockedUntil: Date.now() + GOOGLE_PAUSE_MS });
    throw new RateLimitError('Google đang tạm chặn mạng của bạn (thử lại sau 20 phút)');
  }
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
}
async function googleGuard() {
  const until = await googleBlockedUntil();
  if (Date.now() < until) throw new RateLimitError(`Google đang tạm chặn, thử lại sau ${Math.ceil((until - Date.now()) / 60000)} phút`);
}

async function translateGoogleBatch(texts, source, target) {
  await googleGuard();
  const url = `https://translate.googleapis.com/translate_a/t?client=gtx&sl=${encodeURIComponent(source || 'auto')}&tl=${encodeURIComponent(target)}`;
  const body = new URLSearchParams();
  texts.forEach(t => body.append('q', t));
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
  await googleCheck(res);
  const data = await res.json();
  // sl cụ thể → ["t1","t2"]; sl=auto → [["t1","en"],["t2","en"]]; 1 phần tử → có thể là chuỗi
  const arr = Array.isArray(data) ? data : [data];
  const out = arr.map(x => Array.isArray(x) ? x[0] : x);
  if (out.length !== texts.length) throw new Error(`Google trả về ${out.length}/${texts.length} câu`);
  return out.map(s => (s || '').trim());
}

// Nhận diện ngôn ngữ của vài câu: trình duyệt (LanguageDetector, offline) → Google (sl=auto) dự phòng
async function detectLanguage(texts) {
  const sample = texts.filter(t => t && t.trim()).slice(0, 12);
  if (!sample.length) return null;
  try { const r = await toOffscreen({ type: 'DETECT_LANG', texts: sample }); if (r.lang) return r.lang; } catch { /* không có API */ }
  try {
    await googleGuard();
    const url = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=en';
    const body = new URLSearchParams(); sample.slice(0, 5).forEach(t => body.append('q', t));
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body });
    await googleCheck(res);
    const data = await res.json();
    const langs = (Array.isArray(data) ? data : [data]).map(x => Array.isArray(x) ? x[1] : null).filter(Boolean);
    const count = {}; langs.forEach(l => { count[l] = (count[l] || 0) + 1; });
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null;
  } catch { return null; }
}

async function translateGoogle(texts, source, target) {
  const out = new Array(texts.length).fill(null);
  const B = 25;
  for (let i = 0; i < texts.length; i += B) {
    const slice = texts.slice(i, i + B);
    const got = await translateGoogleBatch(slice, source, target);   // bị chặn → dừng ngay, không thử lại
    got.forEach((t, k) => { out[i + k] = t; });
  }
  return out;
}

// ---------- Azure Translator (API chính thức của Microsoft, key của người dùng; gói F0 miễn phí 2 triệu ký tự/tháng) ----------
const AZ_LANG = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', 'pt-BR': 'pt' };
async function translateAzure(texts, source, target, opts) {
  if (!opts.azureTranslatorKey) throw new Error('Chưa nhập Azure Translator key');
  const out = new Array(texts.length).fill(null);
  const B = 100;
  for (let i = 0; i < texts.length; i += B) {
    const slice = texts.slice(i, i + B);
    const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
    url.searchParams.set('api-version', '3.0'); url.searchParams.set('to', AZ_LANG[target] || target);
    if (source && source !== 'auto') url.searchParams.set('from', AZ_LANG[source] || source);
    const headers = { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': opts.azureTranslatorKey };
    if (opts.azureTranslatorRegion) headers['Ocp-Apim-Subscription-Region'] = opts.azureTranslatorRegion;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(slice.map(Text => ({ Text }))) });
    if (res.status === 429) throw new RateLimitError('Azure 429');
    if (!res.ok) throw new Error(`Azure Translator HTTP ${res.status}`);
    (await res.json()).forEach((d, k) => { out[i + k] = (d?.translations?.[0]?.text || '').trim(); });
  }
  return out;
}

// ---------- Claude API (người dùng tự nhập key) ----------
async function translateClaude(texts, source, target, opts) {
  if (!opts.claudeApiKey) throw new Error('Chưa nhập Claude API key trong Options');
  const out = new Array(texts.length);
  const B = Math.max(5, Math.min(60, opts.claudeBatchSize | 0 || 30));
  for (let start = 0; start < texts.length; start += B) {
    const batch = texts.slice(start, start + B);
    const prompt =
`You are subtitling a video. Translate each line into ${LANG_NAMES[target] || target}.
Keep the same number of items and the same order. Keep translations concise enough to read as subtitles.
Use context from neighbouring lines for consistent terminology. Return ONLY a JSON array of strings.

${JSON.stringify(batch)}`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.claudeApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: opts.claudeModel, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    let arr;
    try { const m = text.match(/\[[\s\S]*\]/); arr = JSON.parse(m ? m[0] : text); }
    catch { throw new Error('Claude trả về không phải JSON'); }
    for (let k = 0; k < batch.length; k++) out[start + k] = typeof arr[k] === 'string' ? arr[k] : null;
  }
  return out;
}

// Chuỗi nguồn dịch: Chrome (trên máy) → Google → Azure (nếu có key); Claude khi người dùng chọn.
async function translateLocal(texts, source, target) {
  const r = await toOffscreen({ type: 'LOCAL_TRANSLATE', texts, source, target }).catch(e => ({ ok: false, error: e.message }));
  if (!r?.ok) throw Object.assign(new Error(r?.error || 'dịch trên máy lỗi'), { code: r?.code });
  return r.results;
}
async function translate(texts, source, target, opts) {
  const hasAzure = !!opts.azureTranslatorKey;
  let order = opts.provider === 'claude' ? ['claude', 'chrome', 'google', 'azure']
    : opts.provider === 'azure' ? ['azure', 'chrome', 'google']
    : opts.provider === 'google' ? ['google', 'chrome', 'azure']
    : ['chrome', 'google', 'azure'];                          // 'auto' và 'chrome'
  order = order.filter(p => p !== 'azure' || hasAzure);
  const errors = []; let localStatus = null;
  for (const p of order) {
    try {
      const results = p === 'claude' ? await translateClaude(texts, source, target, opts)
        : p === 'azure' ? await translateAzure(texts, source, target, opts)
        : p === 'chrome' ? await translateLocal(texts, source, target)
        : await translateGoogle(texts, source, target);
      return { results, provider: p, errors, localStatus };
    } catch (e) {
      if (p === 'chrome') localStatus = e.code || 'error';
      errors.push(`${p}: ${e.message}`);
      console.warn('[YSN] provider failed', p, e.message);
    }
  }
  return { results: null, provider: null, errors, localStatus };
}

// ---------- Google TTS (translate_tts) ----------
// Giọng Google (translate_tts) có cầu dao RIÊNG, ngắn (3 phút): bị giới hạn dịch không kéo theo mất giọng đọc và ngược lại.
async function ttsGoogle(text, lang) {
  const until = (await chrome.storage.session.get('googleTtsBlockedUntil')).googleTtsBlockedUntil || 0;
  if (Date.now() < until) throw new RateLimitError(`Giọng Google đang tạm chặn, thử lại sau ${Math.ceil((until - Date.now()) / 60000)} phút`);
  const url = new URL('https://translate.google.com/translate_tts');
  url.searchParams.set('ie', 'UTF-8');
  url.searchParams.set('client', 'tw-ob');
  url.searchParams.set('tl', lang);
  url.searchParams.set('q', text.slice(0, 200));
  const res = await fetch(url.toString());
  const ct = res.headers.get('content-type') || '';
  if (res.status === 429 || res.status === 403 || (res.ok && /text\/html/.test(ct))) {
    await chrome.storage.session.set({ googleTtsBlockedUntil: Date.now() + 3 * 60000 });
    throw new RateLimitError('Giọng Google đang tạm chặn (thử lại sau 3 phút)');
  }
  if (!res.ok) throw new Error(`Google TTS HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:audio/mpeg;base64,' + btoa(bin);
}

// ---------- Tra từ ----------
// Tiếng Anh: Free Dictionary API (dữ liệu Wiktionary, CC BY-SA) cho phiên âm, file phát âm thật, định nghĩa.
// Nghĩa tiếng Việt + bản dịch định nghĩa: qua chuỗi dịch (ưu tiên dịch trên máy). IPA dự phòng: espeak offline.
const POS_VI = { noun: 'danh từ', verb: 'động từ', adjective: 'tính từ', adverb: 'trạng từ', pronoun: 'đại từ',
  preposition: 'giới từ', conjunction: 'liên từ', interjection: 'thán từ', determiner: 'từ hạn định', exclamation: 'thán từ',
  article: 'mạo từ', numeral: 'số từ', particle: 'tiểu từ', abbreviation: 'viết tắt', phrase: 'cụm từ' };
async function lookupWord({ word, source, target, accent = 'us' }) {
  const opts = await getOptions();
  const base = (source || '').toLowerCase().split(/[-_]/)[0];
  const entry = { word, source, target, phonetics: [], meanings: [], translation: '', provider: null, dict: null };
  if (base === 'en' && /^[a-z][a-z'-]*$/i.test(word)) {
    try {
      const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase()));
      if (r.ok) {
        const data = await r.json();
        entry.dict = 'Wiktionary';
        const seen = new Set();
        for (const e of data) {
          for (const p of e.phonetics || []) {
            const acc = /-(uk|gb)\.mp3/i.test(p.audio || '') ? 'uk' : /-us\.mp3/i.test(p.audio || '') ? 'us' : /-au\.mp3/i.test(p.audio || '') ? 'au' : '';
            const key = (p.text || '') + '|' + (p.audio || '');
            if ((p.text || p.audio) && !seen.has(key)) { seen.add(key); entry.phonetics.push({ text: p.text || '', audio: p.audio || '', accent: acc }); }
          }
          for (const m of e.meanings || []) {
            if (entry.meanings.length >= 4) break;
            entry.meanings.push({ pos: m.partOfSpeech, posVi: POS_VI[m.partOfSpeech] || m.partOfSpeech,
              defs: (m.definitions || []).slice(0, 2).map(d => ({ def: d.definition, example: d.example || '' })),
              synonyms: (m.synonyms || []).slice(0, 5) });
          }
        }
      }
    } catch { /* từ điển không phản hồi → dùng IPA offline */ }
  }
  // IPA offline theo giọng người dùng chọn (khớp dòng phiên âm trên video); IPA từ điển hiện thêm bên dưới.
  const r = await toOffscreen({ type: 'PHONETIC', lang: source, texts: [word], accent }).catch(() => null);
  entry.ipa = r?.results?.[0] ? '/' + r.results[0] + '/' : '';
  entry.dictIpa = [...new Set(entry.phonetics.map(p => p.text).filter(Boolean))].slice(0, 3);
  // nghĩa: dịch từ + tối đa 6 định nghĩa trong một lần gọi
  const defs = [];
  for (const m of entry.meanings) for (const d of m.defs) if (defs.length < 6) { d._i = defs.length + 1; defs.push(d.def); }
  if (!ysnSameBase(source, target)) {
    const { results, provider } = await translate([word, ...defs], base || 'auto', target, opts);
    if (results) {
      entry.translation = results[0] || '';
      entry.provider = provider;
      for (const m of entry.meanings) for (const d of m.defs) if (d._i) d.defVi = results[d._i] || '';
    }
  }
  for (const m of entry.meanings) for (const d of m.defs) delete d._i;
  return entry;
}
function ysnSameBase(a, b) { return (a || '').toLowerCase().split(/[-_]/)[0] === (b || '').toLowerCase().split(/[-_]/)[0]; }

// ---------- Piper (giọng neural offline) — chạy trong offscreen document ----------
let offscreenCreating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen/tts.html', reasons: ['WORKERS'],
      justification: 'Chạy giọng đọc neural Piper (WASM) ngay trên máy để thuyết minh video',
    }).finally(() => { offscreenCreating = null; });
  }
  await offscreenCreating;
}
async function toOffscreen(msg) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
  if (!r?.ok) throw new Error(r?.error || 'offscreen lỗi');
  return r;
}

// Cài mới / cập nhật / tải lại tiện ích: Chrome KHÔNG tự nạp script mới vào các tab đang mở → tự nạp lại,
// để video đang xem (kể cả tab ẩn) tiếp tục có phụ đề và thuyết minh mà không cần F5.
chrome.runtime.onInstalled.addListener(async () => {
  const cs = chrome.runtime.getManifest().content_scripts;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const matchOf = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  for (const tab of tabs) {
    if (tab.discarded) continue;
    for (const c of cs) {
      const hit = c.matches.some(m => m === '<all_urls>' || matchOf(m).test(tab.url)) && !(c.exclude_matches || []).some(m => matchOf(m).test(tab.url));
      if (!hit) continue;
      const target = { tabId: tab.id, allFrames: !!c.all_frames };
      try {
        if (c.css) await chrome.scripting.insertCSS({ target, files: c.css });
        await chrome.scripting.executeScript({ target, files: c.js, world: c.world === 'MAIN' ? 'MAIN' : 'ISOLATED', injectImmediately: true });
      } catch { /* trang không cho chèn (vd. chrome web store) */ }
    }
  }
});

// Phần chính của extension (giống content_scripts[0] trong manifest) — nạp theo yêu cầu vào khung có video trên trang bất kỳ.
const FULL_SCRIPTS = chrome.runtime.getManifest().content_scripts[0].js;
const FULL_CSS = chrome.runtime.getManifest().content_scripts[0].css;

async function injectFull(tabId, frameId) {
  const target = { tabId, frameIds: [frameId] };
  const [probe] = await chrome.scripting.executeScript({ target, func: () => !!window.__ysnLoaded });
  if (probe?.result) return false;
  await chrome.scripting.insertCSS({ target, files: FULL_CSS });
  await chrome.scripting.executeScript({ target, files: FULL_SCRIPTS });
  return true;
}

// Phụ đề trên trang bất kỳ: chỉ tải URL trông giống file phụ đề, và chỉ trả về nếu nội dung đúng là phụ đề.
const SUB_URL = /\.(vtt|webvtt|srt|ass|ssa|ttml2?|dfxp|xml|json)(\?|#|$)|subtit|caption|texttrack|timedtext/i;
const KNOWN_SUB_HOSTS = /(^|\.)(udemycdn\.com|udemy\.com|coursera\.org|coursera-apps\.org|cloudfront\.net)$/;
const EXT_ONLY = new Set(['GET_OPTIONS', 'CLEAR_CACHE', 'LICENSE_ACTIVATE', 'LICENSE_DEACTIVATE', 'LICENSE_INFO', 'RELOAD']);
const STORE_NO_OFFLINE = new Set(['TTS_PIPER', 'PIPER_DOWNLOAD', 'PIPER_ANALYZE', 'PIPER_DELETE']);
const looksLikeSubs = (t) => /^\s*WEBVTT|-->|^\s*\[Script Info\]|Dialogue:\s*\d|<tt[\s>]|"(from|start|startTime|begin)"\s*:/m.test(t.slice(0, 20000));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen' || msg?.type === 'PIPER_PROGRESS') return false;   // không dành cho service worker
  // Lệnh đặc quyền (đọc API key, xoá dữ liệu, bản quyền, nạp lại) chỉ nhận từ trang của tiện ích (popup, Nâng cao),
  // không nhận từ content script chạy trên trang web. RELOAD từ trang chỉ có ở bản cá nhân (kênh test).
  const fromExt = typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (!fromExt && EXT_ONLY.has(msg?.type) && !(msg.type === 'RELOAD' && YSN_EDITION !== 'store')) {
    sendResponse({ ok: false, error: 'không được phép' }); return false;
  }
  // Bản store không có giọng offline (dữ liệu huấn luyện cấm thương mại) và không kèm bộ chạy ONNX
  if (YSN_EDITION === 'store' && (STORE_NO_OFFLINE.has(msg?.type) || (msg?.type === 'PIPER_STATUS' && msg.diag))) {
    sendResponse({ ok: false, error: 'bản này không có giọng offline' }); return false;
  }
  (async () => {
    try {
      if (msg.type === 'TRANSLATE') {
        const opts = await getOptions();
        const { results, provider, errors, localStatus } = await translate(msg.texts, msg.source, msg.target, opts);
        if (!results) sendResponse({ ok: false, error: errors.join(' | '), localStatus });
        else sendResponse({ ok: true, results, provider, warnings: errors, localStatus });
      } else if (msg.type === 'FETCH_TEXT') {
        const u = new URL(msg.url);
        const known = KNOWN_SUB_HOSTS.test(u.hostname) && u.protocol === 'https:';
        if (!known && (!/^https?:$/.test(u.protocol) || !SUB_URL.test(u.pathname + u.search))) throw new Error('không phải file phụ đề: ' + u.hostname);
        const r = await fetch(u.toString(), { credentials: known ? 'include' : 'omit' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (text.length > 6e6 || (!known && !looksLikeSubs(text))) throw new Error('nội dung không phải phụ đề');
        sendResponse({ ok: true, text });
      } else if (msg.type === 'INJECT_FULL') {
        if (!sender.tab?.id) throw new Error('không có tab');
        // tab này (hoặc trang này) đang tắt cả phụ đề lẫn thuyết minh → không nạp phần chính
        const eff = { ...(await globalSettings()), ...TAB_DEFAULTS, ...(await tabState(sender.tab.id)) };
        const host = (() => { try { return new URL(sender.tab.url).hostname; } catch { return ''; } })();
        const mode = (eff.siteMode || {})[host];
        if ((eff.enabled === false && !eff.dubEnabled) || mode === 'off' || (mode !== 'on' && eff.autoAllSites === false)) { sendResponse({ ok: true, injected: false, off: true }); return; }
        sendResponse({ ok: true, injected: await injectFull(sender.tab.id, sender.frameId ?? 0) });
      } else if (msg.type === 'TAB_STATE_GET') {
        const id = msg.tabId ?? sender.tab?.id;
        sendResponse({ ok: true, state: id != null ? await tabState(id) : {} });
      } else if (msg.type === 'TAB_STATE_SET') {
        const id = msg.tabId ?? sender.tab?.id;
        if (id == null) throw new Error('không có tab');
        const r = await setTabState(id, msg.patch || {}, { force: !!msg.force });
        sendResponse({ ok: true, state: r.state, blocked: r.blocked });
      } else if (msg.type === 'PLAN_GET') {
        if (msg.revalidate) await licenseValidate(true).catch(() => {});
        else licenseValidate(false).catch(() => {});              // kiểm tra định kỳ ở nền (12 giờ/lần)
        sendResponse({ ok: true, plan: await planNow() });
      } else if (msg.type === 'USAGE_TICK') {
        sendResponse({ ok: true, plan: await usageTick(msg.from, msg.to) });
      } else if (msg.type === 'LICENSE_ACTIVATE') {
        const license = await licenseActivate(msg.key);
        sendResponse({ ok: true, license: { ...license, key: undefined }, plan: await planNow() });
      } else if (msg.type === 'LICENSE_DEACTIVATE') {
        await licenseDeactivate();
        sendResponse({ ok: true, plan: await planNow() });
      } else if (msg.type === 'LICENSE_INFO') {
        const l = await licenseGet();
        sendResponse({ ok: true, license: l ? { ...l, key: l.key ? l.key.slice(0, 4) + '…' + l.key.slice(-4) : '' } : null, plan: await planNow() });
      } else if (msg.type === 'OPEN_PRO') {
        await chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#pro') });
        sendResponse({ ok: true });
      } else if (msg.type === 'FRAME_ACTIVE') {
        // khung đang có video + phụ đề của tab (popup gửi lệnh tới đúng khung này)
        if (sender.tab?.id) {
          const key = 'frame:' + sender.tab.id;
          await chrome.storage.session.set({ [key]: { frameId: sender.frameId ?? 0, url: sender.url, t: Date.now(), area: msg.area || 0 } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'GET_ACTIVE_FRAME') {
        const key = 'frame:' + msg.tabId;
        sendResponse({ ok: true, frame: (await chrome.storage.session.get(key))[key] || null });
      } else if (msg.type === 'LOCAL_AVAILABILITY') {
        sendResponse(await toOffscreen({ type: 'LOCAL_AVAILABILITY', source: msg.source, target: msg.target }));
      } else if (msg.type === 'PHONETIC') {
        sendResponse(await toOffscreen({ type: 'PHONETIC', lang: msg.lang, texts: msg.texts, accent: msg.accent }));
      } else if (msg.type === 'DETECT_LANG') {
        sendResponse({ ok: true, lang: await detectLanguage(msg.texts || []) });
      } else if (msg.type === 'LOOKUP') {
        sendResponse({ ok: true, entry: await lookupWord(msg) });
      } else if (msg.type === 'FETCH_AUDIO') {
        const u = new URL(msg.url);
        if (u.protocol !== 'https:' || !/(^|\.)(dictionaryapi\.dev|wikimedia\.org|gstatic\.com)$/.test(u.hostname)) throw new Error('nguồn âm thanh không được phép');
        const r = await fetch(u.toString());
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer()); let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        sendResponse({ ok: true, dataUrl: `data:${r.headers.get('content-type') || 'audio/mpeg'};base64,` + btoa(bin) });
      } else if (msg.type === 'GOOGLE_STATUS') {
        sendResponse({ ok: true, blockedUntil: await googleBlockedUntil() });
      } else if (msg.type === 'ENSURE_OFFSCREEN') {
        await ensureOffscreen();
        sendResponse({ ok: true });
      } else if (msg.type === 'TTS_PIPER') {
        const r = await toOffscreen({ type: 'PIPER_SYNTH', path: msg.path, speaker: msg.speaker || 0, rate: msg.rate || 1, text: msg.text });
        sendResponse({ ok: true, dataUrl: r.dataUrl, seconds: r.seconds, rateApplied: r.rateApplied });
      } else if (msg.type === 'PIPER_STATUS' && !msg.diag) {
        // xem model đã tải chưa ngay trong Cache Storage (không cần dựng trang offscreen nặng vài MB → nhanh hơn nhiều)
        const cache = await caches.open(PIPER_CACHE);
        const cached = {};
        for (const p of msg.paths || []) cached[p] = !!(await cache.match(piperModelUrl(p)));
        sendResponse({ ok: true, cached });
      } else if (msg.type === 'PIPER_STATUS' || msg.type === 'PIPER_DOWNLOAD' || msg.type === 'PIPER_DELETE' || msg.type === 'PIPER_ANALYZE') {
        sendResponse(await toOffscreen(msg));
      } else if (msg.type === 'TTS_CLOUD') {
        sendResponse({ ok: true, dataUrl: await cloudSynthesize(msg.text, msg.voice, msg.rate || 1, { ...(await getOptions()), targetLang: msg.lang || '' }, msg.pitch || 1) });
      } else if (msg.type === 'LIST_CLOUD_VOICES') {
        // danh sách giọng online: chưa có key → trả rỗng ngay; có key → lưu 1 ngày (không gọi mạng mỗi lần mở popup / video)
        const opts = await getOptions();
        const key = ttsKeyOf(opts);
        if (!key) { sendResponse({ ok: true, voices: [] }); return; }
        const ck = 'cloudVoices:' + opts.ttsProvider + ':' + strHash(key);
        const hit = (await chrome.storage.local.get(ck))[ck];
        if (hit && Date.now() - hit.t < 86400000 && Array.isArray(hit.v)) { sendResponse({ ok: true, voices: hit.v }); return; }
        const voices = await cloudListVoices(opts);
        chrome.storage.local.set({ [ck]: { t: Date.now(), v: voices } }).catch(() => {});
        sendResponse({ ok: true, voices });
      } else if (msg.type === 'TTS_GOOGLE') {
        sendResponse({ ok: true, dataUrl: await ttsGoogle(msg.text, msg.lang) });
      } else if (msg.type === 'CACHE_TOUCH') {
        sendResponse({ ok: true, removed: await cacheTouch(String(msg.key || '')) });
      } else if (msg.type === 'CLEAR_CACHE') {
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith('cache:'));
        await chrome.storage.local.remove([...keys, 'cacheIndex']);
        sendResponse({ ok: true, removed: keys.length });
      } else if (msg.type === 'GET_OPTIONS') {
        sendResponse({ ok: true, options: await getOptions() });
      } else if (msg.type === 'RELOAD') {
        sendResponse({ ok: true }); setTimeout(() => chrome.runtime.reload(), 100);
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async
});

// Phím tắt: bật/tắt cho RIÊNG TAB đang xem (mọi khung trong tab tự cập nhật).
chrome.commands.onCommand.addListener(async (command, tab) => {
  const key = command === 'toggle-subtitles' ? 'enabled' : command === 'toggle-dub' ? 'dubEnabled' : null;
  if (!key) return;
  const t = tab?.id != null ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (t?.id == null) return;
  const eff = { ...(await globalSettings()), ...TAB_DEFAULTS, ...(await tabState(t.id)) };
  await setTabState(t.id, { [key]: key === 'enabled' ? eff.enabled === false : !eff.dubEnabled });   // hết phút miễn phí → tự chặn + nhắc
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('frame:' + tabId).catch(() => {});
  chrome.storage.local.remove('tab:' + tabId).catch(() => {});
});
// Mở lại trình duyệt: mã tab bắt đầu lại từ đầu → bỏ trạng thái tab cũ (mọi tab về mặc định tắt)
chrome.runtime.onStartup.addListener(async () => {
  licenseValidate(false).catch(() => {});
  const keys = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
  const old = keys.filter(k => k.startsWith('tab:'));
  if (old.length) chrome.storage.local.remove(old).catch(() => {});
});

// ---------- Cài đặt: storage.local là nơi lưu chính (nhanh, không giới hạn số lần ghi) ----------
// Chép sang storage.sync sau 2 giây yên lặng (đồng bộ máy khác, không vượt hạn mức 120 lần ghi/phút);
// máy khác đổi cài đặt (sync thay đổi, khác local) → chép về local.
const YSN_DEFAULTS_BG = { autoAllSites: true, siteMode: {} };
async function globalSettings() {
  let { settings } = await chrome.storage.local.get('settings');
  if (!settings) { try { ({ settings } = await chrome.storage.sync.get('settings')); } catch { /* bỏ qua */ } }
  return { ...YSN_DEFAULTS_BG, ...(settings || {}) };
}
let syncTimer = 0, lastSynced = '';
chrome.storage.onChanged.addListener((changes, area) => {
  if (!changes.settings) return;
  const v = changes.settings.newValue;
  if (area === 'local') {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const json = JSON.stringify(v || {});
      if (json === lastSynced) return;
      try { await chrome.storage.sync.set({ settings: v }); lastSynced = json; }
      catch { syncTimer = setTimeout(() => chrome.storage.sync.set({ settings: v }).then(() => { lastSynced = json; }).catch(() => {}), 60000); }
    }, 2000);
  } else if (area === 'sync' && v) {
    const json = JSON.stringify(v);
    if (json === lastSynced) return;                     // chính mình vừa chép lên
    lastSynced = json;
    chrome.storage.local.get('settings').then(({ settings }) => {
      if (JSON.stringify(settings || {}) !== json) chrome.storage.local.set({ settings: v });
    });
  }
});

// ---------- Bật/tắt riêng từng tab (phụ đề, thuyết minh) ----------
// Lưu ở storage.local theo mã tab (không mất khi tiện ích được cập nhật / tải lại — storage.session thì bị xoá),
// xoá khi đóng tab và khi mở lại trình duyệt (mã tab đổi). Báo ngay cho mọi khung của tab.
const TAB_KEYS = ['enabled', 'dubEnabled'];
const TAB_DEFAULTS = { enabled: false, dubEnabled: false };   // mặc định TẮT — người dùng bật tab nào thì tab đó chạy
async function tabState(tabId) {
  const k = 'tab:' + tabId;
  return (await chrome.storage.local.get(k))[k] || {};
}
// Bản store: hết phút miễn phí hôm nay thì không cho BẬT (tắt thì luôn được); báo tab hiện lời mời nâng cấp.
// force chỉ có nghĩa với lệnh TẮT (hết giờ) — lệnh BẬT luôn qua kiểm tra, dù người gửi đặt force.
async function setTabState(tabId, patch, { force = false } = {}) {
  const k = 'tab:' + tabId;
  const cur = await tabState(tabId);
  const next = { ...cur };
  for (const key of TAB_KEYS) if (key in patch) next[key] = !!patch[key];
  const turningOn = TAB_KEYS.some(key => next[key] && !cur[key]);
  if (turningOn && await planBlocked()) {
    chrome.tabs.sendMessage(tabId, { type: 'TAB_STATE', state: cur }).catch(() => {});
    chrome.tabs.sendMessage(tabId, { type: 'PLAN_BLOCKED' }).catch(() => {});
    return { state: cur, blocked: true };
  }
  await chrome.storage.local.set({ [k]: next });
  chrome.tabs.sendMessage(tabId, { type: 'TAB_STATE', state: next }).catch(() => {});
  // tab chưa có phần chính (đang tắt hết) mà vừa bật lại → nạp ngay vào khung có video
  if (next.enabled !== false || next.dubEnabled) chrome.tabs.sendMessage(tabId, { type: 'YSN_DETECT_NOW' }).catch(() => {});
  return { state: next, blocked: false };
}

// ---------- Bản dịch đã lưu: chỉ mục LRU (tối đa 150 video) ----------
// Chạy tuần tự ở đây (không ở từng tab): nhiều tab cùng lưu không ghi đè chỉ mục của nhau. Bản dịch "mồ côi"
// (có trong storage nhưng không có trong chỉ mục — do bản cũ từng ghi đè chỉ mục) được coi là cũ nhất và bị dọn trước.
const CACHE_LIMIT = 150;
let cacheChain = Promise.resolve();
function cacheTouch(key) {
  const run = cacheChain.then(async () => {
    if (!key.startsWith('cache:')) return 0;
    const { cacheIndex = {} } = await chrome.storage.local.get('cacheIndex');
    cacheIndex[key] = Date.now();
    const all = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
    const present = new Set(all);
    for (const k of all) if (k.startsWith('cache:') && !(k in cacheIndex)) cacheIndex[k] = 0;
    for (const k of Object.keys(cacheIndex)) if (k !== key && !present.has(k)) delete cacheIndex[k];   // đã bị xoá ở nơi khác
    const keys = Object.keys(cacheIndex);
    let removed = [];
    if (keys.length > CACHE_LIMIT) {
      removed = keys.sort((a, b) => cacheIndex[a] - cacheIndex[b]).slice(0, keys.length - CACHE_LIMIT);
      removed.forEach(k => delete cacheIndex[k]);
      await chrome.storage.local.remove(removed);
    }
    await chrome.storage.local.set({ cacheIndex });
    return removed.length;
  });
  cacheChain = run.catch(() => {});
  return run;
}

// ---------- Model giọng offline: kiểm tra đã tải chưa ngay tại đây (cùng Cache Storage với trang offscreen) ----------
const PIPER_CACHE = 'ysn-piper-v1';
const MMS_REPO = { 'mms/vie': 'Xenova/mms-tts-vie', 'mms/vie-q': 'Xenova/mms-tts-vie' };
function piperModelUrl(path) {
  if (MMS_REPO[path]) return `https://huggingface.co/${MMS_REPO[path]}/resolve/main/` + (path.endsWith('-q') ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx');
  return 'https://huggingface.co/rhasspy/piper-voices/resolve/main/' + path;
}
function strHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
