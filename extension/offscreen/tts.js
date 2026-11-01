// Offscreen document: chạy giọng neural Piper (ONNX + espeak-ng phonemizer, WASM) hoàn toàn trên máy.
// Model .onnx tải 1 lần từ kho chính thức rhasspy/piper-voices rồi lưu trong Cache Storage của extension.
import { phoneticLines } from './phonetics.js';
import { mmsSynth } from './mms.js';

// ONNX runtime chỉ nạp khi cần giọng offline (bản store không kèm file ort* → phiên âm, dịch trên máy vẫn chạy).
let ort = null;
async function loadOrt() {
  if (ort) return ort;
  const m = await import('./vendor/ort.wasm.min.mjs');
  m.env.wasm.wasmPaths = chrome.runtime.getURL('offscreen/vendor/');
  // Trang extension được cách ly (COOP/COEP trong manifest) → có SharedArrayBuffer → chạy model đa luồng (nhanh gấp 2–3 lần)
  m.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  return (ort = m);
}

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const CACHE = 'ysn-piper-v1';
const sessions = new Map();                // path → Promise<{session, config}>

// Giọng không thuộc kho Piper: "mms/<lang>" → MMS-TTS (Meta) bản ONNX của Xenova
const MMS = { 'mms/vie': 'Xenova/mms-tts-vie', 'mms/vie-q': 'Xenova/mms-tts-vie' };
function urlsFor(path) {
  if (MMS[path]) {
    const base = `https://huggingface.co/${MMS[path]}/resolve/main/`;
    return { kind: 'mms', model: base + (path.endsWith('-q') ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx'), config: base + 'vocab.json' };
  }
  return { kind: 'piper', model: HF + path, config: HF + path + '.json' };
}

async function cachedArrayBuffer(url, onProgress) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Tải model lỗi HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  const reader = r.body.getReader();
  const chunks = []; let loaded = 0, lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length;
    if (onProgress && (loaded - lastReport > 512 * 1024 || loaded === total)) { lastReport = loaded; onProgress(loaded, total); }
  }
  const blob = new Blob(chunks);
  await cache.put(url, new Response(blob, { headers: { 'content-length': String(blob.size) } }));
  return blob.arrayBuffer();
}

function getSession(path, onProgress) {
  if (sessions.has(path)) return sessions.get(path);
  const p = (async () => {
    const u = urlsFor(path);
    const config = JSON.parse(new TextDecoder().decode(await cachedArrayBuffer(u.config)));
    const model = await cachedArrayBuffer(u.model, onProgress);
    const session = await (await loadOrt()).InferenceSession.create(model, { executionProviders: ['wasm'] });
    return { session, config, kind: u.kind };
  })();
  sessions.set(path, p);
  p.catch(() => sessions.delete(path));
  return p;
}

// espeak-ng phonemizer (emscripten, @diffusionstudio/piper-wasm): chỉ có callMain, heap CỐ ĐỊNH 16 MB và mỗi lần
// callMain rò một ít bộ nhớ (espeak_Initialize/Terminate không giải phóng hết). Đo thực tế: sau ~100 lần gọi hoặc
// ~300 câu thì module chết hẳn — lúc "Aborted()", lúc "null function", lúc "memory access out of bounds".
// Vì vậy: dùng lại module (callMain ≈20 ms/câu, không phải nạp lại 18 MB dữ liệu) nhưng ĐẾM NGÂN SÁCH; dùng được
// nửa ngân sách thì tạo sẵn module mới ở nền, hết ngân sách thì đổi sang (không giật); hỏng giữa chừng thì tạo lại
// và thử lại đúng lô đó một lần.
const BUDGET = { calls: 24, items: 96, chars: 4000 };   // ngưỡng đổi module — ~1/4 mức chết đo được
let current = null;        // { mod, calls, items, chars } — module đang dùng và ngân sách đã tiêu
let currentP = null;       // đang tạo module cho lần dùng hiện tại
let standbyP = null;       // module tạo sẵn ở nền
let printSink = null;      // nơi nhận stdout của module đang chạy (mỗi lúc chỉ một module chạy)
function createModule() {
  return globalThis.createPiperPhonemize({
    print: (line) => printSink?.(line),
    printErr: (m) => console.warn('[espeak]', m),
    locateFile: (f) => chrome.runtime.getURL('offscreen/vendor/' + f.split('/').pop()),
  });
}
async function ensurePhonemizer() {
  if (current) return current.mod;
  if (!currentP) {
    const src = standbyP || createModule(); standbyP = null;
    currentP = src.then(mod => { current = { mod, calls: 0, items: 0, chars: 0 }; return mod; })
      .finally(() => { currentP = null; });
  }
  return currentP;
}
function resetPhonemizer() { current = null; }
const spent = (c) => c.calls >= BUDGET.calls || c.items >= BUDGET.items || c.chars >= BUDGET.chars;
const halfSpent = (c) => c.calls * 2 >= BUDGET.calls || c.items * 2 >= BUDGET.items || c.chars * 2 >= BUDGET.chars;
function prepareStandby() {
  if (standbyP) return;
  standbyP = createModule();
  standbyP.catch(() => { standbyP = null; });
}
// Bỏ ký tự làm espeak (piper_phonemize) hỏng: ký tự điều khiển, nửa cặp surrogate (emoji bị cắt đôi), emoji —
// gặp chúng, bộ đọc JSON bên trong module có lúc "Aborted()".
function cleanForPhonemize(t) {
  return String(t ?? '').normalize('NFC')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200B}-\u{200F}]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}
