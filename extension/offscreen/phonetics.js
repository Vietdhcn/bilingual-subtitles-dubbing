// Phiên âm cho dòng phụ đề gốc — chạy offline trong offscreen document.
//   • Ngôn ngữ chữ Latinh (en, fr, de, es, it, pt, vi, …) + Thái, Hindi, Hy Lạp: IPA từ espeak-ng
//     (tiếng Anh được chỉnh về kiểu từ điển: dấu nhấn đặt đầu âm tiết, r thay ɹ, bỏ dấu nhấn ở từ 1 âm tiết).
//   • Tiếng Trung: pinyin có dấu thanh (pinyin-pro, MIT).
//   • Tiếng Hàn: Latinh hoá theo Romanization chuẩn (đơn giản hoá).
//   • Chữ Kirin (ru, uk, bg, sr, be, mk, kk): chuyển tự Latinh.
//   • Tiếng Nhật: chưa hỗ trợ (espeak không đọc được Kanji) → trả chuỗi rỗng.
import { pinyin } from './vendor/pinyin-pro.min.mjs';

const VOWELS = new Set([...'aeiouyæɑɒɔəɛɜɪʊʌøœɐɚɝɤɯʉɨɘɵɞʏɶ']);
const MARKS = new Set(['ˈ', 'ˌ']);
const EN_ONSETS = new Set(('pl bl kl ɡl fl sl pr br tr dr kr ɡr fr θr ʃr tw dw kw ɡw sw θw sp st sk sm sn sf ' +
  'pj bj tj dj kj ɡj mj nj fj vj θj sj zj lj hj spl spr str skr skw spj stj skj').split(' '));
const isVowel = (ch) => VOWELS.has(ch);

// Tách chuỗi phụ âm thành đơn vị (tʃ, dʒ là một đơn vị).
function consonantUnits(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === 'tʃ' || two === 'dʒ') { out.push(two); i++; } else out.push(s[i]);
  }
  return out;
}

// Dời dấu nhấn (ˈ ˌ) từ trước nguyên âm lên đầu âm tiết (trước cụm phụ âm đầu hợp lệ).
function relocateStress(word, legalOnset) {
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    if (!MARKS.has(chars[i])) continue;
    let j = i - 1;
    while (j >= 0 && !isVowel(chars[j]) && !MARKS.has(chars[j]) && chars[j] !== 'ː') j--;
    const run = chars.slice(j + 1, i).join('');
    if (!run) continue;
    const units = consonantUnits(run);
    let take = 0;
    for (let n = units.length; n >= 1; n--) { if (legalOnset(units.slice(units.length - n))) { take = n; break; } }
    if (!take) continue;
    const moveLen = units.slice(units.length - take).join('').length;
    const mark = chars[i];
    chars.splice(i, 1);
    chars.splice(i - [...units.slice(units.length - take).join('')].length, 0, mark);
    void moveLen;
  }
  return chars.join('');
}

function syllableCount(word) {
  let n = 0, prev = false;
  for (const ch of word) { const v = isVowel(ch); if (v && !prev) n++; prev = v; }
  return n;
}

