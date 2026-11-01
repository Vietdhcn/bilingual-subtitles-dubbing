// TTS qua API chính thức, dùng key của người dùng (nhập trong trang Nâng cao):
//   - azure      Azure Speech: gói F0 miễn phí 0.5 triệu ký tự/tháng — vi-VN HoaiMy, NamMinh + giọng ĐA NGÔN NGỮ
//                (…MultilingualNeural, DragonHD) đọc được tiếng Việt, biểu cảm hơn.
//   - gcloud     Google Cloud Text-to-Speech: Chirp 3 HD (30 giọng rất giống người, có vi-VN), Neural2/Wavenet/Standard.
//   - gemini     Gemini TTS (gemini-3.8-flash-tts): 30 giọng, điều khiển cảm xúc bằng câu chữ (style), có tiếng Việt.
//   - openai     OpenAI gpt-4o-mini-tts: 13 giọng, điều khiển cách đọc bằng chỉ dẫn (instructions), có tiếng Việt.
//   - elevenlabs ElevenLabs (v4 / v3 / flash v2.5): giọng biểu cảm nhất, có tiếng Việt.
// Giọng được chuẩn hoá thành { id, locale, gender: 'Female'|'Male'|'Neutral', label, tier, fixedRate }:
//   locale '*'     = giọng đa ngôn ngữ, đọc được mọi ngôn ngữ đích
//   tier 3/2/1     = biểu cảm giống người / neural / thường (dùng để xếp hạng)
//   fixedRate true = API không nhận tốc độ → tổng hợp 1 lần ở tốc độ tự nhiên, co giãn khi phát (giữ cao độ)

const YSN_TTS_STYLE_DEFAULT = 'Giọng thuyết minh phim tự nhiên, ấm áp, truyền cảm; ngữ điệu và cảm xúc theo đúng nội dung từng câu như người thật đang kể, không đọc đều đều như máy.';

// Gemini TTS & Google Chirp 3 HD dùng chung bộ 30 giọng (tên sao); giới tính theo tài liệu Chirp 3 HD.
const YSN_STAR_VOICES = [
  ['Achernar', 'Female', 'mềm mại'], ['Aoede', 'Female', 'nhẹ nhàng'], ['Autonoe', 'Female', 'tươi sáng'], ['Callirrhoe', 'Female', 'thoải mái'],
  ['Despina', 'Female', 'êm'], ['Erinome', 'Female', 'rõ ràng'], ['Gacrux', 'Female', 'trưởng thành'], ['Kore', 'Female', 'chắc giọng'],
  ['Laomedeia', 'Female', 'vui tươi'], ['Leda', 'Female', 'trẻ trung'], ['Pulcherrima', 'Female', 'mạnh mẽ'], ['Sulafat', 'Female', 'ấm áp'],
  ['Vindemiatrix', 'Female', 'dịu dàng'], ['Zephyr', 'Female', 'tươi sáng'],
  ['Achird', 'Male', 'thân thiện'], ['Algenib', 'Male', 'khàn'], ['Algieba', 'Male', 'êm'], ['Alnilam', 'Male', 'chắc giọng'],
  ['Charon', 'Male', 'truyền đạt'], ['Enceladus', 'Male', 'hơi thở'], ['Fenrir', 'Male', 'hào hứng'], ['Iapetus', 'Male', 'rõ ràng'],
  ['Orus', 'Male', 'chắc giọng'], ['Puck', 'Male', 'vui tươi'], ['Rasalgethi', 'Male', 'truyền đạt'], ['Sadachbia', 'Male', 'sôi nổi'],
  ['Sadaltager', 'Male', 'hiểu biết'], ['Schedar', 'Male', 'đều giọng'], ['Umbriel', 'Male', 'thoải mái'], ['Zubenelgenubi', 'Male', 'tự nhiên'],
];
const YSN_OPENAI_VOICES = [
  ['marin', 'Female'], ['cedar', 'Male'], ['coral', 'Female'], ['nova', 'Female'], ['shimmer', 'Female'], ['sage', 'Female'],
  ['ash', 'Male'], ['ballad', 'Male'], ['echo', 'Male'], ['onyx', 'Male'], ['verse', 'Male'], ['fable', 'Male'], ['alloy', 'Neutral'],
];

const cloudVoiceCache = new Map(); // provider|key → voices

function ttsKeyOf(opts) {
  const p = opts.ttsProvider;
  return p === 'azure' ? opts.azureRegion + opts.azureKey : p === 'gcloud' ? opts.gcloudKey : p === 'gemini' ? opts.geminiKey
    : p === 'openai' ? opts.openaiKey : p === 'elevenlabs' ? opts.elevenKey : '';
}

