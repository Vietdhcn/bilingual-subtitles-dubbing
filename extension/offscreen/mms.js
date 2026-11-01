// Giọng MMS-TTS của Meta (VITS, đầu vào là chữ cái — không cần espeak): dùng cho tiếng Việt giọng nam offline.
// Model ONNX bản lượng tử hoá của Xenova (transformers.js), giấy phép gốc CC BY-NC 4.0 (chỉ dùng cá nhân, phi thương mại).

const VI_DIG = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

// 0..999; `full` = phía trước còn nhóm số (đọc "không trăm", "linh")
function vi3(n, full) {
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, u = n % 10;
  const out = [];
  if (h || full) out.push(VI_DIG[h], 'trăm');
  if (t === 0) { if (u && (h || full)) out.push('linh'); }
  else if (t === 1) out.push('mười');
  else out.push(VI_DIG[t], 'mươi');
  if (u) {
    if (u === 1 && t >= 2) out.push('mốt');
    else if (u === 5 && t >= 1) out.push('lăm');
    else if (u === 4 && t >= 2) out.push('tư');
    else out.push(VI_DIG[u]);
  }
  return out.join(' ');
}

// Số nguyên → chữ tiếng Việt (tới hàng nghìn tỷ)
export function viNumber(n) {
  n = Math.floor(Math.abs(n));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'không';
  if (n >= 1e15) return String(n).split('').map(d => VI_DIG[d]).join(' ');
  const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];
  const groups = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  const out = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    out.push(vi3(groups[i], i < groups.length - 1));
    if (units[i]) out.push(units[i]);
  }
  return out.join(' ');
}

// Chuẩn hoá câu tiếng Việt cho MMS: số → chữ, ký hiệu → chữ
export function viNormalize(text) {
  return text.normalize('NFC')
    .replace(/\$\s?(\d[\d.,]*)/g, '$1 đô la').replace(/(\d[\d.,]*)\s?\$/g, '$1 đô la').replace(/€\s?(\d[\d.,]*)|(\d[\d.,]*)\s?€/g, (m, a, b) => (a || b) + ' ơ rô')
    .replace(/(\d+(?:[.,]\d+)?)\s*%/g, '$1 phần trăm')
    .replace(/\d{1,3}(?:[.,]\d{3})+(?![\d])/g, (m) => viNumber(+m.replace(/[.,]/g, '')))           // 1.000 / 1,000 → một nghìn
    .replace(/(\d+)[.,](\d+)/g, (m, a, b) => viNumber(+a) + ' phẩy ' + (b.length <= 2 ? viNumber(+b) : b.split('').map(d => VI_DIG[d]).join(' ')))
    .replace(/\d+/g, (m) => viNumber(+m))
    .replace(/&/g, ' và ').replace(/\+/g, ' cộng ').replace(/=/g, ' bằng ').replace(/@/g, ' a còng ')
    .replace(/\s+/g, ' ').trim();
}

// Tokenizer giống VitsTokenizer (normalize + add_blank): chữ thường, chỉ giữ ký tự có trong vocab, chèn id 0 giữa các ký tự
export function mmsIds(text, vocab) {
  const chars = [...text.toLowerCase()].filter(c => c in vocab);
  while (chars.length && chars[0] === ' ') chars.shift();
  while (chars.length && chars[chars.length - 1] === ' ') chars.pop();
  const ids = [0];
  for (const c of chars) ids.push(vocab[c], 0);
  return ids;
}

// Tổng hợp cả câu: tách theo dấu câu để có quãng nghỉ tự nhiên (MMS bỏ dấu câu)
export async function mmsSynth(ort, session, vocab, text) {
  const SR = 16000;
  const parts = viNormalize(text).split(/([.,;:!?…]+)/);
  const pcm = [];
  for (let i = 0; i < parts.length; i += 2) {
    const ids = mmsIds(parts[i] || '', vocab);
    if (ids.length < 3) continue;
    const feeds = { input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]) };
    if (session.inputNames.includes('attention_mask')) feeds.attention_mask = new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
    const out = await session.run(feeds);
    const wave = (out.waveform || out[session.outputNames[0]]).data;
    pcm.push(wave);
    const p = parts[i + 1] || '';
    const pause = /[.!?…;:]/.test(p) ? 0.28 : p ? 0.14 : 0;
    if (pause && i + 2 < parts.length) pcm.push(new Float32Array(Math.round(SR * pause)));
  }
  const total = pcm.reduce((a, b) => a + b.length, 0);
  const all = new Float32Array(total);
  let o = 0; for (const b of pcm) { all.set(b, o); o += b.length; }
  return { pcm: all, sampleRate: SR };
}