// Chia lô sao cho tham số dòng lệnh ≤ ~4 KB (callMain đặt tham số lên stack nhỏ của module — lô quá lớn làm tràn stack)
function groupTexts(texts) {
  const groups = []; let g = [], size = 0;
  for (const t of texts) {
    const item = { text: cleanForPhonemize(t) }, n = JSON.stringify(item).length + 1;
    if (g.length && size + n > 4000) { groups.push(g); g = []; size = 0; }
    g.push(item); size += n;
  }
  if (g.length) groups.push(g);
  return groups;
}
function runGroup(mod, grp, voice) {
  const lines = [];
  printSink = (l) => lines.push(l);
  try { mod.callMain(['-l', voice, '--input', JSON.stringify(grp), '--espeak_data', '/espeak-ng-data']); }
  finally { printSink = null; }
  return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
// exit(1) của chương trình (vd. giọng không có) — module vẫn lành, không phải hỏng
const isExit = (e) => e?.name === 'ExitStatus' || typeof e?.status === 'number';
async function phonemizeBatch(texts, voice) {
  const out = [];
  for (const grp of groupTexts(texts)) {
    const chars = grp.reduce((n, it) => n + it.text.length, 0);
    for (let attempt = 0; ; attempt++) {
      if (current && spent(current)) resetPhonemizer();     // hết ngân sách → đổi sang module mới (đã tạo sẵn nếu kịp)
      const mod = await ensurePhonemizer();
      current.calls++; current.items += grp.length; current.chars += chars;
      let rows, exited = false;
      try { rows = runGroup(mod, grp, voice); }
      catch (e) {
        if (isExit(e)) { rows = []; exited = true; }
        else {
          // ngoại lệ C++ không bắt được (module ném ra một con số) hoặc module vỡ (Aborted / null function / out of bounds)
          const err = typeof e === 'number' ? new Error(`espeak lỗi với giọng "${voice}" (ngoại lệ ${e})`) : e;
          resetPhonemizer();
          console.warn('[espeak] bộ phiên âm hỏng, tạo lại' + (attempt ? '' : ' rồi thử lại lô này') + ':', err?.message || err);
          if (attempt) throw err;
          continue;
        }
      }
      // không ra gì dù có chữ → coi như module hỏng, tạo lại rồi thử lần nữa
      if (!rows.length && !attempt && !exited && grp.some(it => it.text)) { resetPhonemizer(); continue; }
      out.push(...rows); break;
    }
    if (current && halfSpent(current)) prepareStandby();
  }
  return out;
}
// cho công cụ test (trang offscreen không trang web nào chạm tới được)
globalThis.__ysnPhonemizeTest = { phonemize: (t, v) => phonemize(t, v), batch: (t, v) => phonemizeBatch(t, v), raw: async () => ensurePhonemizer() };
async function phonemize(text, voice) {
  const r = (await phonemizeBatch([text], voice))[0];
  if (!r) throw new Error('espeak không hỗ trợ giọng ' + voice);
  return r;
}

// Đổi âm vị → id theo bảng phoneme_id_map CỦA MODEL (mỗi model có bảng riêng): ^ _ p1 _ p2 _ … $
function toIds(ph, map) {
  if (!map || !Array.isArray(ph.phonemes)) return ph.phoneme_ids;
  const one = (k, d) => (map[k] ? map[k][0] : d);
  const pad = one('_', 0);
  const ids = [one('^', 1), pad];
  for (const p of ph.phonemes) { const v = map[p]; if (!v) continue; ids.push(...v, pad); }
  ids.push(one('$', 2));
  return ids;
}

function wavDataUrl(pcm, sampleRate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0, o = 44; i < pcm.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
}

// Hàng đợi: tổng hợp TUẦN TỰ (mỗi lần tạo một phonemizer ~18 MB) — tránh câu đang đọc và câu tải trước tranh nhau.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function synthPcm(args) { return enqueue(() => synthPcmNow(args)); }

async function synthPcmNow({ path, speaker = 0, rate = 1, text }) {
  const { session, config, kind } = await getSession(path, (loaded, total) =>
    chrome.runtime.sendMessage({ type: 'PIPER_PROGRESS', path, loaded, total }).catch(() => {}));
  if (kind === 'mms') {                                    // MMS: tốc độ áp khi phát (model không nhận tham số tốc độ)
    const r = await mmsSynth(ort, session, config, text);
    return { pcm: normalizeLoudness(r.pcm), sampleRate: r.sampleRate, numSpeakers: 1, rateApplied: false };
  }
  const ph = await phonemize(text, config.espeak?.voice || 'en-us');
  const ids = toIds(ph, config.phoneme_id_map);
  const inf = config.inference || {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / Math.max(0.3, rate), inf.noise_w ?? 0.8]), [3]),
  };
  if ((config.num_speakers || 1) > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker)]), [1]);
  const out = await session.run(feeds);
  return { pcm: normalizeLoudness(out.output.data), sampleRate: config.audio?.sample_rate || 22050, numSpeakers: config.num_speakers || 1, rateApplied: true };
}