export function prettyIpa(ipa, lang) {
  const en = lang.startsWith('en');
  let s = ipa;
  if (en) s = s.replace(/ɹ/g, 'r').replace(/ɐ/g, 'ə').replace(/ᵻ/g, 'ɪ').replace(/ɾ/g, 't').replace(/ʔ/g, '');
  const legal = en
    ? (units) => units.length === 1 || EN_ONSETS.has(units.join(''))
    : (units) => units.length === 1 || (units.length === 2 && /[rlwjɾʁʎ]/.test(units[1]));
  return s.split(/(\s+)/).map(tok => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const m = tok.match(/^(.*?)([.,!?;:…"'”’)\]]*)$/);
    let w = m[1]; const tail = m[2];
    if (syllableCount(w) <= 1) w = w.replace(/[ˈˌ]/g, '');
    else w = relocateStress(w, legal);
    return w + tail;
  }).join('');
}

// ---------- Hàn: Revised Romanization (giản lược, có nối âm cơ bản) ----------
const KO_INI = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const KO_MED = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const KO_FIN = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// phụ âm cuối khi nối sang âm tiết bắt đầu bằng ㅇ
const KO_FIN_LINK = ['', 'g', 'kk', 'ks', 'n', 'nj', 'nh', 'd', 'r', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];
export function hangulToRoman(text) {
  const syl = [...text].map(ch => {
    const c = ch.codePointAt(0) - 0xAC00;
    if (c < 0 || c > 11171) return { raw: ch };
    return { i: Math.floor(c / 588), m: Math.floor((c % 588) / 28), f: c % 28 };
  });
  let out = '';
  for (let k = 0; k < syl.length; k++) {
    const s = syl[k];
    if (s.raw !== undefined) { out += s.raw; continue; }
    const next = syl[k + 1];
    const link = next && next.raw === undefined && next.i === 11 && s.f && s.f !== 21;
    out += (k > 0 && syl[k - 1].linked ? '' : KO_INI[s.i]) + KO_MED[s.m];
    if (link) { out += KO_FIN_LINK[s.f]; next.linked = true; }
    else {
      // biến âm mũi: phụ âm cuối p/k/t trước ㄴ, ㅁ → m/ng/n (vd. 합니다 → hamnida)
      let fin = KO_FIN[s.f];
      if (next && next.raw === undefined && (next.i === 2 || next.i === 6)) fin = { p: 'm', k: 'ng', t: 'n' }[fin] ?? fin;
      out += fin;
    }
  }
  return out;
}

// ---------- Chữ Kirin → Latinh ----------
const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ђ: 'đ', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'ć', џ: 'dž', ў: 'w', қ: 'q', ғ: 'gh', ң: 'ng', ү: 'ü', ұ: 'u', һ: 'h', ә: 'ä', ө: 'ö' };
export function cyrillicToLatin(text, lang) {
  const map = { ...CYR, ...(lang === 'uk' ? { г: 'h', и: 'y', е: 'e' } : {}) };
  return [...text].map(ch => {
    const lo = ch.toLowerCase(); const t = map[lo];
    if (t === undefined) return ch;
    return ch !== lo && t ? t[0].toUpperCase() + t.slice(1) : t;
  }).join('');
}

const ESPEAK_VOICE = { en: 'en-us', pt: 'pt-br', zh: 'cmn', el: 'el', hi: 'hi', th: 'th', vi: 'vi' };

// texts → phiên âm. phonemizeBatch(texts, espeakVoice) trả (Promise) mảng {text, phonemes:[…]}.
export async function phoneticLines({ lang, texts, accent = 'us' }, phonemizeBatch) {
  const base = (lang || '').toLowerCase().split(/[-_]/)[0];
  if (base === 'zh') return texts.map(t => pinyin(t, { toneType: 'symbol', nonZh: 'consecutive' }).replace(/\s+([，。！？、；：,.!?;:])/g, '$1'));
  if (base === 'ko') return texts.map(hangulToRoman);
  if (['ru', 'uk', 'bg', 'sr', 'be', 'mk', 'kk'].includes(base)) return texts.map(t => cyrillicToLatin(t, base));
  if (base === 'ja') return texts.map(() => '');
  const voice = base === 'en' ? (accent === 'uk' ? 'en-gb-x-rp' : 'en-us') : (ESPEAK_VOICE[base] || base);
  // Phiên âm TỪNG TỪ (người học cần tách bạch từng từ; espeak đọc cả câu sẽ dính các từ ngắn: "ʌvðə").
  // Gom các từ khác nhau của cả lô vào một lần gọi espeak.
  let seg = null;
  try { seg = new Intl.Segmenter(base || undefined, { granularity: 'word' }); } catch { /* ignore */ }
  if (!seg) {
    const rows = await phonemizeBatch(texts, voice);
    const byText = new Map(rows.map(r => [r.text, r.phonemes.join('')]));
    return texts.map(t => { const p = byText.get(t); return p ? prettyIpa(p, base) : ''; });
  }
  const keyOf = (w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase());   // giữ chữ hoa cho từ viết tắt (US, NASA)
  const tokenized = texts.map(t => [...seg.segment(t)]);
  const uniq = [...new Set(tokenized.flat().filter(x => x.isWordLike).map(x => keyOf(x.segment)))];
  const rows = uniq.length ? await phonemizeBatch(uniq, voice) : [];
  const ipaOf = new Map(rows.map(r => [r.text, prettyIpa(r.phonemes.join('').replace(/[.,!?;:]+$/, ''), base)]));
  if (base === 'en' && texts.some(t => t.split(/\s+/).length > 1)) ipaOf.set('a', 'ə');   // mạo từ "a" trong câu đọc là /ə/
  return tokenized.map(segs => segs.map(x => {
    if (x.isWordLike) return ipaOf.get(keyOf(x.segment)) ?? x.segment;
    return /\s/.test(x.segment) ? ' ' : x.segment;                          // giữ dấu câu, chuẩn hoá khoảng trắng
  }).join('').replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim());
}
