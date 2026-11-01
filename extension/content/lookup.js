// Bảng tra từ: bấm một chữ trong phụ đề → phiên âm, phát âm (giọng thật nếu có), nghĩa theo từ loại.
const YSNLookup = {
  card: null, host: null, wordEl: null, video: null, pausedByUs: false, reqId: 0,

  async open(wordEl, { word, srcLang, tgtLang, kind, settings, video, host }) {
    this.close(false);
    const fromLang = kind === 'tgt' ? tgtLang : srcLang;      // bấm vào dòng dịch → tra ngược
    const toLang = kind === 'tgt' ? srcLang : tgtLang;
    this.host = host; this.video = video; this.wordEl = wordEl;
    wordEl.classList.add('ysn-w-active');
    if (settings.lookupPause && video && !video.paused) { video.pause(); this.pausedByUs = true; }

    const card = document.createElement('div');
    card.id = 'ysn-lookup'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Tra từ ' + word);
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart', 'keydown']) card.addEventListener(type, e => e.stopPropagation());
    const head = el('div', 'lk-head');
    const w = el('div', 'lk-word', word);
    const ipa = el('div', 'lk-ipa', '…');
    const close = btn('lk-close', '✕', 'Đóng'); close.onclick = () => this.close();
    const star = btn('lk-save', '☆ Lưu', 'Lưu từ này vào sổ từ'); star.disabled = true;
    const tools = el('div', 'lk-tools'); tools.append(star, close);
    const audio = el('div', 'lk-audio');
    head.append(w, tools);
    // câu chứa từ (để ôn lại theo ngữ cảnh)
    const ov = wordEl.closest('#ysn-overlay');
    const ctxOr = ov?.querySelector('.ysn-original')?.textContent || '', ctxTr = ov?.querySelector('.ysn-translated')?.textContent || '';
    const body = el('div', 'lk-body');
    body.append(el('div', 'lk-loading', 'Đang tra…'));
    card.append(head, ipa, audio, body);
    host.appendChild(card);
    this.card = card;
    this._place();

    this._onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    this._onOutside = (e) => { if (this.card && !this.card.contains(e.target) && !e.target.closest?.('.ysn-w')) this.close(); };
    document.addEventListener('keydown', this._onKey, true);
    setTimeout(() => document.addEventListener('pointerdown', this._onOutside, true), 0);

    const my = ++this.reqId;
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: 'LOOKUP', word, source: fromLang, target: toLang, accent: settings.phoneticAccent }); }
    catch (e) { r = { ok: false, error: e.message }; }
    if (my !== this.reqId || !this.card) return;
    body.replaceChildren();
    if (!r?.ok) { body.append(el('div', 'lk-err', 'Không tra được: ' + (r?.error || 'lỗi kết nối'))); return; }
    const e = r.entry;
    // sổ từ: lưu từ + phiên âm + nghĩa + câu ngữ cảnh
    const key = (fromLang + ':' + word).toLowerCase();
    const setStar = (on) => { star.textContent = on ? '★ Đã lưu' : '☆ Lưu'; star.classList.toggle('on', on); star.title = on ? 'Bấm để bỏ khỏi sổ từ' : 'Lưu từ này vào sổ từ (xem ở trang Cài đặt nâng cao)'; };
    YSNWords.has(key).then(setStar);
    star.disabled = false;
    star.onclick = async () => {
      if (await YSNWords.has(key)) { await YSNWords.remove(key); setStar(false); return; }
      const firstDef = e.meanings?.[0]?.defs?.[0];
      await YSNWords.add({
        key, word, lang: fromLang, to: toLang, ipa: e.ipa || e.dictIpa?.[0] || '', meaning: e.translation || firstDef?.defVi || '',
        pos: e.meanings?.[0]?.posVi || '', def: firstDef?.def || '', sentence: kind === 'tgt' ? ctxTr : ctxOr, sentenceTr: kind === 'tgt' ? ctxOr : ctxTr,
        url: location.href, time: video ? Math.floor(video.currentTime) : null, at: Date.now(),
      });
      setStar(true);
    };

    // phiên âm chính: IPA offline theo giọng Mỹ/Anh đã chọn; các dạng trong từ điển hiện thêm (vd. dạng nhấn / dạng nhẹ)
    ipa.textContent = e.ipa || e.dictIpa?.[0] || '';
    if (!ipa.textContent) ipa.remove();
    const extra = (e.dictIpa || []).filter(x => x.replace(/[\/\[\]]/g, '') !== (e.ipa || '').replace(/[\/\[\]]/g, ''));
    if (extra.length && ipa.isConnected) ipa.after(el('div', 'lk-ipa2', 'Từ điển: ' + extra.join(', ')));

    // phát âm: file giọng thật theo từng giọng (US/UK) nếu có; luôn có nút đọc bằng giọng máy + đọc chậm
    const seenAcc = new Set();
    for (const p of e.phonetics) {
      if (!p.audio || seenAcc.has(p.accent || p.audio)) continue;
      seenAcc.add(p.accent || p.audio);
      const label = { us: 'Anh-Mỹ', uk: 'Anh-Anh', au: 'Anh-Úc' }[p.accent] || 'Phát âm';
      const b = btn('lk-play', '▶ ' + label, 'Nghe phát âm ' + label);
      b.onclick = () => playRemote(p.audio, b);
      audio.append(b);
    }
    const tts = btn('lk-play', seenAcc.size ? '▶ Giọng máy' : '▶ Phát âm', 'Đọc bằng giọng máy'); tts.onclick = () => speak(word, fromLang, 1);
    const slow = btn('lk-play', '▶ Chậm', 'Đọc chậm'); slow.onclick = () => speak(word, fromLang, 0.55);
    audio.append(tts, slow);

    if (e.translation) body.append(el('div', 'lk-tr', e.translation));
    for (const m of e.meanings) {
      const sense = el('div', 'lk-sense');
      sense.append(el('div', 'lk-pos', m.posVi || m.pos));
      for (const d of m.defs) {
        const item = el('div', 'lk-def');
        if (d.defVi) item.append(el('div', 'lk-def-vi', d.defVi));
        item.append(el('div', 'lk-def-src', d.def));
        if (d.example) item.append(el('div', 'lk-ex', '“' + d.example + '”'));
        sense.append(item);
      }
      if (m.synonyms?.length) sense.append(el('div', 'lk-syn', 'Đồng nghĩa: ' + m.synonyms.join(', ')));
      body.append(sense);
    }
    if (!e.translation && !e.meanings.length) body.append(el('div', 'lk-err', 'Chưa có nghĩa cho từ này. Mở popup để tải gói dịch trên máy nếu bạn chưa tải.'));
    const src = [e.dict ? 'Từ điển ' + e.dict : null, e.provider ? 'dịch bằng ' + ({ chrome: 'Chrome (trên máy)', google: 'Google', azure: 'Azure', claude: 'Claude' }[e.provider] || e.provider) : null].filter(Boolean).join(', ');
    if (src) body.append(el('div', 'lk-src', src));
    this._place();
  },

  _place() {
    const card = this.card, host = this.host, w = this.wordEl;
    if (!card || !host || !w) return;
    const hr = host.getBoundingClientRect(), wr = w.getBoundingClientRect();
    const margin = 8, width = Math.min(360, hr.width - margin * 2);
    card.style.width = width + 'px';
    const above = wr.top - hr.top, below = hr.bottom - wr.bottom;
    const placeAbove = above >= below;
    card.style.maxHeight = Math.max(140, (placeAbove ? above : below) - margin * 2) + 'px';
    let left = wr.left - hr.left + wr.width / 2 - width / 2;
    left = Math.max(margin, Math.min(hr.width - width - margin, left));
    card.style.left = left + 'px';
    if (placeAbove) { card.style.top = ''; card.style.bottom = (hr.bottom - wr.top + 6) + 'px'; }
    else { card.style.bottom = ''; card.style.top = (wr.bottom - hr.top + 6) + 'px'; }
  },

  close(resume = true) {
    this.reqId++;
    document.removeEventListener('keydown', this._onKey, true);
    document.removeEventListener('pointerdown', this._onOutside, true);
    this.wordEl?.classList.remove('ysn-w-active');
    this.card?.remove(); this.card = null; this.wordEl = null;
    if (resume && this.pausedByUs && this.video) this.video.play().catch(() => {});
    this.pausedByUs = false;
  },
  get isOpen() { return !!this.card; },
};

