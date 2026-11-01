// Điều phối: chọn site adapter, theo dõi đổi video, lấy phụ đề, dịch, hiển thị, thuyết minh.
// Ba chế độ nguồn phụ đề:
//   static — có đủ danh sách câu từ đầu (YouTube, Udemy, file .vtt/.srt…): dịch trước, tải trước giọng đọc
//   stream — textTrack nạp dần (HLS/DASH): danh sách câu lớn dần, bản dịch giữ theo nội dung câu
//   live   — đọc phụ đề trình phát tự vẽ (Netflix, JW Player…): dịch + đọc ngay khi câu xuất hiện
(() => {
  const site = YSNSites.current();
  const state = {
    site: site.name, mode: 'static', videoId: null, cues: [], translator: null, dubber: null, video: null,
    raf: 0, status: 'idle', error: null, trackLang: null, currentIndex: -1, liveIndex: -1, run: 0, retryTimer: 0,
  };
  const log = (...a) => console.log('[YSN]', ...a);
  window.__YSN_STATE = state; // debug (isolated world)
  let devChannelOn = false;
  chrome.storage.local.get('devChannel').then(r => { devChannelOn = !!r.devChannel; });
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.devChannel) devChannelOn = !!c.devChannel.newValue; });
  YSNOverlay.setContainerProvider(() => state.video ? site.container(state.video) : null);

  // Trang "của người dùng" (khung trên cùng) — khung video nhúng thuộc về trang đang xem.
  const siteHost = (() => {
    try { const a = location.ancestorOrigins; if (a && a.length) return new URL(a[a.length - 1]).hostname; } catch { /* bỏ qua */ }
    return location.hostname;
  })();
  const KNOWN = /(^|\.)(youtube\.com|youtube-nocookie\.com|coursera\.org|udemy\.com|edx\.org|linkedin\.com|pluralsight\.com|skillshare\.com|ted\.com|vimeo\.com)$|^(localhost|127\.0\.0\.1)$/;
  const known = KNOWN.test(location.hostname);
  const quiet = !known;                       // trang bất kỳ: không hiện cảnh báo lên video khi không có phụ đề
  const siteAllowed = (s) => {
    const m = (s.siteMode || {})[siteHost];
    return m === 'on' || (m !== 'off' && (known || s.autoAllSites !== false));
  };

  function teardown() {
    stopLoop();
    clearTimeout(state.retryTimer);
    state.stopWatch?.(); state.stopWatch = null;
    state.stream?.stop(); state.stream = null;
    state.humanStream?.stop(); state.humanStream = null; state.humanRaw = null; state.human = null; state.humanOffset = null;
    state.live?.stop(); state.live = null;
    state.translator?.cancel(); state.translator = null;
    state.phonetic?.cancel(); state.phonetic = null;
    YSNLookup.close(false);
    state.dubber?.destroy(); state.dubber = null;
    state.cues = []; state.currentIndex = -1; state.liveIndex = -1; state.error = null; state.mode = 'static';
    state.noDub = false; state.spokenLang = null;
    hideHint('gesture');
    YSNOverlay.clear();
    site.hideNative(false, state.video);
    site.release?.();
    if (state.video && state.onSeeked) state.video.removeEventListener('seeked', state.onSeeked);
    if (state.video && state.onPlaying) state.video.removeEventListener('playing', state.onPlaying);
    window.YSNPanel?.update?.(state);
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const langBase = (x) => (x || '').toLowerCase().replace('_', '-').split('-')[0];
  const langName = (x) => { try { return new Intl.DisplayNames(['vi'], { type: 'language' }).of(langBase(x)) || x; } catch { return x; } };

  // Gợi ý nhỏ trên video (có nút ✕), mỗi loại một hộp
  function showHint(id, text) {
    const host = YSNOverlay.host;
    if (!host) return;
    let box = host.querySelector(`:scope > .ysn-prompt[data-hint="${id}"]`);
    if (!box) {
      box = document.createElement('div'); box.className = 'ysn-prompt'; box.dataset.hint = id;
      const msg = document.createElement('span');
      const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '✕';
      // chặn lan xuống trình phát (bấm vào hộp không làm dừng/phát video); trình nghe ở document (capture) vẫn nhận cú bấm
      for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) box.addEventListener(t, e => e.stopPropagation());
      x.addEventListener('click', () => box.remove());
      box.append(msg, x);
      host.appendChild(box);
    }
    box.firstChild.textContent = text;
  }
  function hideHint(id) { document.querySelectorAll(`.ysn-prompt[data-hint="${id}"]`).forEach(b => b.remove()); }

  // ---------- Bản store: 30 phút miễn phí mỗi ngày, Pro không giới hạn ----------
  YSNPlan.load();
  const fmtMin = (ms) => Math.max(1, Math.ceil(ms / 60000));
  function showUpgrade() {
    if (!state.video && window !== window.top) return;
    showHint('pro', `Hết ${YSN_PRO.freeMinutes} phút dùng miễn phí hôm nay. Nâng cấp Pro để dùng không giới hạn (từ ${YSN_PRO.prices.monthly}/tháng), hoặc dùng tiếp vào ngày mai.`);
    const box = YSNOverlay.host?.querySelector(':scope > .ysn-prompt[data-hint="pro"]');
    if (box && !box.querySelector('.ysn-pro-go')) {
      const go = document.createElement('button'); go.type = 'button'; go.className = 'ysn-pro-go'; go.textContent = 'Nâng cấp Pro';
      go.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'OPEN_PRO' }).catch(() => {}); box.remove(); });
      box.insertBefore(go, box.lastChild);
    }
  }
  YSNSettings.onBlocked = showUpgrade;
  YSNPlan.onChange((p) => { if (!p.blocked) hideHint('pro'); });
  // Đếm thời gian dùng thực: video đang chạy (không phải quảng cáo) và tab đang bật phụ đề hoặc thuyết minh.
  let meterFrom = 0, lastRemaining = Infinity;
  function meterTick() {
    if (YSN_EDITION !== 'store' || dead) return;
    const s = YSNSettings.get(), v = state.video;
    const on = s.enabled || (s.dubEnabled && !state.noDub);
    const active = !!v && v.isConnected && !v.paused && !v.ended && on && !site.isAd?.();
    const now = Date.now();
    if (!active) { meterFrom = 0; return; }
    if (YSNPlan.get().pro) { meterFrom = now; return; }
    const from = meterFrom || now - 1000;
    meterFrom = now;
    chrome.runtime.sendMessage({ type: 'USAGE_TICK', from, to: now }).then(r => {
      const p = r?.plan; if (!p || p.pro) return;
      if (p.blocked) {
        YSNSettings.saveTab({ enabled: false, dubEnabled: false }, { force: true });   // hết giờ: tắt tab này, trả tiếng gốc
        showUpgrade();
      } else if (p.remainingMs <= YSN_PRO.warnMinutes * 60000 && lastRemaining > YSN_PRO.warnMinutes * 60000) {
        window.YSNPanel?.toast?.(`Còn ${fmtMin(p.remainingMs)} phút dùng miễn phí hôm nay`, 4000);
      }
      lastRemaining = p.remainingMs;
    }).catch(() => {});
  }
  const meterTimer = setInterval(meterTick, 10000);

  // Chờ tới khi trang có video (không giới hạn thời gian, rất nhẹ: nghe sự kiện media + kiểm tra 1.5s/lần)
  function waitForVideo(alive) {
    return new Promise((resolve) => {
      let done = false;
      const EVS = ['loadedmetadata', 'playing'];
      const finish = (v) => {
        if (done) return; done = true;
        clearInterval(timer); EVS.forEach(ev => document.removeEventListener(ev, onEv, true));
        resolve(v);
      };
      const check = () => { if (!alive()) return finish(null); const v = site.findVideo(); if (v) finish(v); };
      const onEv = () => setTimeout(check, 50);
      EVS.forEach(ev => document.addEventListener(ev, onEv, true));
      const timer = setInterval(check, 1500);
      check();
    });
  }

  // Báo service worker: khung này đang có video → popup gửi lệnh / đọc trạng thái đúng khung
  function registerFrame() {
    const v = state.video;
    chrome.runtime.sendMessage({ type: 'FRAME_ACTIVE', area: v ? v.offsetWidth * v.offsetHeight : 0 }).catch(() => {});
  }

  function prepareCues(raw, kind, settings) {
    const fixed = raw.filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
    // gom thành câu trọn ý (phụ đề tự động luôn gom — nó cắt ngang câu theo khung giờ; chế độ trực tiếp thì không)
    const cues = kind !== 'live' && (settings.mergeSentences !== false || kind === 'asr') ? YSNCaptions.toSentences(fixed) : fixed;
    return cues.map((c, i) => ({ ...c, index: i }));
  }

  // Thay danh sách câu (chế độ stream): bản dịch/phiên âm giữ theo nội dung câu, câu đang đọc giữ theo thời điểm
  function setCues(cues) {
    const spoken = state.cues[state.dubber?.lastSpokenIndex];
    state.cues = cues;
    state.translator?.setCues(cues);
    state.phonetic?.setCues(cues);
    if (state.dubber && spoken) state.dubber.lastSpokenIndex = cues.findIndex(c => Math.abs(c.start - spoken.start) < 0.01);
    if (state.humanRaw) applyHumanCues(state.humanRaw);
    YSNOverlay.lastKey = '';
    window.YSNPanel?.update?.(state);
  }

  // Bản dịch có sẵn của video (phụ đề ngôn ngữ đích do người làm) → thay dịch máy cho các câu khớp thời gian
  function applyHumanCues(raw) {
    state.humanRaw = raw;
    if (!state.translator || !state.cues.length) return;
    let tgt = raw.filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
    // kiểm tra hai track có khớp giờ không (cho phép lệch cố định, vd. bản dịch làm cho bản video khác đoạn mở đầu)
    // (đo một lần rồi dùng lại; chế độ stream đo lại khi track đã đủ dài nếu lần trước chưa chắc)
    if (state.humanOffset == null && (state.mode === 'static' || tgt.length >= 20)) {
      const off = YSNCaptions.estimateOffset(state.rawCues || state.cues, tgt);
      if (!off) {
        if (state.mode === 'static' || tgt.length >= 80) { log('phụ đề đích không khớp giờ với phụ đề nguồn → dùng dịch máy'); state.humanRaw = null; state.humanStream?.stop(); }
        return;
      }
      state.humanOffset = off;
      if (Math.abs(off.offset) > 0.05) log(`phụ đề đích lệch ${off.offset}s → đã chỉnh`);
    }
    if (state.humanOffset == null) return;
    const shift = state.humanOffset.offset;
    if (Math.abs(shift) > 0.05) tgt = tgt.map(c => ({ ...c, start: c.start + shift, end: c.end + shift }));
    const aligned = YSNCaptions.alignTranslations(state.cues, tgt);
    const n = aligned.filter(Boolean).length;
    if (state.mode === 'static' && n < state.cues.length * 0.5) { log('phụ đề đích không khớp thời gian, dùng dịch máy'); state.humanRaw = null; return; }
    state.human = { lang: state.humanLang, count: state.translator.seedHuman(state.cues, aligned) };
    window.YSNPanel?.onTranslations?.(state);
  }
  async function loadHuman(videoId, res, settings, alive) {
    if (settings.preferHumanTranslation === false || state.sameLang || !site.getHumanTranslation) return;
    let h = null;
    const keep = () => { const s = YSNSettings.get(); return alive() && (s.enabled || (s.dubEnabled && !state.noDub)); };
    try { h = await site.getHumanTranslation(videoId, res, settings.targetLang, state.video, keep); }
    catch (e) { log('phụ đề đích có sẵn', e.message); }
    if (!alive() || !h) return;
    state.humanLang = h.lang;
    log(`dùng phụ đề ${h.lang} có sẵn của video làm bản dịch`);
    if (h.stream) { state.humanStream = h.stream; h.stream.start((raw) => { if (alive()) applyHumanCues(raw); }); }
    else applyHumanCues(h.cues || []);
  }

  function makeTranslator(videoId, srcLang, settings, streaming, alive) {
    state.translator = new YSNTranslator({
      videoId, cues: state.cues, sourceLang: srcLang, targetLang: settings.targetLang, streaming,
      onUpdate: () => {
        if (!alive()) return;
        state.status = state.translator.done ? 'ready' : 'translating';
        window.YSNPanel?.onTranslations?.(state);
        if (state.translator.needsLocalGesture) showLocalPrompt();
      },
    });
    if (state.sameLang) state.translator.passthrough = true;          // cùng ngôn ngữ đích → không dịch
    state.translator.run(() => state.video?.currentTime || 0);
  }

  // Không dịch được (Google chặn…) nhưng Chrome đã có gói dịch trên máy → một nút trên video để bật cho trang này
  function showLocalPrompt() {
    const host = YSNOverlay.host;
    if (!host || host.querySelector(':scope > .ysn-prompt')) return;
    const box = document.createElement('div'); box.className = 'ysn-prompt';
    const msg = document.createElement('span'); msg.textContent = 'Chưa dịch được (Google đang chặn). Bật dịch ngay trên máy cho trang này?';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Bật dịch trên máy';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '✕';
    for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick']) box.addEventListener(t, e => e.stopPropagation());
    b.addEventListener('click', async () => {
      const tr = state.translator; if (!tr) return box.remove();
      b.disabled = true; b.textContent = 'Đang bật…';
      try {
        await YSNPageTranslator.enable(state.srcLang || tr.sourceLang, tr.targetLang);
        tr.needsLocalGesture = false; tr.nudge(); box.remove();
      } catch (e) { b.disabled = false; b.textContent = 'Thử lại'; msg.textContent = 'Chưa bật được: ' + e.message; }
    });
    x.addEventListener('click', () => box.remove());
    box.append(msg, b, x);
    host.appendChild(box);
  }

  function makeDubber(settings) {
    if (state.dubber) { state.dubber.setVideo(state.video); return; }   // đã tạo sớm trong start()
    state.dubber = new YSNDubber(state.video, settings);
    state.dubber.onNeedGesture = (on) => on ? showHint('gesture', 'Bấm vào video một lần để bật giọng thuyết minh (Chrome chỉ cho phát tiếng sau khi bạn bấm vào trang).') : hideHint('gesture');
    // tua (seek) → cho phép đọc lại câu hiện tại
    state.onSeeked = () => { state.dubber?.stop(); if (state.dubber) state.dubber.lastSpokenIndex = -1; state.translator?.nudge(); };
    state.video.addEventListener('seeked', state.onSeeked);
    state.onPlaying = () => registerFrame();
    state.video.addEventListener('playing', state.onPlaying);
  }

  // Ngôn ngữ nguồn chưa rõ (file không ghi ngôn ngữ, chế độ trực tiếp) → nhận diện từ vài câu đầu
  async function detectSource(alive) {
    if (state.srcLang && state.srcLang !== 'auto') return;
    if (state.detecting || state.cues.length < (state.mode === 'live' ? 2 : 1)) return;
    state.detecting = true;
    try {
      const sample = state.cues.slice(0, 12).map(c => c.text);
      const r = await chrome.runtime.sendMessage({ type: 'DETECT_LANG', texts: sample });
      if (!alive() || !r?.lang) return;
      state.srcLang = r.lang; state.trackLang = state.trackLang || r.lang;
      const s = YSNSettings.get();
      state.sameLang = r.lang.split('-')[0].toLowerCase() === (s.targetLang || '').split('-')[0].toLowerCase();
      if (state.translator) { state.translator.sourceLang = r.lang.split('-')[0]; if (state.sameLang) { state.translator.passthrough = true; state.translator.nudge(); } }
      startPhonetic(s);
    } catch { /* thử lại ở câu sau */ } finally { state.detecting = false; }
  }

  let dead = false;                               // bản này đã bị thay (tiện ích tải lại) → không làm gì nữa
  async function start() {
    if (dead) return;
    const run = ++state.run;                      // chống 2 start() chạy chồng nhau
    const t0 = performance.now();
    const alive = () => run === state.run;
    const settings = await YSNSettings.load();
    if (!alive()) return;
    if (!siteAllowed(settings)) { teardown(); state.videoId = null; state.status = 'site-off'; return; }
    const videoId = site.getVideoId();
    if (!videoId) { teardown(); state.videoId = null; state.status = 'idle'; return; }
    if (videoId === state.videoId && (state.cues.length || state.mode !== 'static')) { applySettings(settings); return; }
    teardown();
    state.videoId = videoId;
    state.perf = { t0 };                          // đo thời gian khởi động (ms kể từ lúc gọi start)
    if (!settings.enabled && !settings.dubEnabled) {
      // tab này đang tắt (mặc định): không tải gì, chỉ gắn thanh nút nhỏ (hiện khi rê chuột) để bật ngay trên video
      state.status = 'disabled';
      const video = await waitForVideo(alive);
      if (!alive() || !video) return;
      state.video = video;
      window.YSNPanel?.update?.(state);
      return;
    }

    state.status = 'novideo';
    // (gán state.video SAU khi kiểm tra alive: lượt start() cũ đang chờ video sẽ trả về null — trước đây nó ghi đè
    //  state.video = null của lượt mới → lỗi ở startLoop, video không có phụ đề/thuyết minh; hay gặp khi đi từ
    //  bài đọc/quiz sang bài video trên Coursera/Udemy)
    const video = await waitForVideo(alive);
    if (!alive() || !video) return;
    state.video = video;
    state.perf.video = performance.now() - state.perf.t0;
    site.hideNative(nativeHidden(settings), video);   // ẩn phụ đề có sẵn của trang ngay, không để nó hiện lên lúc đang tải
    // Tắt/hạ tiếng gốc NGAY khi có video, không đợi tải phụ đề (trước đây đầu mỗi video nghe tiếng gốc 1–2 giây)
    // — trừ khi đã biết video nói đúng ngôn ngữ đích (vd. video tiếng Việt) → giữ nguyên tiếng gốc.
    if (settings.dubEnabled) {
      const spoken = await site.peekSpokenLang?.(videoId);
      if (!alive()) return;
      if (!(spoken && langBase(spoken) === langBase(settings.targetLang))) { makeDubber(settings); state.dubber.applyVolume(true); }
    }
    state.status = 'loading';
    registerFrame();
    if (!quiet) YSNOverlay.status('Đang tải phụ đề…');

    let res = { cues: [], lang: null };
    try { res = await site.getCues(videoId, state.video, settings.targetLang); }
    catch (e) { log('getCues', e); state.error = 'Không tải được phụ đề: ' + e.message; }
    if (!alive()) { res.stream?.stop?.(); res.live?.stop?.(); return; }

    state.perf.cues = performance.now() - state.perf.t0;
    if (res.live) return startLive(res, settings, videoId, alive);
    const raw = res.stream ? res.stream.read() : (res.cues || []);
    if (!raw.length && !res.stream) return noCaptions(videoId, alive);

    state.error = null;
    state.mode = res.stream ? 'stream' : 'static';
    state.trackLang = res.lang || null;
    state.rawCues = raw.filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
    state.cues = prepareCues(raw, res.kind, settings);
    log(`[${site.name}/${state.mode}] ${videoId}: ${state.cues.length} câu, track ${res.lang || '?'}${res.kind ? ' (' + res.kind + ')' : ''}`);

    const srcLang = (res.lang || 'auto').split('-')[0];
    state.srcLang = res.lang || srcLang;
    state.sameLang = srcLang !== 'auto' && srcLang.toLowerCase() === (settings.targetLang || '').split('-')[0].toLowerCase();
    // Video NÓI đúng ngôn ngữ đích (vd. video tiếng Việt có phụ đề tiếng Anh) → không thuyết minh, không tắt tiếng gốc
    state.spokenLang = res.spokenLang || null;
    state.noDub = !!state.spokenLang && langBase(state.spokenLang) === langBase(settings.targetLang);
    if (state.noDub) log(`video nói ${state.spokenLang} = ngôn ngữ đích → giữ tiếng gốc, không thuyết minh`);
    makeTranslator(videoId, srcLang, settings, state.mode === 'stream', alive);
    if (srcLang === 'auto') detectSource(alive);
    startPhonetic(settings);
    makeDubber(settings);
    if (res.stream) {
      state.stream = res.stream;
      res.stream.start((raw2) => { if (alive()) { state.rawCues = raw2; setCues(prepareCues(raw2, res.kind, YSNSettings.get())); detectSource(alive); } });
    }
    state.status = state.translator.done ? 'ready' : 'translating';
    YSNOverlay.status('');
    applySettings(settings);
    window.YSNPanel?.update?.(state);
    startLoop();
    loadHuman(videoId, res, settings, alive);
    if (state.noDub && settings.dubEnabled) window.YSNPanel?.toast?.(`Video nói ${langName(state.spokenLang)} — giữ tiếng gốc, không thuyết minh`, 4000);
  }

  function startLive(res, settings, videoId, alive) {
    state.mode = 'live'; state.error = null;
    state.cues = []; state.liveIndex = -1;
    state.trackLang = res.lang || null; state.srcLang = res.lang || 'auto'; state.sameLang = false;
    log(`[${site.name}/live] ${videoId}: đọc phụ đề trình phát vẽ trên trang`);
    makeTranslator(videoId, (res.lang || 'auto').split('-')[0], settings, true, alive);
    makeDubber(settings);
    state.live = res.live;
    res.live.start((text) => {
      if (!alive()) return;
      const t = state.video?.currentTime || 0;
      const cur = state.cues[state.liveIndex];
      if (cur) cur.end = Math.max(cur.start + 0.3, Math.min(cur.end, t));
      if (!text) { state.liveIndex = -1; return; }
      if (cur && cur.text === text) { state.liveIndex = cur.index; return; }
      const cue = { start: t, end: t + Math.max(1.5, text.length / 14), text, index: state.cues.length, live: true };
      state.cues.push(cue); state.liveIndex = cue.index;
      if (state.cues.length > 3000) { state.cues.splice(0, 1000); state.cues.forEach((c, i) => { c.index = i; }); state.liveIndex = state.cues.length - 1; if (state.dubber) state.dubber.lastSpokenIndex = -1; }
      state.translator.setCues(state.cues);
      state.phonetic?.setCues(state.cues);
      detectSource(alive);
      window.YSNPanel?.update?.(state);
    });
    state.status = 'ready';
    YSNOverlay.status('');
    applySettings(settings);
    startLoop();
  }

  function noCaptions(videoId, alive) {
    state.status = 'nocaptions';
    // Video thật sự không có phụ đề → không có gì để đọc → trả lại tiếng gốc.
    // Còn nếu chỉ tải lỗi vì Chrome đang ẩn/thu nhỏ (YouTube không tải phụ đề khi ẩn) → GIỮ im lặng tiếng gốc,
    // thử lại khi người dùng mở cửa sổ ra (người dùng đã chọn không nghe tiếng gốc).
    if (!(document.hidden && state.error)) state.dubber?.applyVolume(false);
    state.error = state.error || (site.name === 'generic'
      ? 'Chưa thấy phụ đề — bật phụ đề (CC) trong trình phát của trang, extension sẽ tự nhận.'
      : 'Không tìm thấy phụ đề trên video này.');
    if (!quiet) {
      YSNOverlay.status('⚠ ' + state.error);
      setTimeout(() => { if (alive() && state.status === 'nocaptions') YSNOverlay.status(''); }, 4000);
    }
    const retry = () => { if (alive()) { state.videoId = null; start(); } };
    if (site.watchForSource) {
      // trang bất kỳ: theo dõi nhẹ cho tới khi phụ đề xuất hiện (người dùng bật CC, trình phát nạp track…)
      state.stopWatch = site.watchForSource(state.video, retry);
      return;
    }
    // YouTube (player chưa tải phụ đề khi tab ẩn, đang có quảng cáo…): thử lại 6 lần (giãn dần),
    // và thử ngay khi người dùng mở tab ra xem.
    state.retries = (state.retryVideo === videoId ? state.retries : 0) + 1; state.retryVideo = videoId;
    if (state.retries <= 6) state.retryTimer = setTimeout(retry, Math.min(30000, 4000 * state.retries));
    if (document.hidden) document.addEventListener('visibilitychange', function once() {
      if (!document.hidden) { document.removeEventListener('visibilitychange', once); clearTimeout(state.retryTimer); retry(); }
    });
  }

  // Vòng cập nhật: rAF khi tab đang hiện (mượt); khi tab ẩn rAF dừng hẳn → chạy theo sự kiện
  // timeupdate của video (~4 lần/giây, vẫn chạy ở nền) để thuyết minh không bị tắt khi chuyển tab.
  function startLoop() {
    stopLoop();
    if (!state.video) return;
    const frame = () => { state.raf = requestAnimationFrame(frame); tick(); };
    state.raf = requestAnimationFrame(frame);
    state.onMediaTick = () => { if (document.hidden) tick(); };
    state.loopVideo = state.video;
    for (const ev of ['timeupdate', 'play', 'pause', 'seeked']) state.video.addEventListener(ev, state.onMediaTick);
  }
  function stopLoop() {
    cancelAnimationFrame(state.raf); state.raf = 0;
    if (state.loopVideo && state.onMediaTick) for (const ev of ['timeupdate', 'play', 'pause', 'seeked']) state.loopVideo.removeEventListener(ev, state.onMediaTick);
    state.loopVideo = null;
  }

  // Dòng phiên âm: chỉ tính khi bật và đã biết ngôn ngữ gốc; tính lại khi đổi giọng phiên âm (Mỹ/Anh).
  function startPhonetic(s) {
    if (!s.showPhonetic || !state.cues.length && state.mode === 'static') return;
    if (!state.srcLang || state.srcLang === 'auto') return;
    if (state.phonetic && state.phonetic.accent === s.phoneticAccent && state.phonetic.lang === state.srcLang) return;
    state.phonetic?.cancel();
    state.phonetic = new YSNPhoneticTrack({ cues: state.cues, lang: state.srcLang, accent: s.phoneticAccent, streaming: state.mode !== 'static', onUpdate: () => { YSNOverlay.lastKey = ''; } });
    state.phonetic.run(() => state.video?.currentTime || 0);
  }

  // Nút trên thanh công cụ của video
  YSNOverlay.onBarAction = (action) => {
    const s = YSNSettings.get();
    if (action === 'subs') YSNSettings.saveTab({ enabled: !s.enabled });              // chỉ tab này
    else if (action === 'phonetic') YSNSettings.save({ showPhonetic: !s.showPhonetic });
    else if (action === 'dub') YSNSettings.saveTab({ dubEnabled: !s.dubEnabled });     // chỉ tab này
    else if (action === 'prev') YSNPanel.prev();
    else if (action === 'replay') YSNPanel.replay();
    else if (action === 'next') YSNPanel.next();
    else if (action === 'autopause') YSNPanel.toggleAutoPause();
    else if (action === 'panel') YSNPanel.toggle(state);
  };
  // Kéo phụ đề lên/xuống → lưu độ cao mới
  YSNOverlay.onDragEnd = (pct) => YSNSettings.save({ subBottom: pct });

  YSNOverlay.onWordClick = (w) => {
    const s = YSNSettings.get();
    if (!s.wordLookup) return;
    YSNLookup.open(w, { word: w.textContent.trim(), srcLang: state.srcLang || state.trackLang || 'en', tgtLang: s.targetLang, kind: w.dataset.kind, settings: s, video: state.video, host: YSNOverlay.host });
  };

  // Ẩn phụ đề có sẵn của trang khi tiện ích đang làm việc trên video: phụ đề song ngữ HOẶC thuyết minh đang bật
  const nativeHidden = (s) => !!s.hideNativeCaptions && (!!s.enabled || (!!s.dubEnabled && !state.noDub));

  function applySettings(s) {
    startPhonetic(s);
    if (!s.wordLookup) YSNLookup.close();
    // Phụ đề có sẵn của trang (Udemy, YouTube CC…) vẫn ẩn khi chỉ tắt phụ đề song ngữ mà thuyết minh còn bật —
    // trước đây tắt phụ đề song ngữ thì phụ đề tiếng Anh của trang hiện lên đè video. Tắt cả hai → trả trang về như cũ.
    site.hideNative(nativeHidden(s), state.video);
    YSNOverlay.lastKey = '';
    state.dubber?.updateSettings(s);
    const dubOn = s.dubEnabled && !state.noDub;
    state.dubber?.applyVolume(dubOn);
    if (!dubOn) state.dubber?.stop();
    if (!s.enabled) YSNOverlay.render(null, null, s);
    window.YSNPanel?.applySettings?.(s, state);
  }

  function findCueIndex(t) {
    const cues = state.cues;
    let lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].start <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    if (ans < 0) return -1;
    if (t <= cues[ans].end + 0.15) return ans;
    // khoảng lặng ngắn giữa hai câu (≤ 1.5 giây): giữ câu trước trên màn hình tới khi câu sau bắt đầu → không chớp trống
    const next = cues[ans + 1];
    if (t - cues[ans].end <= 1.5 && (!next || t < next.start)) return ans;
    return -1;
  }
  state.findCueIndex = findCueIndex;

  function tick() {
    const v = state.video, s = YSNSettings.get();
    if (!v) return;
    if (!v.isConnected) {
      const nv = site.findVideo();
      if (!nv) return;
      const old = state.video;
      state.video = nv;
      state.dubber?.setVideo(nv);                    // thẻ mới cũng được tắt/hạ tiếng gốc ngay
      for (const [ev, fn] of [['seeked', state.onSeeked], ['playing', state.onPlaying]]) {
        if (fn) { old.removeEventListener(ev, fn); nv.addEventListener(ev, fn); }
      }
      startLoop();                                   // gắn lại sự kiện cho thẻ video mới
      return;
    }
    if (site.isAd?.()) {                              // quảng cáo YouTube: không hiện phụ đề, không đọc
      if (YSNOverlay.lastKey) YSNOverlay.render(null, null, s);
      if (state.dubber?.speaking) state.dubber.stop();
      return;
    }
    const t = v.currentTime;
    const idx = state.mode === 'live' ? state.liveIndex : (state.cues.length ? findCueIndex(t) : -1);
    const cue = idx >= 0 ? state.cues[idx] : null;
    const tr = cue ? state.translator?.translations[idx] : null;

    if (s.enabled) YSNOverlay.render(cue, tr, s, { phonetic: idx >= 0 ? state.phonetic?.results[idx] : null, srcLang: state.srcLang, tgtLang: s.targetLang, sameLang: state.sameLang }); else if (YSNOverlay.lastKey) YSNOverlay.render(null, null, s);
    if (state.perf && cue && !state.perf.firstSub) state.perf.firstSub = performance.now() - state.perf.t0;
    if (state.perf && tr && !state.perf.firstTr) state.perf.firstTr = performance.now() - state.perf.t0;
    if (state.perf && !state.perf.firstDub && state.dubber?.firstOkAt) state.perf.firstDub = state.dubber.firstOkAt - state.perf.t0;

    // Một số player tự bật lại phụ đề gốc → giữ ẩn (kiểm tra ~1 lần/giây)
    const now = performance.now();
    if (nativeHidden(s) && now - (state.lastHide || 0) > 1000) { state.lastHide = now; site.hideNative(true, v, state.mode !== 'live' ? cue?.text : null); }

    if (s.dubEnabled && state.dubber && !state.noDub) {
      state.dubber.pollUnduck?.();
      if (v.paused || v.seeking) { if (state.dubber.speaking) state.dubber.stop(); }
      // Đọc câu hiện tại nếu chưa đọc và còn kịp: đang ở 60% đầu câu, hoặc thời gian còn lại vẫn đủ đọc
      // ở tốc độ tối đa (câu trước đọc lố một chút / bản dịch về muộn vẫn không bị bỏ)
      else if (cue && tr && idx !== state.dubber.lastSpokenIndex && !state.dubber.speaking &&
        ((t - cue.start) < Math.max(1.5, (cue.end - cue.start) * 0.6) ||
         (cue.end - t) >= state.dubber.estimateSeconds(tr, Math.max(1, s.dubMaxRate || 1.5)) * 0.85)) {
        state.dubber.speak(cue, tr);
        // tải trước audio 2 câu kế tiếp (đúng thứ tự để dự đoán tốc độ làm mượt)
        if (state.mode !== 'live') {
          const next = [1, 2].map(k => ({ text: state.translator?.translations[idx + k], slot: state.cues[idx + k] ? state.cues[idx + k].end - state.cues[idx + k].start : 3 }));
          state.dubber.prefetch(next);
        }
      }
    }
    if (idx !== state.currentIndex) { state.currentIndex = idx; window.YSNPanel?.onIndex?.(idx, state); }
    window.YSNPanel?.onTick?.(t, idx);
    YSNOverlay.setSpeaking(s.dubEnabled && !!state.dubber?.speaking);
  }

  YSNSettings.onChange((s, prev) => {
    const allowedNow = siteAllowed(s), allowedBefore = siteAllowed(prev);
    if (allowedNow !== allowedBefore || s.targetLang !== prev.targetLang || s.mergeSentences !== prev.mergeSentences || s.preferHumanTranslation !== prev.preferHumanTranslation ||
        ((s.enabled || s.dubEnabled) && !(prev.enabled || prev.dubEnabled))) {
      state.videoId = null; start();
    } else {
      applySettings(s);
      // vừa tắt cả phụ đề song ngữ lẫn thuyết minh → tắt luôn CC mà tiện ích đã bật trong trình phát YouTube
      const busy = (x) => x.enabled || (x.dubEnabled && !state.noDub);
      if (busy(prev) && !busy(s)) site.release?.();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'GET_STATE') {
      // khung không có video không trả lời nếu không phải khung trên cùng (để khung có video trả lời)
      if (!state.video && window !== window.top) return false;
      sendResponse({
        site: site.name, host: siteHost, known, mode: state.mode, videoId: state.videoId, status: state.status, error: state.error, trackLang: state.srcLang && state.srcLang !== 'auto' ? state.srcLang : state.trackLang,
        cues: state.cues.length, translated: state.translator?.progress || 0, sameLang: !!state.sameLang,
        provider: state.translator?.provider || null, translateError: state.translator?.lastError || null,
        voice: (() => { const v = state.dubber?._voicesReady ? state.dubber.currentVoice() : null; return v ? { id: v.id, name: v.name, engine: v.engine, gender: v.gender } : null; })(),
        engineError: state.dubber?.lastEngineError || null, hasVideo: !!state.video, human: state.human?.count || 0, humanLang: state.human?.lang || null,
        noDub: !!state.noDub, spokenLang: state.spokenLang || null,
      });
    } else if (msg.type === 'LIST_VOICES') {
      YSNDubber.listVoices().then(vs => sendResponse(vs.map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, gender: ysnGuessGender(v) }))));
      return true;
    } else if (msg.type === 'RETRY_TRANSLATE') {
      state.translator?.nudge();
      sendResponse({ ok: true });
    } else if (msg.type === 'EXPORT_SRT') {
      if (!state.video && window !== window.top) return false;
      sendResponse({ ok: true, srt: buildSrt(), videoId: state.videoId });
    } else if (msg.type === 'PLAN_BLOCKED') {
      showUpgrade();
      return false;
    } else if (msg.type === 'PANEL') {
      if (!state.video) return false;
      window.YSNPanel?.toggle?.(state, msg.open);
      sendResponse({ ok: true });
    }
  });

  function buildSrt() {
    const fmt = (sec) => {
      const ms = Math.round(sec * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
    };
    return state.cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n${state.translator?.translations[i] || ''}\n`).join('\n');
  }
  state.buildSrt = buildSrt;

  // Kênh dev/test: trang (hoặc công cụ test như Claude in Chrome) có thể đổi cài đặt và đọc trạng thái
  // qua postMessage. Chỉ chấp nhận các khóa cài đặt đã biết → không có bề mặt nhạy cảm.
  // Kênh này CHỈ hoạt động khi bật "Chế độ nhà phát triển" trong trang Nâng cao (mặc định tắt),
  // để script lạ trên trang không thể đổi cài đặt hay nạp lại extension.
  window.addEventListener('message', function onDevMsg(ev) {
    if (dead) return window.removeEventListener('message', onDevMsg);
    if (ev.source !== window || !ev.data || typeof ev.data.type !== 'string') return;
    if (!/^YSN_(SET_SETTINGS|RELOAD_EXTENSION|GET_STATE|DEV_CALL)$/.test(ev.data.type)) return;
    if (YSN_EDITION === 'store' || (!YSNSettings.get().devMode && !devChannelOn)) return;   // bản store: không bao giờ mở
    if (ev.data.type === 'YSN_SET_SETTINGS' && ev.data.patch && typeof ev.data.patch === 'object') {
      const patch = {};
      for (const [k, v] of Object.entries(ev.data.patch)) if (k in YSN_DEFAULT_SETTINGS) patch[k] = v;
      YSNSettings.save(patch).then(s => window.postMessage({ type: 'YSN_SETTINGS', settings: s }, '*'));
    } else if (ev.data.type === 'YSN_DEV_CALL') {
      // dev: gọi một số lệnh runtime cho mục đích test (danh sách cho phép cố định)
      const m = ev.data.msg || {};
      if (!['PIPER_ANALYZE', 'PIPER_STATUS', 'PIPER_DOWNLOAD', 'TTS_PIPER', 'LIST_CLOUD_VOICES'].includes(m.type)) return;
      chrome.runtime.sendMessage(m).then(r => window.postMessage({ type: 'YSN_DEV_RESULT', requestId: ev.data.requestId, result: r }, '*'))
        .catch(e => window.postMessage({ type: 'YSN_DEV_RESULT', requestId: ev.data.requestId, result: { ok: false, error: e.message } }, '*'));
    } else if (ev.data.type === 'YSN_RELOAD_EXTENSION') {
      // dev: nạp lại extension từ trang (dùng khi test tự động sau khi sửa code)
      chrome.runtime.sendMessage({ type: 'RELOAD' });
    } else if (ev.data.type === 'YSN_GET_STATE') {
      window.postMessage({ type: 'YSN_STATE', state: {
        site: site.name, mode: state.mode, videoId: state.videoId, status: state.status, error: state.error, trackLang: state.trackLang, srcLang: state.srcLang,
        cues: state.cues.length, translated: state.translator?.progress || 0, provider: state.translator?.provider || null,
        translateError: state.translator?.lastError || null, speaking: !!state.dubber?.speaking, lastSpoken: state.dubber?.lastSpokenIndex ?? -1, engineError: state.dubber?.lastEngineError || null,
        debug: state.dubber ? { voicesReady: !!state.dubber._voicesReady, voices: state.dubber.voiceList.map(v => v.id + (v.ready ? '' : '(chưa tải)')), resolved: state.dubber._voicesReady ? state.dubber.currentVoice()?.id : null,
          userVolume: state.dubber.userVolume, factor: state.dubber._factor, lastSet: state.dubber._lastSet, videoVolume: state.video?.volume, lastEngine: state.dubber._lastEngine,
          locked: state.dubber.locked?.id || null, lastSpoken: state.dubber.lastSpokenIndex, speaking: !!state.dubber.speaking,
          log: (state.dubber.log || []).slice(-15).map(l => `${l.i}:${l.ok ? 'ok' : 'ERR'}:${l.voice}${l.rate ? '@' + (+l.rate).toFixed(2) : ''}${l.err ? ' ' + l.err : ''}`) } : null,
        page: { hidden: document.hidden, href: location.href, t: +(state.video?.currentTime || 0).toFixed(1), paused: state.video?.paused ?? null, rate: state.video?.playbackRate ?? null,
          muted: state.video?.muted ?? null, connected: !!state.video?.isConnected, overlays: document.querySelectorAll('#ysn-overlay').length, bars: document.querySelectorAll('#ysn-dub-badge').length,
          idx: state.currentIndex, cue: state.cues[state.currentIndex]?.text?.slice(0, 80) || null, tr: state.translator?.translations?.[state.currentIndex]?.slice(0, 80) || null,
          human: state.human?.count || 0, humanLang: state.human?.lang || null, srcLang: state.srcLang, sameLang: !!state.sameLang, retries: state.retries || 0,
          spokenLang: state.spokenLang || null, noDub: !!state.noDub,
          prompt: !!document.querySelector('.ysn-prompt') },
        settings: YSNSettings.get(),
      } }, '*');
    }
  });

  site.onNavigate(start);
  start();

  // Tiện ích vừa được cập nhật/tải lại: bản cũ trong tab này mất kết nối ("mồ côi") nhưng vẫn chạy → tự dọn sạch
  // (dừng đọc, gỡ phụ đề, trả âm lượng) để bản mới được nạp lại vào tab không bị chồng hai lớp.
  // Mỗi bản đang chạy ghi mã riêng lên <html>; bản nào thấy mã không còn là của mình (đã có bản mới nạp vào khung này)
  // hoặc mất kết nối với tiện ích thì tự dừng — chỉ gỡ phần tử CỦA MÌNH, không đụng lớp phụ đề của bản mới.
  const INST = Math.random().toString(36).slice(2);
  try { document.documentElement.dataset.ysnInst = INST; } catch { /* bỏ qua */ }
  const orphanTimer = setInterval(() => {
    let alive = false;
    try { alive = !!chrome.runtime?.id; } catch { alive = false; }
    const mine = document.documentElement?.dataset?.ysnInst === INST;
    if (alive && mine) return;
    clearInterval(orphanTimer);
    clearInterval(meterTimer);
    dead = true;
    state.run++;
    try { teardown(); } catch { /* bỏ qua */ }
    try { window.YSNPanel?.toggle?.(state, false); } catch { /* bỏ qua */ }
    try { YSNOverlay.el?.remove(); YSNOverlay.badge?.remove(); YSNOverlay.el = YSNOverlay.badge = null; } catch { /* bỏ qua */ }
  }, 1000);
})();