async function httpError(res, what) {
  let detail = '';
  try { const t = await res.text(); const j = JSON.parse(t); detail = j.error?.message || j.detail?.message || j.detail || j.message || t; } catch { /* không có thân */ }
  detail = String(detail || '').replace(/\s+/g, ' ').slice(0, 160);
  const hint = res.status === 401 || res.status === 403 ? ' — key sai hoặc chưa bật quyền' : res.status === 429 ? ' — vượt hạn mức, thử lại sau' : '';
  return new Error(`${what} HTTP ${res.status}${hint}${detail ? ': ' + detail : ''}`);
}

async function cloudListVoices(opts) {
  const p = opts.ttsProvider;
  const cacheKey = `${p}|${ttsKeyOf(opts)}`;
  if (cloudVoiceCache.has(cacheKey)) return cloudVoiceCache.get(cacheKey);
  let voices = [];
  if (p === 'azure') {
    if (!opts.azureKey || !opts.azureRegion) throw new Error('Chưa nhập Azure key/region trong trang Nâng cao');
    const res = await fetch(`https://${opts.azureRegion}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': opts.azureKey },
    });
    if (!res.ok) throw await httpError(res, 'Azure voices');
    for (const v of await res.json()) {
      const name = v.LocalName || v.DisplayName;
      const hd = /DragonHD/i.test(v.ShortName), multi = /Multilingual/i.test(v.ShortName);
      const tier = hd ? 3 : multi ? 2.5 : /Neural/i.test(v.ShortName) ? 2 : 1;
      voices.push({ id: v.ShortName, locale: v.Locale, gender: v.Gender, label: `${name}${hd ? ' HD' : ''} (${v.Locale})`, tier });
      // giọng đa ngôn ngữ: đọc được thêm các ngôn ngữ phụ → thêm một mục cho mỗi ngôn ngữ (id = Tên@ngôn-ngữ)
      const extra = Array.isArray(v.SecondaryLocaleList) ? v.SecondaryLocaleList : (hd || multi ? ['*'] : []);
      for (const loc of extra) if (loc !== v.Locale) {
        voices.push({ id: `${v.ShortName}@${loc}`, locale: loc, gender: v.Gender, label: `${name}${hd ? ' HD' : ''} – đa ngôn ngữ (${v.Locale})`, tier });
      }
    }
  } else if (p === 'gcloud') {
    if (!opts.gcloudKey) throw new Error('Chưa nhập Google Cloud API key trong trang Nâng cao');
    const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(opts.gcloudKey)}`);
    if (!res.ok) throw await httpError(res, 'Google Cloud voices');
    voices = ((await res.json()).voices || []).flatMap(v => (v.languageCodes || []).map(lc => ({
      id: v.name, locale: lc, gender: v.ssmlGender === 'FEMALE' ? 'Female' : v.ssmlGender === 'MALE' ? 'Male' : 'Neutral',
      label: `${v.name.replace(/^[a-z]{2,3}-[A-Z]{2}-/, '').replace('Chirp3-HD-', 'Chirp 3 HD ')} (${lc})`,
      tier: /Chirp3-HD|Chirp-HD|Studio/i.test(v.name) ? 3 : /Neural2|Wavenet|Polyglot|News/i.test(v.name) ? 2 : 1,
    })));
  } else if (p === 'gemini') {
    if (!opts.geminiKey) throw new Error('Chưa nhập Gemini API key trong trang Nâng cao');
    voices = YSN_STAR_VOICES.map(([n, g, d]) => ({ id: 'gemini:' + n, locale: '*', gender: g, label: `${n} – ${d} (Gemini)`, tier: 3, fixedRate: true }));
  } else if (p === 'openai') {
    if (!opts.openaiKey) throw new Error('Chưa nhập OpenAI API key trong trang Nâng cao');
    voices = YSN_OPENAI_VOICES.map(([n, g]) => ({ id: 'openai:' + n, locale: '*', gender: g, label: `${n[0].toUpperCase() + n.slice(1)} (OpenAI)`, tier: 3, fixedRate: true }));
  } else if (p === 'elevenlabs') {
    if (!opts.elevenKey) throw new Error('Chưa nhập ElevenLabs API key trong trang Nâng cao');
    const res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: { 'xi-api-key': opts.elevenKey } });
    if (!res.ok) throw await httpError(res, 'ElevenLabs voices');
    voices = ((await res.json()).voices || []).map(v => {
      const g = (v.labels?.gender || '').toLowerCase();
      return { id: 'eleven:' + v.voice_id, locale: '*', gender: g === 'female' ? 'Female' : g === 'male' ? 'Male' : 'Neutral',
        label: `${v.name} (ElevenLabs)`, tier: 3, fixedRate: true };
    });
  } else throw new Error('Chưa chọn dịch vụ giọng đọc online');
  cloudVoiceCache.set(cacheKey, voices);
  return voices;
}