// Sổ từ (chrome.storage.local, tối đa 3000 từ, mới nhất ở đầu)
const YSNWords = {
  async list() { return (await chrome.storage.local.get('savedWords')).savedWords || []; },
  async has(key) { return (await this.list()).some(w => w.key === key); },
  async add(item) {
    const all = (await this.list()).filter(w => w.key !== item.key);
    all.unshift(item);
    await chrome.storage.local.set({ savedWords: all.slice(0, 3000) });
  },
  async remove(key) { await chrome.storage.local.set({ savedWords: (await this.list()).filter(w => w.key !== key) }); },
};

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, text, label) { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; }

async function playRemote(url, button) {
  button.disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'FETCH_AUDIO', url });
    if (!r?.ok) throw new Error(r?.error);
    await new Audio(r.dataUrl).play();
  } catch { /* lỗi mạng → bỏ qua */ }
  finally { button.disabled = false; }
}

// Đọc từ bằng giọng hệ thống đúng ngôn ngữ của từ (không ảnh hưởng thuyết minh đang khoá).
async function speak(text, lang, rate) {
  const voices = await YSNDubber.listVoices();
  const base = (lang || 'en').toLowerCase().split(/[-_]/)[0];
  const v = voices.find(x => x.lang.toLowerCase().startsWith(base) && /natural|online|google/i.test(x.name)) || voices.find(x => x.lang.toLowerCase().startsWith(base));
  const u = new SpeechSynthesisUtterance(text);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang || 'en-US';
  u.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
