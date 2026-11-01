// Danh mục giọng hợp nhất cho thuyết minh. Mỗi giọng có id dạng "<engine>:<khoá>":
//   piper:<model>  — giọng neural chạy offline trên máy (Piper, tải model 1 lần)
//   sys:<voiceURI> — giọng hệ thống của Windows/trình duyệt (Web Speech API)
//   google         — giọng Google Translate (online, 1 giọng nữ/ngôn ngữ)
//   cloud:<id>     — Azure / Google Cloud (Chirp 3 HD) / Gemini / OpenAI / ElevenLabs (online, cần key của người dùng)
// Dùng chung cho content script (thuyết minh) và popup (chọn/nghe thử giọng).

const YSN_PIPER_VOICES = [
  // key = <locale>-<tên>-<chất lượng>; giới tính vi đo bằng cao độ (vais1000 ≈ 237 Hz → nữ), còn lại theo tên model
  { key: 'vi_VN-vais1000-medium', name: 'Vais', gender: 'female', mb: 63, license: 'CC BY 4.0' },
  { key: 'en_US-amy-medium', name: 'Amy', gender: 'female', mb: 63 },
  { key: 'en_US-lessac-medium', name: 'Lessac', gender: 'female', mb: 63 },
  { key: 'en_US-hfc_female-medium', name: 'HFC', gender: 'female', mb: 63 },
  { key: 'en_US-ryan-medium', name: 'Ryan', gender: 'male', mb: 63 },
  { key: 'en_US-joe-medium', name: 'Joe', gender: 'male', mb: 63 },
  { key: 'en_US-hfc_male-medium', name: 'HFC', gender: 'male', mb: 63 },
  { key: 'en_GB-alba-medium', name: 'Alba', gender: 'female', mb: 63 },
  { key: 'en_GB-northern_english_male-medium', name: 'Northern', gender: 'male', mb: 63 },
  { key: 'fr_FR-siwis-medium', name: 'Siwis', gender: 'female', mb: 63 },
  { key: 'fr_FR-tom-medium', name: 'Tom', gender: 'male', mb: 63 },
  { key: 'de_DE-kerstin-low', name: 'Kerstin', gender: 'female', mb: 63 },
  { key: 'de_DE-thorsten-medium', name: 'Thorsten', gender: 'male', mb: 63 },
  { key: 'es_ES-davefx-medium', name: 'Davefx', gender: 'male', mb: 63 },
  { key: 'ru_RU-irina-medium', name: 'Irina', gender: 'female', mb: 63 },
  { key: 'ru_RU-dmitri-medium', name: 'Dmitri', gender: 'male', mb: 63 },
  { key: 'zh_CN-huayan-medium', name: 'Huayan', gender: 'female', mb: 63 },
  { key: 'pt_BR-faber-medium', name: 'Faber', gender: 'male', mb: 63 },
].map(v => {
  const [loc, model, q] = v.key.split('-');
  return { ...v, lang: loc.replace('_', '-'), path: `${loc.split('_')[0]}/${loc}/${model}/${q}/${v.key}.onnx` };
});
// MMS-TTS của Meta (VITS theo chữ cái, không cần espeak): giọng NAM tiếng Việt offline, cao độ đo ≈ 118 Hz.
// Đọc chậm, rõ (≈ 10 ký tự/giây) → cho phép tăng tốc tới 2×; giấy phép CC BY-NC 4.0 (chỉ dùng cá nhân, phi thương mại).
YSN_PIPER_VOICES.splice(1, 0,
  { key: 'mms-vie', name: 'MMS', gender: 'male', mb: 114, license: 'CC BY-NC 4.0, phi thương mại', lang: 'vi-VN', path: 'mms/vie', kind: 'mms', maxRate: 2 });
// Bản bán (store): dữ liệu huấn luyện của các giọng offline này (Piper, MMS) cấm dùng thương mại → không đưa vào.
if (typeof YSN_EDITION !== 'undefined' && YSN_EDITION === 'store') YSN_PIPER_VOICES.length = 0;

const YSN_ENGINE_INFO = {
  piper: { label: 'neural offline', rank: 0 },
  cloud: { label: 'online, cần key', rank: 1 },
  sys: { label: 'giọng hệ thống', rank: 2 },
  google: { label: 'online miễn phí', rank: 3 },
};

