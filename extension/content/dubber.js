// Thuyết minh: đọc câu dịch đúng thời điểm bằng giọng đã chọn (Piper offline / hệ thống / Google / online),
// hạ tiếng gốc khi đang đọc, tự co giãn tốc độ cho vừa thời lượng câu.

// "Im lặng" cho tiếng gốc = âm lượng 0,01% (−80 dB, tai không nghe được) chứ KHÔNG mute / KHÔNG đặt 0:
// Chrome tự DỪNG video đang tắt tiếng khi cửa sổ bị ẩn/thu nhỏ (tiết kiệm điện) → thuyết minh dừng theo,
// trình phát bật lại tiếng → nghe tiếng gốc. Giữ một chút âm lượng thì Chrome coi video vẫn "có tiếng".
const YSN_SILENT = 0.0001;
// Chrome không cho đọc/phát tiếng khi người dùng CHƯA bấm vào trang lần nào (mở link ở tab mới, video tự phát…)
const ysnGestureError = () => Object.assign(new Error('Chrome chặn âm thanh khi chưa bấm vào trang'), { code: 'gesture' });

class YSNDubber {
  constructor(video, settings) {
    this.video = video;
    this.settings = settings;
    this.speaking = false;
    this.lastSpokenIndex = -1;
    this.audio = null;
    this.audioCache = new Map();          // khoá → Promise<dataUrl>
    this.voiceList = [];
    this._keepAlive = setInterval(() => { if (this.speaking && speechSynthesis.paused) speechSynthesis.resume(); }, 5000);
    // Âm lượng: mọi hệ số (tiếng gốc / ducking) nhân với âm lượng NGƯỜI DÙNG đặt trên trình phát.
    // Bản cũ (trước khi tải lại tiện ích) có thể đang để video ở mức đã hạ → lấy mức người dùng nó đã ghi lại trên thẻ video.
    const saved = parseFloat(video.dataset?.ysnUserVol);
    this.userVolume = saved > 0 && saved <= 1 && video.volume < saved - 0.005 ? saved : video.volume;
    this._saveUserVol();
    this._factor = 1;
    this._lastSet = video.volume;
    this.active = false;                                          // thuyết minh đang bật (applyVolume(true))
    this._enforceLog = [];
    this._onVolumeChange = () => this._volumeChanged();
    video.addEventListener('volumechange', this._onVolumeChange);
    if (settings.dubEnabled) this.refreshVoices().then(() => this._warm()).catch(() => {});
  }

  // Giọng offline: nạp sẵn model khi bật thuyết minh (câu đầu không phải chờ vài giây)
  _warm() {
    const v = this.currentVoice();
    if (v?.engine === 'piper' && v.ready) ysnOffscreen({ type: 'PIPER_WARM', path: v.path }).catch(() => {});
    else if (v?.engine === 'piper') this._ensurePiper(v);
  }