// Chuẩn hoá âm lượng: đưa RMS về mức cố định (các câu to nhỏ đều nhau), không để vượt đỉnh.
function normalizeLoudness(pcm, targetRms = 0.085) {
  let sum = 0, peak = 0;
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i]; sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
  const rms = Math.sqrt(sum / Math.max(1, pcm.length));
  if (rms < 1e-4) return pcm;
  const gain = Math.min(targetRms / rms, 0.95 / Math.max(peak, 1e-4), 4);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * gain;
  return out;
}

// Ước lượng cao độ trung vị (Hz) bằng autocorrelation — dùng để phân loại giọng nam/nữ.
function medianF0(pcm, sr) {
  const frame = Math.round(sr * 0.04), hop = Math.round(sr * 0.02), f0s = [];
  const minLag = Math.round(sr / 400), maxLag = Math.round(sr / 60);
  for (let s = 0; s + frame + maxLag < pcm.length; s += hop) {
    let energy = 0; for (let i = 0; i < frame; i++) energy += pcm[s + i] ** 2;
    if (energy / frame < 1e-4) continue;
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0; for (let i = 0; i < frame; i++) c += pcm[s + i] * pcm[s + i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    if (bestLag && best / energy > 0.5) f0s.push(sr / bestLag);
  }
  f0s.sort((a, b) => a - b);
  return f0s.length ? Math.round(f0s[f0s.length >> 1]) : 0;
}

async function isCached(path) {
  const cache = await caches.open(CACHE);
  return !!(await cache.match(urlsFor(path).model));
}

// ---------- Dịch trên máy: Translator API có sẵn trong Chrome (offline, miễn phí) ----------
// Mã ngôn ngữ cho Translator API: dùng mã gốc, riêng tiếng Trung phồn thể là zh-Hant.
function chromeLang(code) {
  const c = (code || '').toLowerCase();
  if (/^zh[-_](tw|hk|hant)/.test(c)) return 'zh-Hant';
  if (c.startsWith('zh')) return 'zh';
  return c.split(/[-_]/)[0];
}
const translators = new Map();
async function localAvailability(source, target) {
  if (typeof Translator === 'undefined') return 'unsupported';
  try { return await Translator.availability({ sourceLanguage: chromeLang(source), targetLanguage: chromeLang(target) }); }
  catch { return 'unavailable'; }
}
function getTranslator(source, target) {
  const key = chromeLang(source) + '|' + chromeLang(target);
  if (!translators.has(key)) {
    const p = Translator.create({ sourceLanguage: chromeLang(source), targetLanguage: chromeLang(target) });
    translators.set(key, p); p.catch(() => translators.delete(key));
  }
  return translators.get(key);
}
async function detectLang(texts) {
  if (typeof LanguageDetector === 'undefined') return null;
  try {
    const d = await LanguageDetector.create();
    const r = await d.detect(texts.join(' ').slice(0, 2000));
    return r?.[0]?.confidence > 0.5 ? r[0].detectedLanguage : null;
  } catch { return null; }
}
async function localTranslate({ source, target, texts }) {
  let src = source;
  if (!src || src === 'auto') src = await detectLang(texts);
  if (!src) throw Object.assign(new Error('không nhận ra ngôn ngữ nguồn'), { code: 'unsupported' });
  const av = await localAvailability(src, target);
  if (av !== 'available') throw Object.assign(new Error('gói dịch ' + chromeLang(src) + '→' + chromeLang(target) + ': ' + av), { code: av });
  const tr = await getTranslator(src, target);
  const out = [];
  for (const t of texts) out.push(t && t.trim() ? (await tr.translate(t)).trim() : '');
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;          // tin nhắn khác không dành cho trang này
  (async () => {
    try {
      if (msg.type === 'LOCAL_TRANSLATE') {
        try { sendResponse({ ok: true, results: await localTranslate(msg) }); }
        catch (e) { sendResponse({ ok: false, error: e.message, code: e.code || 'error' }); }
      } else if (msg.type === 'PHONETIC') {
        // lỗi espeak thì bỏ qua phiên âm của lô đó (phonemizeBatch đã tự tạo lại module)
        const safeBatch = async (texts, voice) => { try { return await phonemizeBatch(texts, voice); } catch (e) { console.warn('[espeak] bỏ phiên âm lô này:', e?.message || e); return []; } };
        const results = await enqueue(() => phoneticLines({ lang: msg.lang, texts: msg.texts, accent: msg.accent }, safeBatch));
        sendResponse({ ok: true, results });
      } else if (msg.type === 'LOCAL_AVAILABILITY') {
        sendResponse({ ok: true, status: await localAvailability(msg.source, msg.target) });
      } else if (msg.type === 'DETECT_LANG') {
        sendResponse({ ok: true, lang: await detectLang(msg.texts || []) });
      } else if (msg.type === 'PIPER_SYNTH') {
        const { pcm, sampleRate, rateApplied } = await synthPcm(msg);
        sendResponse({ ok: true, dataUrl: wavDataUrl(pcm, sampleRate), seconds: pcm.length / sampleRate, rateApplied });
      } else if (msg.type === 'PIPER_STATUS') {
        const out = {};
        for (const p of msg.paths || []) out[p] = await isCached(p);
        sendResponse({ ok: true, cached: out, isolated: self.crossOriginIsolated, threads: ort?.env.wasm.numThreads ?? null });   // ort chưa nạp → null (không ép nạp chỉ để báo)
      } else if (msg.type === 'PIPER_WARM') {
        // khởi động sẵn model + espeak để câu thuyết minh đầu tiên không bị trễ
        const { kind } = await getSession(msg.path);
        if (kind !== 'mms') await ensurePhonemizer();
        sendResponse({ ok: true });
      } else if (msg.type === 'PIPER_DOWNLOAD') {
        await getSession(msg.path, (loaded, total) => chrome.runtime.sendMessage({ type: 'PIPER_PROGRESS', path: msg.path, loaded, total }).catch(() => {}));
        sendResponse({ ok: true });
      } else if (msg.type === 'PIPER_DELETE') {
        const cache = await caches.open(CACHE);
        const u = urlsFor(msg.path);
        await cache.delete(u.model); await cache.delete(u.config);
        sessions.delete(msg.path);
        sendResponse({ ok: true });
      } else if (msg.type === 'PIPER_ANALYZE') {
        // dev: đo cao độ từng người đọc của một model
        const res = [];
        const first = await synthPcm({ path: msg.path, speaker: 0, text: msg.text });
        const n = Math.min(first.numSpeakers, msg.maxSpeakers || 100);
        for (let sp = 0; sp < n; sp++) {
          const { pcm, sampleRate } = sp === 0 ? first : await synthPcm({ path: msg.path, speaker: sp, text: msg.text });
          res.push({ speaker: sp, f0: medianF0(pcm, sampleRate), seconds: +(pcm.length / sampleRate).toFixed(2) });
        }
        sendResponse({ ok: true, numSpeakers: first.numSpeakers, res });
      } else sendResponse({ ok: false, error: 'unknown offscreen message' });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});