const xmlEsc = (s) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
function toDataUrl(buf, mime = 'audio/mpeg') {
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,` + btoa(bin);
}

// Trả về data URL âm thanh. Giọng fixedRate (gemini/openai/elevenlabs) bỏ qua rate/pitch: phía phát tự co giãn.
async function cloudSynthesize(text, voice, rate, opts, pitch = 1) {
  const p = opts.ttsProvider;
  const style = (opts.ttsStyle || YSN_TTS_STYLE_DEFAULT).trim();
  if (p === 'azure') {
    const [name, otherLoc] = voice.split('@');
    const locale = name.match(/^([a-z]{2,3}-[A-Z]{2})/)?.[1] || 'en-US';
    const pct = Math.round((rate - 1) * 100), pp = Math.round((pitch - 1) * 100);
    const body = otherLoc && otherLoc !== '*' ? `<lang xml:lang='${otherLoc}'>${xmlEsc(text)}</lang>` : xmlEsc(text);
    const ssml = (withProsody) => `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'><voice name='${name}'>` +
      (withProsody ? `<prosody rate='${pct >= 0 ? '+' : ''}${pct}%' pitch='${pp >= 0 ? '+' : ''}${pp}%'>${body}</prosody>` : body) + `</voice></speak>`;
    const call = (withProsody) => fetch(`https://${opts.azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': opts.azureKey, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
      body: ssml(withProsody),
    });
    let res = await call(true);
    if (res.status === 400) res = await call(false);           // giọng HD không nhận prosody → đọc ở tốc độ tự nhiên
    if (!res.ok) throw await httpError(res, 'Azure TTS');
    return toDataUrl(await res.arrayBuffer());
  }
  if (p === 'gcloud') {
    const lc = voice.match(/^([a-z]{2,3}-[A-Z]{2})/)?.[1] || 'en-US';
    const chirp = /Chirp/i.test(voice);                         // Chirp 3 HD: tốc độ 0.25–2, không có pitch
    const audioConfig = { audioEncoding: 'MP3', speakingRate: Math.max(0.25, Math.min(chirp ? 2 : 4, rate)) };
    if (!chirp) audioConfig.pitch = Math.max(-20, Math.min(20, 12 * Math.log2(pitch || 1)));
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(opts.gcloudKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: lc, name: voice }, audioConfig }),
    });
    if (!res.ok) throw await httpError(res, 'Google Cloud TTS');
    return 'data:audio/mpeg;base64,' + (await res.json()).audioContent;
  }
  if (p === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', headers: { 'x-goog-api-key': opts.geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.geminiTtsModel || 'gemini-3.8-flash-tts',
        input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: voice.replace(/^gemini:/, '') }] },
      }),
    });
    if (!res.ok) throw await httpError(res, 'Gemini TTS');
    const j = await res.json();
    const audio = (j.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []).filter(c => c.type === 'audio').pop();
    if (!audio?.data) throw new Error('Gemini TTS không trả âm thanh');
    return `data:${audio.mime_type || audio.mimeType || 'audio/wav'};base64,` + audio.data;
  }
  if (p === 'openai') {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', headers: { Authorization: `Bearer ${opts.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.openaiTtsModel || 'gpt-4o-mini-tts', voice: voice.replace(/^openai:/, ''), input: text.slice(0, 4096), instructions: style, response_format: 'mp3' }),
    });
    if (!res.ok) throw await httpError(res, 'OpenAI TTS');
    return toDataUrl(await res.arrayBuffer());
  }
  if (p === 'elevenlabs') {
    const lang = (opts.targetLang || '').split('-')[0] || undefined;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.replace(/^eleven:/, ''))}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': opts.elevenKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: opts.elevenModel || 'eleven_v4_turbo', language_code: lang, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!res.ok) throw await httpError(res, 'ElevenLabs TTS');
    return toDataUrl(await res.arrayBuffer());
  }
  throw new Error('Chưa chọn dịch vụ giọng đọc online');
}