  // Đổi âm lượng tiếng gốc. smooth=true → chuyển mượt ~180ms thay vì nhảy đột ngột.
  _setFactor(f, smooth = false) {
    this._factor = f;
    clearInterval(this._ramp); this._ramp = null;
    const target = this._target(f);
    const from = this.video.volume;
    // (0 ↔ YSN_SILENT cũng phải đặt: chênh nhau rất nhỏ nhưng Chrome coi 0 là "không tiếng" → dừng video khi ẩn cửa sổ)
    const apply = (x) => { this._lastSet = x; const v = this.video.volume; if (Math.abs(v - x) > 0.001 || (v === 0) !== (x === 0)) this.video.volume = x; };
    // Cửa sổ ẩn/thu nhỏ: Chrome hãm bộ hẹn giờ (≥1 giây/lần, sau 5 phút còn 1 lần/phút) → bước chuyển mượt 30ms
    // sẽ kéo dài nhiều giây/phút và tiếng gốc vẫn to. Khi ẩn thì đặt âm lượng NGAY.
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!smooth || hidden || Math.abs(from - target) < 0.02) return apply(target);
    let step = 0; const N = 6;
    this._ramp = setInterval(() => {
      step++;
      apply(step >= N ? target : from + (target - from) * (step / N));
      if (step >= N) { clearInterval(this._ramp); this._ramp = null; }
    }, 30);
  }

  // Trình phát (YouTube…) hay tự đặt lại âm lượng / tự bỏ tắt tiếng: khi chuyển video, sau quảng cáo,
  // khi đồng bộ trạng thái. Trước đây extension chỉ ghi nhận mà không áp lại → thỉnh thoảng nghe tiếng gốc.
  // Giờ: ghi nhận mức âm lượng người dùng muốn, rồi áp lại NGAY mức tiếng gốc của thuyết minh.
  _volumeChanged() {
    const v = this.video;
    if (Math.abs(v.volume - this._lastSet) > 0.005) {          // không phải do extension đặt (người dùng / trình phát)
      // trình phát "dội lại" mức im lặng (vd. làm tròn 0,01% → 0) thì không phải người dùng đổi âm lượng
      if (!(this.active && this._factor < 0.05 && v.volume <= 0.01)) {
        this.userVolume = this._factor > 0.05 ? Math.min(1, v.volume / this._factor) : v.volume;
        this._saveUserVol();
      }
      this._lastSet = v.volume;
    }
    if (this.active) this._enforce();
  }
  _saveUserVol() { try { this.video.dataset.ysnUserVol = String(this.userVolume); } catch { /* bỏ qua */ } }
  // Tiếng gốc cần "im lặng" (tắt hẳn, hoặc thanh tiếng gốc = 0)
  _silentWanted() { const s = this.settings; return !!s.muteOriginal || (s.originalVolume ?? 1) <= 0; }
  // Âm lượng thực đặt cho video với hệ số f: khi thuyết minh đang bật không bao giờ xuống 0 (xem YSN_SILENT)
  _target(f) {
    const t = Math.max(0, Math.min(1, this.userVolume * f));
    return this.active && t < YSN_SILENT ? YSN_SILENT : t;
  }
  _enforce() {
    const v = this.video;
    const target = this._target(this._factor);
    const needUnmute = v.muted && this._silentWanted();          // mute thật → Chrome dừng video khi ẩn cửa sổ
    const needVol = !this._ramp && (Math.abs(v.volume - target) > 0.005 || (v.volume === 0 && target > 0));
    if (!needUnmute && !needVol) return;
    // Chống "giằng co" với trình phát: quá 20 lần trong 2 giây thì tạm ngừng 3 giây (không treo trang).
    const now = Date.now();
    if (now < (this._enforcePauseUntil || 0)) return;
    this._enforceLog = this._enforceLog.filter(t => now - t < 2000);
    if (this._enforceLog.length >= 20) {
      this._enforcePauseUntil = now + 3000;
      console.warn('[YSN] trình phát liên tục đổi âm lượng — tạm ngừng giữ tiếng gốc 3 giây');
      return;
    }
    this._enforceLog.push(now);
    if (needVol) { this._lastSet = target; v.volume = target; }
    if (needUnmute) { v.muted = false; this._weMuted = false; }
  }

  // Trình phát thay thẻ <video> mới → chuyển theo dõi sang thẻ mới và áp ngay âm lượng tiếng gốc.
  setVideo(nv) {
    if (!nv || nv === this.video) return;
    const old = this.video;
    old.removeEventListener('volumechange', this._onVolumeChange);
    if (this._weMuted) { try { old.muted = false; } catch { /* thẻ cũ đã bị gỡ */ } this._weMuted = false; }
    this.video = nv;
    this._lastSet = nv.volume;
    this._saveUserVol();
    nv.addEventListener('volumechange', this._onVolumeChange);
    if (this.active) this.applyVolume(true);
  }

  updateSettings(s) {
    const prev = this.settings;
    this.settings = s;
    if (!prev || prev.targetLang !== s.targetLang || prev.voiceId !== s.voiceId || prev.dubGender !== s.dubGender) {
      this.unlockVoice();
      this.refreshVoices().then(() => { if (this.settings.dubEnabled) this._warm(); });
    } else if (prev.dubRate !== s.dubRate || prev.dubPitch !== s.dubPitch) this._rate = null;
    if (s.dubEnabled && !prev?.dubEnabled && this._voicesReady) this._warm();
  }

  // ---------- danh sách giọng ----------
  static listVoices() {
    return new Promise((resolve) => {
      const v = speechSynthesis.getVoices();
      if (v.length) return resolve(v);
      const done = () => { speechSynthesis.removeEventListener('voiceschanged', done); resolve(speechSynthesis.getVoices()); };
      speechSynthesis.addEventListener('voiceschanged', done);   // không ghi đè handler của trang
      setTimeout(done, 1000);
    });
  }

  async refreshVoices() {
    const target = this.settings.targetLang || 'vi';
    const sysVoices = (await YSNDubber.listVoices()).map(v => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI }));
    let cloudVoices = [];
    try { const r = await chrome.runtime.sendMessage({ type: 'LIST_CLOUD_VOICES' }); if (r?.ok) cloudVoices = r.voices; } catch { /* chưa có key */ }
    let piperCached = {};
    try {
      const paths = YSN_PIPER_VOICES.filter(v => ysnSameLang(v.lang, target)).map(v => v.path);
      if (paths.length) { const r = await chrome.runtime.sendMessage({ type: 'PIPER_STATUS', paths }); if (r?.ok) piperCached = r.cached; }
    } catch { /* offscreen chưa sẵn sàng */ }
    this.voiceList = ysnBuildVoiceList({ target, sysVoices, cloudVoices, piperCached });
    this._voicesReady = true;
    return this.voiceList;
  }

  // Giọng được KHOÁ cho cả video: chọn 1 lần, chỉ đổi khi người dùng đổi cài đặt giọng/ngôn ngữ,
  // hoặc khi giọng hỏng liên tục (≥3 lần) — lúc đó chuyển hẳn sang giọng cùng giới tính và giữ nguyên.
  currentVoice() {
    if (this.locked) return this.locked;
    // giọng người dùng chọn đích danh (kể cả Piper chưa tải) được phép tải model
    this.locked = ysnResolveVoice(this.voiceList, { ...this.settings, allowPiperDownload: true });
    this.failStreak = 0;
    return this.locked;
  }
  unlockVoice() { this.locked = null; this.failStreak = 0; this._rate = null; }

  // Hiệu chỉnh tốc độ đọc thực: n ký tự đọc hết `seconds` giây khi tổng hợp ở tốc độ `rate`.
  _calibrate(voiceId, chars, seconds, rate) {
    if (!voiceId || !(seconds > 0.3) || chars < 8) return;
    const sample = Math.max(8, Math.min(25, chars / (seconds * rate)));
    this.cps ||= {};
    this.cps[voiceId] = this.cps[voiceId] ? this.cps[voiceId] * 0.7 + sample * 0.3 : sample;
  }

  // Tốc độ mục tiêu cho một câu (ước lượng theo số ký tự), rồi LÀM MƯỢT so với câu trước:
  // mỗi câu chỉ nhanh hơn tối đa +0.12× hoặc chậm lại tối đa −0.06× → không nghe như đổi người đọc.
  planRate(text, slotSeconds, prev) {
    // ký tự/giây ở tốc độ 1.0 của giọng đang dùng — đo từ các câu đã đọc (ban đầu ước 17)
    const CHARS_PER_SEC = this.charsPerSec();
    // video đang tua nhanh (1.25×, 1.5×…) → thời gian thực của câu ngắn lại, giọng đọc nhanh theo
    const vr = Math.max(0.5, Math.min(2, this.video?.playbackRate || 1));
    const base = (this.settings.dubRate || 1) * Math.max(1, vr);
    const max = Math.max(base, Math.min(3, Math.max(this.settings.dubMaxRate || 1.5, this.locked?.maxRate || 0) * Math.max(1, vr)));
    slotSeconds = slotSeconds / vr;
    // tốc độ tối thiểu để đọc vừa thời lượng câu (CHARS_PER_SEC đã đo ở tốc độ 1.0), không chậm hơn tốc độ người dùng chọn
    const target = Math.min(max, Math.max(base, text.length / CHARS_PER_SEC / Math.max(slotSeconds, 0.5)));
    const p = prev ?? base;
    const r = p + Math.max(-0.06, Math.min(0.12, target - p));
    return Math.round(Math.min(max, Math.max(base, r)) * 20) / 20;   // làm tròn 0.05 → cache trúng
  }
  charsPerSec() { return (this.locked && this.cps?.[this.locked.id]) || 17; }
  // Thời gian (giây, theo đồng hồ video) cần để đọc `text` ở tốc độ `rate`
  estimateSeconds(text, rate = 1) {
    return (text?.length || 0) / this.charsPerSec() / rate * Math.max(0.5, Math.min(2, this.video?.playbackRate || 1));
  }
  // giữ tương thích
  computeRate(text, slotSeconds) { return this.planRate(text, slotSeconds, this._rate); }

  // Áp âm lượng tiếng gốc: đang đọc → duckVolume, không đọc → originalVolume (đều là % của âm lượng người dùng).
  // Khi hết câu, chờ 0.7s mới trả âm lượng: câu tiếp theo thường bắt đầu ngay → tránh "bơm" âm lượng lên xuống.
  duck(on, { immediate = false } = {}) {
    const s = this.settings;
    clearTimeout(this._unduckTimer);
    // Đã tắt thuyết minh → tiếng gốc luôn 100% mức người dùng (stop() gọi duck(false) sau applyVolume(false):
    // trước đây với "Tắt hẳn tiếng gốc" thì tắt thuyết minh xong video bị im luôn)
    if (!this.active) { this._unduckAt = 0; return this._setFactor(1); }
    if (s.muteOriginal) return this._setFactor(0);                 // tắt hẳn = luôn ở mức im lặng (YSN_SILENT)
    const base = s.originalVolume ?? 1;
    if (on) { this._unduckAt = 0; return this._setFactor(Math.min(base, s.duckVolume ?? 0.15), true); }
    if (immediate) return this._setFactor(base, false);
    this._unduckAt = performance.now() + 700;
    this._unduckTimer = setTimeout(() => this.pollUnduck(), 700);
  }
  // Gọi thêm từ vòng cập nhật (timeupdate vẫn chạy khi cửa sổ ẩn, còn setTimeout thì bị Chrome hãm)
  pollUnduck() {
    if (!this._unduckAt || performance.now() < this._unduckAt) return;
    this._unduckAt = 0; clearTimeout(this._unduckTimer);
    if (this.speaking) return;
    if (!this.active) this._setFactor(1);
    else if (!this.settings.muteOriginal) this._setFactor(this.settings.originalVolume ?? 1, true);
  }

  // Gọi khi bật/tắt thuyết minh hoặc đổi cài đặt âm lượng.
  applyVolume(dubEnabled) {
    const v = this.video, s = this.settings;
    this.active = !!dubEnabled;
    if (!dubEnabled) {
      if (this._weMuted) { v.muted = false; this._weMuted = false; }
      this._setFactor(1);                                         // trả nguyên âm lượng người dùng
      return;
    }
    // Không dùng mute thật (Chrome dừng video tắt tiếng khi ẩn cửa sổ) → im lặng bằng âm lượng YSN_SILENT.
    // Video đang bị mute (do bản cũ của extension, hoặc YouTube nhớ trạng thái mute) → bỏ mute; âm lượng vẫn ~0.
    // (hạ âm lượng TRƯỚC rồi mới bỏ mute → không có khoảnh khắc nào tiếng gốc phát to)
    if (!this.speaking) this.duck(false, { immediate: true });
    else if (s.muteOriginal) this._setFactor(0);
    if (this._weMuted || (v.muted && this._silentWanted())) { v.muted = false; this._weMuted = false; }
  }

  // Cue chỉ gồm tag âm thanh như [Applause], (music), ♪ … → không đọc.
  static isNonSpeech(text) {
    return !text || /^\s*([\[(（【].*[\])）】]|[♪♫\s]+)\s*$/.test(text);
  }

  async speak(cue, text) {
    if (!text || cue.index === this.lastSpokenIndex) return;
    if (this._gestureWait) {                                         // đang chờ người dùng bấm vào trang
      if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive) this._gestureDone?.();
      else return;
    }
    if (YSNDubber.isNonSpeech(text) || YSNDubber.isNonSpeech(cue.text)) return;
    this.lastSpokenIndex = cue.index;
    const slot = Math.max(0.5, cue.end - cue.start);
    if (!this._voicesReady) await this.refreshVoices();
    const voice = this.currentVoice();
    if (voice?.engine === 'piper' && !voice.ready) {
      // model chưa có trong máy: tải ở nền, chưa đọc câu này (không chuyển sang giọng khác giữa chừng)
      this._ensurePiper(voice);
      this.lastEngineError = `Đang tải giọng ${voice.name} (${voice.mb} MB) — sẽ đọc ngay khi tải xong`;
      return;
    }
    if (this.lastSpokenIndex !== cue.index) return;                   // đã sang câu khác trong lúc chờ
    this.stop(false);
    this.speaking = true;
    this.duck(true);
    try {
      // Bù trễ: nếu bắt đầu đọc muộn so với câu, tính tốc độ theo thời gian CÒN LẠI (đuổi kịp từ từ nhờ làm mượt).
      const lag = Math.max(0, (this.video?.currentTime ?? cue.start) - cue.start);
      const rate = this.planRate(text, Math.max(0.8, slot - lag), this._rate);
      this._rate = rate;
      let ok = false, lastErr = null;
      const t0Speak = performance.now();                               // lúc bắt đầu đọc câu (đo độ trễ câu đầu)
      for (let attempt = 0; attempt < 2 && !ok && this.speaking; attempt++) {     // thử lại đúng giọng đó 1 lần
        try { await this._speakWith(voice, text, slot, rate); ok = true; }
        catch (e) { lastErr = e; if (e.code === 'gesture') break; }
      }
      (this.log ||= []).push({ i: cue.index, voice: voice?.id, rate, ok, err: ok ? undefined : lastErr?.message });
      if (this.log.length > 50) this.log.shift();
      if (ok) { this.failStreak = 0; this.lastEngineError = null; this.firstOkAt ||= performance.now() - (performance.now() - t0Speak); }
      else if (lastErr?.code === 'gesture') this._waitGesture();       // không phải lỗi giọng → KHÔNG đổi giọng
      else if (lastErr) {
        // Không đọc câu này bằng giọng khác (tránh đổi giọng giữa chừng); chỉ đổi hẳn sau 3 lần lỗi liên tiếp.
        this.failStreak = (this.failStreak || 0) + 1;
        console.warn('[YSN] giọng', voice?.id, 'lỗi lần', this.failStreak, lastErr.message);
        this.lastEngineError = `${voice?.name || voice?.id}: ${lastErr.message}`;
        // Giọng online bị chặn/giới hạn (Google tạm chặn, hết hạn mức key…) → đổi ngay, không chờ đủ 3 câu
        const blocked = /tạm chặn|429|hạn mức|quota/i.test(lastErr.message) && voice?.engine !== 'piper';
        if (this.failStreak >= 3 || blocked) {
          // Đánh dấu giọng này "đang hỏng" một lúc → không quay lại nó (tránh nhảy qua lại giữa 2 giọng cùng lỗi)
          (this._bad ||= new Map()).set(voice?.id, Date.now() + (blocked ? 5 : 10) * 60000);
          const fb = this._pickFallback(voice);
          if (fb) {
            this.locked = fb; this.failStreak = 0;
            this.lastEngineError = `${voice?.name} lỗi, đã chuyển sang ${fb.name}${fb.ready ? '' : ' (đang tải giọng offline)'}`;
          }
        }
      }
    } catch (e) { console.warn('[YSN] dub error', e.message); }
    finally {
      if (this.lastSpokenIndex === cue.index) { this.speaking = false; this.duck(false); }
    }
  }

  // Chờ người dùng bấm/gõ vào trang (Chrome mới cho phát tiếng) rồi đọc lại câu đang chiếu.
  _waitGesture() {
    this.lastEngineError = 'Bấm vào video một lần để bật giọng thuyết minh (Chrome yêu cầu)';
    if (this._gestureWait || typeof document === 'undefined') return;
    this._gestureWait = true;
    const done = () => {
      ['pointerdown', 'keydown'].forEach(t => document.removeEventListener(t, done, true));
      this._gestureDone = null;
      if (!this._gestureWait) return;
      this._gestureWait = false; this.lastEngineError = null;
      this.lastSpokenIndex = -1;                                     // cho phép đọc lại câu hiện tại
      this.onNeedGesture?.(false);
    };
    this._gestureDone = done;
    ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, done, true));
    this.onNeedGesture?.(true);
  }

  // Chọn giọng thay thế khi giọng hiện tại hỏng: ưu tiên giọng offline (không bao giờ bị chặn).
  // Chưa có giọng offline nào trong máy → tải ở nền, tải xong tự chuyển sang; trong lúc chờ dùng giọng khác chưa hỏng.
  _pickFallback(cur) {
    const now = Date.now();
    const ok = (v) => v.id !== cur?.id && !((this._bad?.get(v.id) || 0) > now);
    const g = (v) => v.gender === cur?.gender;
    const pipers = this.voiceList.filter(v => v.engine === 'piper' && ok(v));
    const ready = pipers.find(v => v.ready && g(v)) || pipers.find(v => v.ready);
    if (ready) return ready;
    const dl = pipers.find(g) || pipers[0];
    if (dl) this._ensurePiper(dl, true);
    const others = this.voiceList.filter(v => v.ready && v.engine !== 'piper' && ok(v));
    return others.find(g) || others[0] || dl || null;
  }

  // Tải model Piper ở nền (một lần); xong thì đánh dấu sẵn sàng. Lỗi tải → thử lại ở câu sau.
  // switchWhenReady: đang dùng giọng thay thế tạm → tải xong thì chuyển hẳn sang giọng offline này.
  _ensurePiper(voice, switchWhenReady = false) {
    if (this._piperLoading?.[voice.path]) return;
    (this._piperLoading ||= {})[voice.path] = ysnOffscreen({ type: 'PIPER_STATUS', paths: [voice.path] })
      .then(r => r?.cached?.[voice.path] ? { ok: true } : ysnOffscreen({ type: 'PIPER_DOWNLOAD', path: voice.path }))
      .then(r => {
        if (!r?.ok) return;
        voice.ready = true; this.lastEngineError = null;
        if (switchWhenReady && !(this.locked?.engine === 'piper' && this.locked.ready)) { this.locked = voice; this.failStreak = 0; this._rate = null; }
      })
      .catch(() => {})
      .finally(() => { delete this._piperLoading[voice.path]; });
  }

  _speakWith(voice, text, slot, rate) {
    if (!voice) throw new Error('không có giọng cho ngôn ngữ này');
    this._lastEngine = voice.id;
    if (voice.engine === 'piper') return this._speakPiper(voice, text, rate);
    if (voice.engine === 'cloud') return this._speakCloud(voice, text, rate);
    if (voice.engine === 'google') return this._speakGoogle(text, slot, rate);
    return this._speakWebSpeech(voice, text, rate);
  }

  // ---------- phát file âm thanh ----------
  // Cao độ KHÔNG phụ thuộc tốc độ: chỉ khi pitch ≠ 1 mới phát không-giữ-cao-độ với playbackRate = pitch cố định.
  _play(url, { playbackRate = 1, pitch = 1, calibrate = null } = {}) {
    return new Promise((resolve, reject) => {
      const a = new Audio(url);
      a.volume = this.settings.dubVolume ?? 1;
      if (calibrate) a.addEventListener('loadedmetadata', () => this._calibrate(calibrate.voiceId, calibrate.chars, a.duration, calibrate.rate), { once: true });
      if (pitch !== 1) { a.preservesPitch = false; a.playbackRate = pitch; }
      else { a.preservesPitch = true; a.playbackRate = Math.max(0.5, Math.min(3, playbackRate)); }
      a.onended = a.onerror = () => resolve();
      this.audio = a;
      a.play().catch((e) => (e?.name === 'NotAllowedError' ? reject(ysnGestureError()) : resolve()));
    });
  }

  _cached(key, make) {
    if (this.audioCache.has(key)) return this.audioCache.get(key);
    const p = make();
    if (this.audioCache.size > 200) this.audioCache.clear();
    this.audioCache.set(key, p);
    p.catch(() => this.audioCache.delete(key));
    return p;
  }

  // Piper: tốc độ đặt ngay lúc tổng hợp (giọng tự nhiên, không méo); cao độ áp khi phát.
  _piperAudio(voice, text, rate) {
    const pitch = this.settings.dubPitch || 1;
    // MMS không nhận tốc độ khi tổng hợp → tổng hợp 1 lần ở 1.0, co giãn khi phát
    const synthRate = voice.kind === 'mms' ? 1 : Math.round((rate / pitch) * 100) / 100;   // Piper: phát ở ×pitch → tốc độ thực = rate
    return this._cached(`piper|${voice.path}|${synthRate}|${text}`, () =>
      ysnOffscreen({ type: 'PIPER_SYNTH', path: voice.path, speaker: 0, rate: synthRate, text }).then(r => {
        if (!r?.ok) throw new Error(r?.error || 'Piper lỗi');
        voice.ready = true;
        this._calibrate(voice.id, text.length, r.seconds, synthRate);
        return r.dataUrl;
      }));
  }
  async _speakPiper(voice, text, rate) {
    const url = await this._piperAudio(voice, text, rate);
    if (!this.speaking) return;
    if (voice.kind === 'mms') await this._play(url, { playbackRate: rate, pitch: 1 });
    else await this._play(url, { playbackRate: 1, pitch: this.settings.dubPitch || 1 });
  }

  // Google: audio cố định → co giãn bằng playbackRate (giữ cao độ). Không áp cao độ để giọng luôn đồng nhất.
  async _speakGoogle(text, slot, rate) {
    const lang = this.settings.targetLang || 'vi';
    const chunks = this._chunk(text, 190);
    const urls = await Promise.all(chunks.map(c => this._googleAudio(c, lang)));
    for (let k = 0; k < urls.length; k++) {
      if (!this.speaking) break;
      await this._play(urls[k], { playbackRate: rate, pitch: 1, calibrate: { voiceId: 'google', chars: chunks[k].length, rate: 1 } });
    }
  }
  _googleAudio(text, lang) {
    return this._cached(`google|${lang}|${text}`, () =>
      chrome.runtime.sendMessage({ type: 'TTS_GOOGLE', text, lang }).then(r => { if (!r?.ok) throw new Error(r?.error || 'Google TTS lỗi'); return r.dataUrl; }));
  }

  // Giọng fixedRate (Gemini / OpenAI / ElevenLabs): API không nhận tốc độ → tổng hợp 1 lần ở tốc độ tự nhiên
  // (cache dùng lại cho mọi tốc độ, đỡ tốn lượt gọi), co giãn lúc phát bằng playbackRate giữ cao độ.
  _cloudAudio(voice, text, rate) {
    const fixed = !!voice.fixedRate;
    const pitch = fixed ? 1 : (this.settings.dubPitch || 1);
    const r = fixed ? 1 : rate;
    return this._cached(`cloud|${voice.cloudId}|${r}|${pitch}|${text}`, () =>
      chrome.runtime.sendMessage({ type: 'TTS_CLOUD', text, voice: voice.cloudId, rate: r, pitch, lang: this.settings.targetLang || '' }).then(resp => {
        if (!resp?.ok) throw new Error(resp?.error || 'giọng online lỗi');
        return resp.dataUrl;
      }));
  }
  async _speakCloud(voice, text, rate) {
    const url = await this._cloudAudio(voice, text, rate);
    if (!this.speaking) return;
    if (voice.fixedRate) await this._play(url, { playbackRate: rate, pitch: 1, calibrate: { voiceId: voice.id, chars: text.length, rate: 1 } });
    else await this._play(url, { playbackRate: 1, pitch: 1, calibrate: { voiceId: voice.id, chars: text.length, rate } });   // tốc độ + cao độ đã áp trong API
  }

  _speakWebSpeech(voice, text, rate) {
    return new Promise(async (resolve, reject) => {
      const all = await YSNDubber.listVoices();
      const v = all.find(x => x.voiceURI === voice.uri);
      if (!v && voice.uri) return reject(new Error('giọng hệ thống không còn'));
      const u = new SpeechSynthesisUtterance(text);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = this.settings.targetLang || 'vi-VN';
      u.rate = rate;
      u.pitch = Math.max(0.1, Math.min(2, this.settings.dubPitch || 1));
      u.volume = this.settings.dubVolume ?? 1;
      const t0 = performance.now();
      u.onend = () => { this._calibrate(voice.id, text.length, (performance.now() - t0) / 1000, rate); resolve(); };
      u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled') ? resolve() : reject(e.error === 'not-allowed' ? ysnGestureError() : new Error(e.error));
      speechSynthesis.speak(u);
      setTimeout(resolve, (text.length / 8 + 6) * 1000);       // phòng khi onend không bắn
    });
  }

  // Tải trước audio các câu sắp tới — dùng đúng giọng đã khoá và đúng tốc độ sẽ dùng (dự đoán theo chuỗi).
  prefetch(items) {
    if (!this._voicesReady || !Array.isArray(items)) return;
    const v = this.currentVoice();
    if (!v || (v.engine === 'piper' && !v.ready)) return;
    let prev = this._rate;
    for (const { text, slot } of items) {
      if (!text || YSNDubber.isNonSpeech(text)) continue;
      const r = this.planRate(text, slot, prev); prev = r;
      if (v.engine === 'piper') this._piperAudio(v, text, r).catch(() => {});
      else if (v.engine === 'cloud') this._cloudAudio(v, text, r).catch(() => {});
      else if (v.engine === 'google') this._chunk(text, 190).forEach(c => this._googleAudio(c, this.settings.targetLang || 'vi').catch(() => {}));
    }
  }

  _chunk(text, max) {
    const parts = text.split(/(?<=[.,;!?…])\s+/);
    const out = []; let cur = '';
    for (const p of parts) {
      if ((cur + ' ' + p).trim().length > max) { if (cur) out.push(cur.trim()); cur = p; }
      else cur = (cur + ' ' + p).trim();
    }
    if (cur) out.push(cur);
    return out.flatMap(c => c.length <= max ? [c] : c.match(new RegExp(`.{1,${max}}`, 'g')));
  }

  stop(restoreVolume = true) {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    if (this.audio) { try { this.audio.pause(); } catch { /* ignore */ } this.audio = null; }
    this.speaking = false;
    if (restoreVolume) this.duck(false, { immediate: true });
  }

  reset() { this.stop(); this.lastSpokenIndex = -1; }
  destroy() {
    clearTimeout(this._unduckTimer); clearInterval(this._ramp);
    if (this._gestureDone) { this._gestureWait = false; this._gestureDone(); }
    this.stop(false);
    this.applyVolume(false);
    this.video.removeEventListener('volumechange', this._onVolumeChange);
    try { delete this.video.dataset.ysnUserVol; } catch { /* bỏ qua */ }
    clearInterval(this._keepAlive);
  }
}