const ysnBaseLang = (l) => (l || '').toLowerCase().split(/[-_]/)[0];
const ysnSameLang = (a, b) => ysnBaseLang(a) === ysnBaseLang(b);

// Gộp mọi nguồn giọng cho ngôn ngữ đích.
//   sysVoices:   [{name, lang, voiceURI}]   (speechSynthesis.getVoices())
//   cloudVoices: [{id, locale, gender, label}] (nếu đã nhập key)
//   piperCached: {path: true/false}
function ysnBuildVoiceList({ target, sysVoices = [], cloudVoices = [], piperCached = {} }) {
  const list = [];
  for (const v of YSN_PIPER_VOICES) if (ysnSameLang(v.lang, target)) {
    list.push({ id: 'piper:' + v.key, engine: 'piper', name: v.name, lang: v.lang, gender: v.gender, path: v.path,
      mb: v.mb, license: v.license, ready: !!piperCached[v.path], natural: v.kind !== 'mms', kind: v.kind || 'piper', maxRate: v.maxRate,
      title: v.license ? `Giấy phép ${v.license}` : '' });
  }
  for (const v of cloudVoices) if (v.locale === '*' || ysnSameLang(v.locale, target)) {
    const g = (v.gender || '').toLowerCase();
    const tier = v.tier ?? (/Chirp|Studio|DragonHD/i.test(v.id) ? 3 : /Neural|Wavenet/i.test(v.id) ? 2 : 1);
    list.push({ id: 'cloud:' + v.id, engine: 'cloud', name: v.label, lang: v.locale === '*' ? target : v.locale,
      gender: g === 'female' || g === 'male' ? g : 'unknown', cloudId: v.id, ready: true, natural: tier >= 2,
      expressive: tier >= 3, tier, fixedRate: !!v.fixedRate });
  }
  for (const v of sysVoices) if (ysnSameLang(v.lang, target)) {
    list.push({ id: 'sys:' + v.voiceURI, engine: 'sys', name: v.name.replace(/^Microsoft |^Google /, '').replace(/ - .*$/, '').replace(/ Online \(Natural\)/, ''),
      fullName: v.name, lang: v.lang, gender: ysnGuessGender(v), uri: v.voiceURI, ready: true, natural: /natural|neural|online/i.test(v.name) });
  }
  // Google Translate TTS: có cho hầu hết ngôn ngữ, giọng nữ
  list.push({ id: 'google', engine: 'google', name: 'Google', lang: target, gender: 'female', ready: true, natural: false });
  // giọng biểu cảm giống người (Chirp 3 HD, Gemini, OpenAI, ElevenLabs, Azure HD/đa ngôn ngữ) xếp đầu tiên
  const rank = (v) => YSN_ENGINE_INFO[v.engine].rank * 10 - (v.natural ? 5 : 0) - (v.expressive ? 12 : 0) - (v.tier ? v.tier : 0) - (v.ready ? 0 : -20);
  return list.sort((a, b) => rank(a) - rank(b));
}

// Chọn giọng sẽ dùng. voiceId cụ thể → dùng nếu có; 'auto' → theo giới tính + chất lượng (không tự tải model).
function ysnResolveVoice(list, s) {
  if (s.voiceId && s.voiceId !== 'auto') {
    const v = list.find(x => x.id === s.voiceId);
    if (v && (v.engine !== 'piper' || v.ready || s.allowPiperDownload)) return v;
  }
  const g = s.dubGender || 'any';
  const usable = list.filter(v => v.ready);
  const byGender = usable.filter(v => g === 'any' || v.gender === g);
  return byGender[0] || usable[0] || null;
}

// Gửi thẳng tới offscreen document (giọng Piper, phiên âm): không đi qua service worker, vì service worker
// có thể bị Chrome tắt khi một yêu cầu chạy lâu (vd. tải model 63 MB lần đầu).
async function ysnOffscreen(msg) {
  const send = () => chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
  try { const r = await send(); if (r !== undefined) return r; } catch { /* offscreen chưa mở */ }
  await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });
  return send();
}
