// Xuất cho tiện ích khác trong cùng trang (Video Catcher): phụ đề ASS/SRT đúng kiểu chữ đang cài, và thuyết minh
// cả video thành WAV (giọng đã chọn, tốc độ tự co giãn, hạ tiếng gốc) để ghép vào file tải về.
//
// Giao thức (window.postMessage, cùng khung hoặc từ khung cha; mọi dữ liệu là JSON + ArrayBuffer):
//   → YSN_EXPORT_PING  {requestId}                          ← YSN_EXPORT_INFO  {requestId, ok, ...trạng thái}
//   → YSN_EXPORT_RUN   {requestId, subs, lines:'orig'|'trans'|'both', dub, useOnline} ← YSN_EXPORT_PROGRESS {requestId, phase, done, total, note}
//                                                            ← YSN_EXPORT_CHUNK {requestId, index, buffer}   (Int16 PCM giọng đọc)
//                                                            ← YSN_EXPORT_DONE  {requestId, ass, srt, voice:{sampleRate,samples}, env:{sampleRate,buffer}, meta}
//                                                            ← YSN_EXPORT_ERROR {requestId, error}
//   → YSN_EXPORT_CANCEL {requestId}
// Chỉ đọc dữ liệu đã có (câu, bản dịch, giọng) — không đổi cài đặt, không chạm vào trình phát.
(() => {
  const SR = 22050;            // mẫu/giây của file giọng đọc (Piper gốc 22050)
  const ENV_SR = 1000;         // đường bao âm lượng tiếng gốc: 1000 mẫu/giây là quá đủ (ramp ≥ 0,1 s)
  const CHUNK_SEC = 300;       // gửi giọng đọc theo khúc 5 phút để không giữ cả file trong RAM
  const RELEASE = 0.7, ATTACK = 0.12, DECAY = 0.35;
  const S = () => window.__YSN_STATE;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let current = null;          // tác vụ đang chạy { requestId, cancelled }

  const allowedSource = (src) => {
    if (src === window) return true;
    for (let w = window; w && w !== w.parent; w = w.parent) if (src === w.parent) return true;   // khung cha (video nhúng)
    return false;
  };
  // Không dùng transfer list: thông điệp được giao cho mọi isolated world của cửa sổ, sao chép mới an toàn
const reply = (target, msg) => { try { target.postMessage(msg, '*'); } catch { /* khung đã đóng */ } };

  function info(requestId) {
    const st = S();
    const s = YSNSettings.get();
    if (!st || !st.video) return { type: 'YSN_EXPORT_INFO', requestId, ok: false, error: 'Chưa có video' };
    const v = st.dubber?._voicesReady ? st.dubber.currentVoice() : null;
    return {
      type: 'YSN_EXPORT_INFO', requestId, ok: true, version: chrome.runtime.getManifest().version,
      cues: st.cues.length, translated: st.translator?.progress || 0, translateDone: !!st.translator?.done, mode: st.mode, status: st.status,
      targetLang: s.targetLang, srcLang: st.srcLang || st.trackLang || null, sameLang: !!st.sameLang, noDub: !!st.noDub,
      enabled: !!s.enabled, dubEnabled: !!s.dubEnabled, duration: st.video.duration || 0,
      lines: { phonetic: !!s.showPhonetic, original: !!s.showOriginal, translation: !!s.showTranslation },
      voice: v ? { id: v.id, name: v.name, engine: v.engine, gender: v.gender, online: v.engine === 'cloud' || v.engine === 'google', capturable: v.engine !== 'sys', ready: v.engine !== 'piper' || !!v.ready } : null,
    };
  }

  // ---------- Phụ đề ----------
  const cssToAss = (hex, alpha = 0) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim()) || ['', 'ff', 'ff', 'ff'];
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    return `&H${[a, m[3], m[2], m[1]].map(x => (typeof x === 'number' ? x.toString(16).padStart(2, '0') : x)).join('').toUpperCase()}`;
  };
  const assTime = (sec) => {
    const cs = Math.max(0, Math.round(sec * 100));
    const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  };
  const srtTime = (sec) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  const assText = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/\r?\n/g, '\\N').trim();
  const FONTS = { system: 'Segoe UI', serif: 'Cambria', rounded: 'Arial Rounded MT Bold', condensed: 'Arial Narrow' };

  // Các dòng hiển thị của một câu theo đúng cài đặt (thứ tự từ trên xuống: phiên âm, gốc, dịch)
  // s.exportLines (do bên yêu cầu đặt): 'orig' chỉ dòng gốc (+ phiên âm nếu đang bật) · 'trans' chỉ dòng dịch · 'both' theo cài đặt hiển thị
  function linesOf(st, s, i) {
    const cue = st.cues[i], tr = st.translator?.translations?.[i] || '';
    const out = [];
    if (st.sameLang) { if (cue.text) out.push({ style: 'Tr', text: cue.text }); return out; }
    const mode = s.exportLines || 'both';
    const showOr = mode === 'orig' || (mode === 'both' && s.showOriginal), showTr = mode === 'trans' || (mode === 'both' && s.showTranslation);
    if (showOr && s.showPhonetic) { const ph = st.phonetic?.results?.[i]; if (ph) out.push({ style: 'Ph', text: ph }); }
    if (showOr && cue.text) out.push({ style: 'Or', text: cue.text });
    if (showTr && tr) out.push({ style: 'Tr', text: tr });
    return out;
  }

  function buildAss(st, s) {
    const v = st.video;
    const W = Math.round(v.clientWidth || 1280), H = Math.round(v.clientHeight || 720);
    const style = (name, font, size, color, weight, bg) => {
      // bg: 'none' viền đen; 'soft' nền mờ; 'solid' nền đậm — giống overlay.css
      const box = bg !== 'none';
      const back = bg === 'solid' ? cssToAss('#080B12', 0.10) : cssToAss('#080B12', 0.38);   // alpha ASS: 00 = đục
      const outline = box ? Math.max(2, Math.round(size * 0.22)) : 1.6;
      return `Style: ${name},${font},${size},${cssToAss(color)},${cssToAss(color)},${box ? back : '&H00000000'},${box ? back : '&HA0000000'},${weight >= 600 ? -1 : 0},0,0,0,100,100,0,0,${box ? 3 : 1},${outline},${box ? 0 : 1},2,40,40,0,1`;
    };
    const marginV = Math.round(H * ((s.subBottom ?? 9) / 100));
    const fontTr = FONTS[s.subFont] || FONTS.system, fontOr = FONTS[s.subOrigFont || s.subFont] || FONTS.system;
    const head = ['[Script Info]', '; Xuất từ Song Ngữ & Thuyết Minh', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      style('Tr', fontTr, s.fontSizeTranslated || 24, s.subColor || '#FFD23F', 650, s.subBg || 'soft'),
      style('Or', fontOr, s.fontSizeOriginal || 18, s.subOrigColor || '#E6E9EF', 450, s.subOrigBg || s.subBg || 'soft'),
      style('Ph', fontOr, s.fontSizePhonetic || 15, s.subPhoneticColor || '#A8D8FF', 400, s.subOrigBg || s.subBg || 'soft'),
      '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'];
    const ev = [];
    for (let i = 0; i < st.cues.length; i++) {
      const c = st.cues[i];
      const lines = linesOf(st, s, i);
      if (!lines.length) continue;
      // Mọi dòng cùng MarginV để "va chạm": libass xếp các sự kiện cùng thời điểm từ dưới lên theo thứ tự trong file
      // → ghi dòng dưới cùng (dịch) trước, rồi gốc, rồi phiên âm.
      lines.slice().reverse().forEach((ln) => ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${ln.style},,0,0,${marginV},,${assText(ln.text)}`));
    }
    return `${head.join('\n')}\n${ev.join('\n')}\n`;
  }
  function buildSrt(st, s) {
    const out = [];
    for (let i = 0; i < st.cues.length; i++) {
      const lines = linesOf(st, s, i).filter(l => l.style !== 'Ph');
      if (!lines.length) continue;
      out.push(`${out.length + 1}\n${srtTime(st.cues[i].start)} --> ${srtTime(st.cues[i].end)}\n${lines.map(l => l.text).join('\n')}\n`);
    }
    return out.join('\n');
  }

  // ---------- Âm thanh ----------
  let decoder = null;
  async function decode(dataUrl) {
    decoder ||= new OfflineAudioContext(1, 1, SR);        // decodeAudioData đổi mẫu về SR
    const buf = await (await fetch(dataUrl)).arrayBuffer();
    const ab = await decoder.decodeAudioData(buf);
    if (ab.numberOfChannels === 1) return ab.getChannelData(0);
    const n = ab.length, out = new Float32Array(n);
    for (let ch = 0; ch < ab.numberOfChannels; ch++) { const d = ab.getChannelData(ch); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
    return out;
  }
  // Đổi tốc độ giữ cao độ (WSOLA đơn giản, đủ tốt cho giọng nói): factor > 1 nhanh hơn
  function stretch(x, factor) {
    if (!(factor > 0) || Math.abs(factor - 1) < 0.02 || x.length < SR / 10) return x;
    const N = Math.round(SR * 0.03), Hs = N >> 1, Ha = Hs * factor, tol = Math.round(SR * 0.008);
    const outLen = Math.floor(x.length / factor);
    const out = new Float32Array(outLen + N), win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    let prev = 0;
    for (let k = 0; k * Hs < outLen; k++) {
      const nominal = Math.round(k * Ha);
      let best = nominal, bestScore = -Infinity;
      if (k > 0) {
        const natural = prev + Hs;                        // tiếp nối tự nhiên của khung trước
        for (let d = -tol; d <= tol; d += 4) {
          const p = nominal + d;
          if (p < 0 || p + N > x.length || natural + Hs > x.length) continue;
          let sc = 0;
          for (let i = 0; i < Hs; i += 2) sc += x[p + i] * x[natural + i];
          if (sc > bestScore) { bestScore = sc; best = p; }
        }
      }
      if (best + N > x.length) break;
      const o = k * Hs;
      for (let i = 0; i < N && o + i < out.length; i++) out[o + i] += x[best + i] * win[i];
      prev = best;
    }
    return out.subarray(0, outLen);
  }
  // Đổi cao độ KHÔNG giữ tốc độ (như phát với playbackRate = pitch, preservesPitch = false): nội suy tuyến tính
  function resample(x, factor) {
    if (Math.abs(factor - 1) < 0.005) return x;
    const n = Math.floor(x.length / factor), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = i * factor, j = Math.floor(p), f = p - j; out[i] = x[j] * (1 - f) + (x[j + 1] || 0) * f; }
    return out;
  }
  const planRate = (text, slot, prev, cps, s, voice) => {
    const base = s.dubRate || 1;
    const max = Math.max(base, Math.min(3, Math.max(s.dubMaxRate || 1.5, voice?.maxRate || 0)));
    const target = Math.min(max, Math.max(base, text.length / cps / Math.max(slot, 0.5)));
    const p = prev ?? base, r = p + Math.max(-0.06, Math.min(0.12, target - p));
    return Math.round(Math.min(max, Math.max(base, r)) * 20) / 20;
  };

  // Tổng hợp một câu → PCM Float32 @SR đã áp tốc độ/cao độ đúng như khi phát trực tiếp (dubber.js)
  async function synth(dubber, voice, text, rate, s) {
    const pitch = s.dubPitch || 1;
    if (voice.engine === 'piper') {
      const pcm = await decode(await dubber._piperAudio(voice, text, rate));
      if (voice.kind === 'mms') return stretch(pcm, rate);                  // MMS: tổng hợp ở 1.0, co giãn sau
      return resample(pcm, pitch);                                           // Piper: tốc độ đã áp lúc tổng hợp, cao độ áp khi phát
    }
    if (voice.engine === 'google') {
      const parts = [];
      for (const c of dubber._chunk(text, 190)) parts.push(await decode(await dubber._googleAudio(c, s.targetLang || 'vi')));
      const n = parts.reduce((a, p) => a + p.length, 0), all = new Float32Array(n);
      let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      return stretch(all, rate);
    }
    if (voice.engine === 'cloud') {
      const pcm = await decode(await dubber._cloudAudio(voice, text, rate));
      return voice.fixedRate ? stretch(pcm, rate) : pcm;
    }
    throw new Error('Giọng hệ thống (Web Speech) không ghi ra file được');
  }

  function wavInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) { const v = Math.max(-1, Math.min(1, f32[i])); out[i] = v < 0 ? v * 32768 : v * 32767; }
    return out;
  }

  async function run(req, target) {
    const { requestId } = req;
    const st = S(), s = { ...YSNSettings.get(), exportLines: ['orig', 'trans', 'both'].includes(req.lines) ? req.lines : 'both' };
    const job = current = { requestId, cancelled: false };
    const progress = (phase, done, total, note) => reply(target, { type: 'YSN_EXPORT_PROGRESS', requestId, phase, done, total, note: note || '' });
    const check = () => { if (job.cancelled) throw Object.assign(new Error('Đã huỷ'), { cancelled: true }); };
    try {
      if (!st || !st.video) throw new Error('Chưa có video trên trang');
      if (!st.cues.length) throw new Error('Chưa lấy được phụ đề của video này (bật phụ đề và phát vài giây)');
      const duration = Number.isFinite(st.video.duration) && st.video.duration > 0 ? st.video.duration : Math.max(...st.cues.map(c => c.end)) + 1;
      const meta = { mode: st.mode, partial: st.mode !== 'static', cues: st.cues.length, targetLang: s.targetLang, srcLang: st.srcLang || null, notes: [] };
      if (meta.partial) meta.notes.push('Phụ đề nguồn nạp dần: chỉ gồm phần đã xem/đã tải');

      // 1. Chờ dịch xong (bản dịch được dịch dần quanh vị trí đang xem; thúc để dịch hết)
      if (!req.dub && s.exportLines !== 'orig' && !st.sameLang && st.translator && !st.translator.done) {
        const t0 = Date.now();
        let lastP = -1, stuckSince = Date.now();
        while (!st.translator.done) {
          check();
          st.translator.nudge();
          const p = st.translator.progress;
          if (p !== lastP) { lastP = p; stuckSince = Date.now(); }
          progress('translate', p, st.cues.length);
          if (Date.now() - t0 > 15 * 60000 || Date.now() - stuckSince > 90000) { meta.notes.push(`Còn ${st.cues.length - p} câu chưa dịch`); break; }
          await sleep(600);
        }
      }
      if (req.subs && s.showPhonetic && st.phonetic && !st.phonetic.done) {
        const t0 = Date.now();
        while (!st.phonetic.done && Date.now() - t0 < 120000) { check(); progress('phonetic', st.phonetic.results.filter(Boolean).length, st.cues.length); await sleep(600); }
      }

      const result = { type: 'YSN_EXPORT_DONE', requestId, ass: null, srt: null, voice: null, env: null, meta };
      const buildSubs = () => { if (req.subs) { result.ass = buildAss(st, s); result.srt = buildSrt(st, s); } };
      if (!req.dub) buildSubs();

      // 2. Thuyết minh: tổng hợp từng câu, đặt đúng mốc, gửi theo khúc; đường bao hạ tiếng gốc
      if (req.dub) {
        if (st.noDub) throw new Error('Video nói đúng ngôn ngữ đích — không có gì để thuyết minh');
        const dubber = st.dubber;
        if (!dubber) throw new Error('Chưa sẵn sàng thuyết minh — bật thuyết minh một lần rồi thử lại');
        if (!dubber._voicesReady) await dubber.refreshVoices();
        let voice = dubber.currentVoice();
        if (!voice) throw new Error('Không có giọng đọc cho ngôn ngữ này');
        const online = voice.engine === 'cloud' || voice.engine === 'google';
        if (voice.engine === 'sys' || (online && req.useOnline === false)) {
          const fb = dubber._pickFallback(voice);
          if (!fb || fb.engine === 'sys') throw new Error('Không có giọng chạy trên máy để ghi ra file');
          meta.notes.push(`Giọng ${voice.name} không ghi ra file được → dùng ${fb.name}`);
          voice = fb;
        }
        if (voice.engine === 'piper' && !voice.ready) {
          progress('voice', 0, 1, `Đang tải giọng ${voice.name} (${voice.mb || ''} MB)`);
          const r = await ysnOffscreen({ type: 'PIPER_DOWNLOAD', path: voice.path });
          if (!r?.ok) throw new Error(r?.error || `Không tải được giọng ${voice.name}`);
          voice.ready = true;
        }
        meta.voice = { id: voice.id, name: voice.name, engine: voice.engine, online };
        const totalSamples = Math.ceil(duration * SR), chunkSamples = CHUNK_SEC * SR;
        const chunks = new Map();                          // index khúc → Float32Array (chỉ giữ vài khúc đang viết)
        let sent = 0;                                      // khúc kế tiếp cần gửi
        const flushTo = (idx) => {                          // gửi mọi khúc < idx theo thứ tự (khúc trống = im lặng)
          for (; sent < idx; sent++) {
            const len = Math.min(chunkSamples, totalSamples - sent * chunkSamples);
            if (len <= 0) break;
            const f = chunks.get(sent) || new Float32Array(len);
            chunks.delete(sent);
            const i16 = wavInt16(f.subarray(0, len));
            reply(target, { type: 'YSN_EXPORT_CHUNK', requestId, index: sent, buffer: i16.buffer });
          }
        };
        const write = (startSample, pcm, gain) => {
          for (let p = 0; p < pcm.length;) {
            const abs = startSample + p;
            if (abs >= totalSamples) break;
            const idx = Math.floor(abs / chunkSamples), off = abs - idx * chunkSamples;
            let f = chunks.get(idx);
            if (!f) { f = new Float32Array(Math.min(chunkSamples, totalSamples - idx * chunkSamples)); chunks.set(idx, f); }
            const n = Math.min(pcm.length - p, f.length - off);
            for (let i = 0; i < n; i++) f[off + i] += pcm[p + i] * gain;
            p += n;
          }
        };
        const base = s.muteOriginal ? 0 : Math.max(0, Math.min(1, s.originalVolume ?? 1));
        const duck = s.muteOriginal ? 0 : Math.max(0, Math.min(base, s.duckVolume ?? 0.15));
        const env = new Float32Array(Math.ceil(duration * ENV_SR) + 1).fill(base);
        const paint = (from, to) => {                        // hạ tiếng gốc trong [from, to] với ramp vào/ra mượt
          const a0 = Math.max(0, Math.floor((from - ATTACK) * ENV_SR)), a1 = Math.floor(from * ENV_SR);
          const r0 = Math.floor((to + RELEASE) * ENV_SR), r1 = Math.min(env.length - 1, Math.floor((to + RELEASE + DECAY) * ENV_SR));
          for (let i = a0; i <= r1; i++) {
            let g = duck;
            if (i < a1) g = base + (duck - base) * ((i - a0) / Math.max(1, a1 - a0));
            else if (i > r0) g = duck + (base - duck) * ((i - r0) / Math.max(1, r1 - r0));
            if (g < env[i]) env[i] = g;
          }
        };
        const dubVol = Math.max(0, Math.min(1, s.dubVolume ?? 1));
        const cps = {}; const charsPerSec = () => cps[voice.id] || dubber.cps?.[voice.id] || (voice.kind === 'mms' ? 15 : 19);
        let prevRate = null, prevEnd = 0, spoken = 0, failed = 0;
        for (let i = 0; i < st.cues.length; i++) {
          check();
          const cue = st.cues[i];
          let text = st.translator?.translations?.[i];
          if (text === null && st.translator && !st.sameLang) {                 // chưa dịch tới câu này: thúc và chờ (dịch chạy song song với tổng hợp)
            const w0 = Date.now();
            while (st.translator.translations[i] === null && Date.now() - w0 < 90000) { check(); st.translator.nudge(); progress('translate', st.translator.progress, st.cues.length); await sleep(400); }
            text = st.translator.translations[i];
            if (text === null) { meta.notes.push(`Câu ${i + 1} chưa dịch kịp`); continue; }
          }
          progress('dub', i, st.cues.length);
          if (!text || YSNDubber.isNonSpeech(text) || YSNDubber.isNonSpeech(cue.text)) continue;
          // như khi xem: bắt đầu khi câu hiện, nhưng không chồng lên câu trước; trễ thì đọc nhanh hơn cho kịp
          const start = Math.max(cue.start, prevEnd);
          const slot = Math.max(0.8, cue.end - start);
          const rate = planRate(text, slot, prevRate, charsPerSec(), s, voice);
          let pcm = null;
          for (let attempt = 0; attempt < 2 && !pcm; attempt++) {
            try { pcm = await synth(dubber, voice, text, rate, s); }
            catch (e) { if (attempt) { failed++; console.warn('[YSN export] câu', i, e.message); } else await sleep(300); }
          }
          if (!pcm || !pcm.length) continue;
          prevRate = rate;
          const seconds = pcm.length / SR;
          if (text.length >= 8 && seconds > 0.3) { const sample = Math.max(8, Math.min(25, text.length / (seconds * rate))); cps[voice.id] = cps[voice.id] ? cps[voice.id] * 0.7 + sample * 0.3 : sample; }
          write(Math.round(start * SR), pcm, dubVol);
          prevEnd = start + seconds + 0.05;
          paint(start, start + seconds);
          spoken++;
          flushTo(Math.floor(Math.max(0, start - 1) / CHUNK_SEC));
        }
        flushTo(Math.ceil(totalSamples / chunkSamples));
        meta.spoken = spoken; meta.failed = failed;
        buildSubs();
        if (failed) meta.notes.push(`${failed} câu không tổng hợp được`);
        const envI16 = wavInt16(env);
        result.voice = { sampleRate: SR, samples: totalSamples };
        result.env = { sampleRate: ENV_SR, buffer: envI16.buffer };
        reply(target, result);
      } else reply(target, result);
    } catch (e) {
      if (!e.cancelled) console.warn('[YSN export]', e);
      reply(target, { type: 'YSN_EXPORT_ERROR', requestId, error: e.message || String(e), cancelled: !!e.cancelled });
    } finally { if (current === job) current = null; }
  }

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d.type !== 'string' || !d.type.startsWith('YSN_EXPORT_') || !allowedSource(ev.source)) return;
    if (!chrome.runtime?.id) return;                                    // bản cũ sau khi tiện ích cập nhật: im lặng
    if (d.type === 'YSN_EXPORT_PING') reply(ev.source, info(d.requestId));
    else if (d.type === 'YSN_EXPORT_RUN') {
      if (current) { reply(ev.source, { type: 'YSN_EXPORT_ERROR', requestId: d.requestId, error: 'Đang xuất cho một lượt tải khác, chờ xong rồi thử lại' }); return; }
      run(d, ev.source);
    } else if (d.type === 'YSN_EXPORT_CANCEL') { if (current && (!d.requestId || current.requestId === d.requestId)) current.cancelled = true; }
  });
})();
