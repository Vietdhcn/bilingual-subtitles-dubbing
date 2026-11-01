const $ = (id) => document.getElementById(id);
const F = ['provider', 'azureTranslatorKey', 'azureTranslatorRegion', 'claudeApiKey', 'claudeModel', 'ttsProvider', 'azureKey', 'azureRegion', 'gcloudKey',
  'geminiKey', 'geminiTtsModel', 'openaiKey', 'elevenKey', 'elevenModel', 'ttsStyle'];
const LANG_NAME = Object.fromEntries(YSN_LANGS.map(([c, n]) => [c.split('-')[0], n]));
const GENDER = { female: 'nữ', male: 'nam' };
let cached = {}; const downloading = {};

function toggleBoxes() {
  $('claudeBox').hidden = $('provider').value !== 'claude';
  const tp = $('ttsProvider').value;
  $('azureBox').hidden = tp !== 'azure';
  $('gcloudBox').hidden = tp !== 'gcloud';
  $('geminiBox').hidden = tp !== 'gemini';
  $('openaiBox').hidden = tp !== 'openai';
  $('elevenBox').hidden = tp !== 'elevenlabs';
  $('styleBox').hidden = tp !== 'gemini' && tp !== 'openai';
}

function renderModels() {
  const ul = $('piperList'); ul.replaceChildren();
  let lastLang = '';
  for (const v of YSN_PIPER_VOICES) {
    const base = ysnBaseLang(v.lang);
    if (base !== lastLang) { const h = document.createElement('li'); h.className = 'lang-head'; h.textContent = `${LANG_NAME[base] || v.lang} (${v.lang})`; ul.append(h); lastLang = base; }
    const li = document.createElement('li'); li.className = 'model';
    const info = document.createElement('div');
    const n = document.createElement('div'); n.className = 'name'; n.textContent = `${v.name}, ${GENDER[v.gender] || ''}`.replace(/, $/, '');
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = `${v.mb} MB${v.license ? ', giấy phép ' + v.license : ''}`;
    info.append(n, sub);
    const act = document.createElement('div');
    const d = downloading[v.path];
    if (cached[v.path]) {
      const st = document.createElement('span'); st.className = 'state'; st.textContent = 'Đã có trên máy';
      const del = document.createElement('button'); del.className = 'ghost'; del.type = 'button'; del.textContent = 'Xoá';
      del.onclick = async () => { await chrome.runtime.sendMessage({ type: 'PIPER_DELETE', path: v.path }); cached[v.path] = false; renderModels(); };
      act.append(st, del);
    } else {
      const b = document.createElement('button'); b.className = 'ghost'; b.type = 'button';
      b.textContent = d ? (d.total ? `Đang tải ${Math.round(d.loaded / d.total * 100)}%` : 'Đang tải…') : 'Tải về';
      b.disabled = !!d;
      b.onclick = () => download(v);
      act.append(b);
    }
    li.append(info, act);
    if (d) { const bar = document.createElement('span'); bar.className = 'progress'; const i = document.createElement('i'); i.style.width = d.total ? (d.loaded / d.total * 100) + '%' : '8%'; bar.append(i); li.append(bar); }
    ul.append(li);
  }
}

async function download(v) {
  downloading[v.path] = { loaded: 0, total: 0 }; renderModels();
  const r = await chrome.runtime.sendMessage({ type: 'PIPER_DOWNLOAD', path: v.path }).catch(e => ({ ok: false, error: e.message }));
  delete downloading[v.path];
  if (r?.ok) cached[v.path] = true; else alert(`Không tải được ${v.name}: ${r?.error || 'lỗi mạng'}`);
  renderModels();
}
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === 'PIPER_PROGRESS' && downloading[m.path]) { downloading[m.path] = { loaded: m.loaded, total: m.total }; renderModels(); }
});

(async () => {
  const r = await chrome.runtime.sendMessage({ type: 'GET_OPTIONS' });
  const o = r?.options || {};
  F.forEach(f => { if (o[f] !== undefined) $(f).value = o[f]; });
  toggleBoxes();
  $('provider').addEventListener('change', toggleBoxes);
  $('ttsProvider').addEventListener('change', toggleBoxes);
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const options = {}; F.forEach(f => options[f] = $(f).value.trim());
    await chrome.storage.sync.set({ options });
    $('msg').textContent = 'Đã lưu'; setTimeout(() => $('msg').textContent = '', 2500);
  });

  const s = await YSNSettings.load();
  for (const k of ['autoAllSites', 'showToolbar', 'learningKeys']) {
    $(k).checked = s[k] !== false;
    $(k).addEventListener('change', e => YSNSettings.save({ [k]: e.target.checked }).then(renderSites));
  }
  renderSites();
  renderWords();
  $('wordSearch').addEventListener('input', renderWords);
  $('exportWords').addEventListener('click', exportWords);
  $('clearWords').addEventListener('click', async () => {
    if (!confirm('Xoá toàn bộ sổ từ?')) return;
    await chrome.storage.local.set({ savedWords: [] }); renderWords();
  });
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.savedWords) renderWords(); if (area === 'sync' && c.settings) renderSites(); });
  $('devMode').checked = !!s.devMode;
  $('devMode').addEventListener('change', e => YSNSettings.save({ devMode: e.target.checked }));
  $('reload').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'RELOAD' }));
  $('clearCache').addEventListener('click', async () => {
    if (!confirm('Xoá mọi bản dịch đã lưu? Video xem lại sẽ phải dịch lại từ đầu.')) return;
    const r = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    $('cacheMsg').textContent = r?.ok ? `Đã xoá bản dịch của ${r.removed} video` : 'Không xoá được';
  });

  initPro();
  if (YSN_EDITION === 'store') return;            // bản store không có giọng offline
  renderModels();
  try { const st = await chrome.runtime.sendMessage({ type: 'PIPER_STATUS', paths: YSN_PIPER_VOICES.map(v => v.path) }); if (st?.ok) cached = st.cached; } catch { /* ignore */ }
  renderModels();
})();

// ---------- Song Ngữ Pro (chỉ bản store) ----------
const PLAN_VI = { monthly: 'Gói tháng', yearly: 'Gói năm', lifetime: 'Vĩnh viễn', pro: 'Pro' };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' }); } catch { return iso; } };
function proMsg(text, kind = '') { const m = $('licenseMsg'); m.textContent = text; m.className = 'hint' + (kind ? ' ' + kind : ''); }
function renderPro(plan, license) {
  const now = $('planNow');
  now.className = 'plan-now' + (plan.pro ? ' pro' : plan.blocked ? ' out' : '');
  now.replaceChildren();
  const b = document.createElement('b'), line = document.createElement('div');
  if (plan.pro) {
    b.textContent = `Đang dùng Pro${plan.plan && plan.plan !== 'pro' ? ' · ' + PLAN_VI[plan.plan] : plan.planName ? ' · ' + plan.planName : ''}`;
    line.textContent = plan.plan === 'lifetime' ? 'Không giới hạn, dùng mãi.' : license?.expiresAt ? `Có hiệu lực đến ${fmtDate(license.expiresAt)}.` : 'Không giới hạn thời gian xem. Gói tự gia hạn cho tới khi bạn huỷ.';
    now.append(b, line);
  } else {
    const used = Math.min(plan.limitMs, plan.usedMs);
    b.textContent = 'Đang dùng bản miễn phí';
    line.textContent = plan.blocked ? `Hôm nay đã dùng hết ${YSN_PRO.freeMinutes} phút. Lượt mới bắt đầu lúc 0 giờ, hoặc nâng cấp Pro để dùng tiếp ngay.`
      : `Hôm nay đã dùng ${Math.floor(used / 60000)}/${YSN_PRO.freeMinutes} phút (chỉ tính lúc video đang chạy và đang bật phụ đề hoặc thuyết minh).`;
    const meter = document.createElement('div'); meter.className = 'meter';
    const fill = document.createElement('i'); fill.style.width = Math.round(used / plan.limitMs * 100) + '%'; meter.append(fill);
    now.append(b, line, meter);
  }
  document.querySelectorAll('.plan').forEach(a => a.classList.toggle('current', plan.pro && a.dataset.plan === plan.plan));
  $('licenseBox').hidden = !license?.key;
  if (license?.key) {
    const st = license.pro ? 'đang hoạt động' : license.status === 'expired' ? 'đã hết hạn' : license.status === 'disabled' ? 'bị vô hiệu hoá' : 'chưa hợp lệ';
    $('licenseInfo').textContent = `Mã ${license.key} · ${st}${license.email ? ' · ' + license.email : ''}${license.error ? ' — ' + license.error : ''}`;
  }
}
async function refreshPro(revalidate = false) {
  const r = await chrome.runtime.sendMessage({ type: revalidate ? 'PLAN_GET' : 'LICENSE_INFO', revalidate }).catch(() => null);
  const info = revalidate ? await chrome.runtime.sendMessage({ type: 'LICENSE_INFO' }).catch(() => null) : r;
  renderPro(info?.plan || YSNPlan.get(), info?.license || null);
  return info;
}
function initPro() {
  const store = YSN_EDITION === 'store';
  $('pro').hidden = $('tocPro').hidden = !store;
  if (!store) return;
  for (const id of ['offline', 'tocOffline', 'dev', 'tocDev']) $(id).hidden = true;
  for (const a of document.querySelectorAll('.plan')) {
    const k = a.dataset.plan, url = YSN_PRO.checkout[k];
    a.querySelector('.price').textContent = YSN_PRO.prices[k];
    if (url) a.href = url; else { a.classList.add('off'); a.removeAttribute('href'); }
  }
  if (!Object.values(YSN_PRO.checkout).some(Boolean)) $('buyNote').textContent = 'Chưa mở bán — các gói sẽ có ở bản phát hành.';
  $('portal').href = YSN_PRO.portal;
  $('seller').textContent = 'Tiện ích này do nhà phát triển độc lập làm và bán qua Lemon Squeezy (đơn vị thu tiền), không phải Google.'
    + (YSN_PRO.support ? ` Hỗ trợ: ${YSN_PRO.support}` : '');
  $('activate').addEventListener('click', async () => {
    const key = $('licenseKey').value.trim();
    if (!key) { proMsg('Dán mã bản quyền vào ô trên', 'err'); return; }
    $('activate').disabled = true; proMsg('Đang kiểm tra mã…');
    const r = await chrome.runtime.sendMessage({ type: 'LICENSE_ACTIVATE', key }).catch(e => ({ ok: false, error: e.message }));
    $('activate').disabled = false;
    if (!r?.ok) { proMsg(r?.error || 'Không kích hoạt được', 'err'); return; }
    $('licenseKey').value = '';
    proMsg('Đã kích hoạt Pro trên máy này. Cảm ơn bạn!', 'ok');
    refreshPro();
  });
  $('licenseKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('activate').click(); });
  $('recheck').addEventListener('click', async () => { proMsg('Đang kiểm tra…'); const r = await refreshPro(true); proMsg(r?.license?.pro ? 'Mã vẫn hoạt động' : (r?.license?.error || 'Đã kiểm tra'), r?.license?.pro ? 'ok' : 'err'); });
  let armed = 0;
  $('deactivate').addEventListener('click', async () => {
    if (Date.now() - armed > 4000) { armed = Date.now(); $('deactivate').textContent = 'Bấm lần nữa để xác nhận'; setTimeout(() => { $('deactivate').textContent = 'Huỷ kích hoạt trên máy này'; }, 4000); return; }
    armed = 0; $('deactivate').textContent = 'Huỷ kích hoạt trên máy này';
    await chrome.runtime.sendMessage({ type: 'LICENSE_DEACTIVATE' }).catch(() => {});
    proMsg('Đã huỷ kích hoạt trên máy này — mã có thể dùng cho máy khác.', 'ok');
    refreshPro();
  });
  YSNPlan.onChange(() => refreshPro());
  YSNPlan.load().then(() => refreshPro());
  if (location.hash === '#pro') setTimeout(() => $('pro').scrollIntoView(), 50);
}

// ---------- trang web ----------
function renderSites() {
  const s = YSNSettings.get();
  const ul = $('siteList'); ul.replaceChildren();
  const entries = Object.entries(s.siteMode || {}).sort((a, b) => a[0].localeCompare(b[0]));
  $('siteEmpty').hidden = entries.length > 0;
  for (const [host, mode] of entries) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    const h = document.createElement('span'); h.className = 'host'; h.textContent = host;
    const m = document.createElement('span'); m.className = 'mode ' + mode; m.textContent = mode === 'on' ? 'luôn bật' : 'đã tắt';
    left.append(h, m);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost'; del.textContent = 'Bỏ cài đặt riêng';
    del.onclick = async () => { const sm = { ...(YSNSettings.get().siteMode || {}) }; delete sm[host]; await YSNSettings.save({ siteMode: sm }); renderSites(); };
    li.append(left, del); ul.append(li);
  }
}

// ---------- sổ từ ----------
async function renderWords() {
  const all = (await chrome.storage.local.get('savedWords')).savedWords || [];
  const q = ($('wordSearch').value || '').trim().toLowerCase();
  const list = q ? all.filter(w => (w.word + ' ' + w.meaning + ' ' + (w.sentence || '')).toLowerCase().includes(q)) : all;
  const ul = $('wordList'); ul.replaceChildren();
  $('wordEmpty').hidden = all.length > 0;
  $('exportWords').disabled = $('clearWords').disabled = !all.length;
  for (const w of list.slice(0, 500)) {
    const li = document.createElement('li');
    const top = document.createElement('div');
    const wd = document.createElement('span'); wd.className = 'w'; wd.textContent = w.word;
    const ipa = document.createElement('span'); ipa.className = 'ipa'; ipa.textContent = w.ipa || '';
    top.append(wd, ipa);
    const m = document.createElement('div'); m.className = 'm'; m.textContent = [w.pos, w.meaning].filter(Boolean).join(': ');
    const ctx = document.createElement('div'); ctx.className = 'ctx';
    if (w.sentence) ctx.append('“' + w.sentence + '”' + (w.sentenceTr ? ' — ' + w.sentenceTr : ''));
    if (w.url) {
      const a = document.createElement('a'); a.href = w.url + (w.time != null && /youtube\.com\/watch/.test(w.url) ? '&t=' + w.time + 's' : '');
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' · mở video';
      ctx.append(a);
    }
    const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost del'; del.textContent = 'Xoá';
    del.setAttribute('aria-label', 'Xoá từ ' + w.word);
    del.onclick = async () => {
      const cur = (await chrome.storage.local.get('savedWords')).savedWords || [];
      const at = cur.findIndex(x => x.key === w.key);
      if (at < 0) return;
      const [gone] = cur.splice(at, 1);
      await chrome.storage.local.set({ savedWords: cur });
      showUndo(`Đã xoá “${gone.word}”`, async () => {
        const now = (await chrome.storage.local.get('savedWords')).savedWords || [];
        if (now.some(x => x.key === gone.key)) return;
        now.splice(Math.min(at, now.length), 0, gone);
        await chrome.storage.local.set({ savedWords: now });
      });
    };
    li.append(top, del, m, ctx); ul.append(li);
  }
}
// Thông báo "Đã xoá · Hoàn tác" cạnh sổ từ (tự ẩn sau 6 giây)
let undoTimer = 0;
function showUndo(text, undo) {
  const box = $('wordsMsg');
  box.replaceChildren(text + ' · ');
  const b = document.createElement('button'); b.type = 'button'; b.className = 'link-btn'; b.textContent = 'Hoàn tác';
  b.onclick = async () => { clearTimeout(undoTimer); box.textContent = ''; await undo(); };
  box.append(b);
  clearTimeout(undoTimer); undoTimer = setTimeout(() => { box.textContent = ''; }, 6000);
}
async function exportWords() {
  const all = (await chrome.storage.local.get('savedWords')).savedWords || [];
  // ô bắt đầu bằng = + - @ bị Excel/Sheets hiểu là công thức (chữ phụ đề do người làm video viết) → thêm ' phía trước
  const esc = (x) => { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  // Cột: Từ, Phiên âm, Nghĩa, Từ loại, Câu gốc, Câu dịch, Định nghĩa — nhập thẳng vào Anki/Quizlet
  const rows = [['Từ', 'Phiên âm', 'Nghĩa', 'Từ loại', 'Câu gốc', 'Câu dịch', 'Định nghĩa']]
    .concat(all.map(w => [w.word, w.ipa, w.meaning, w.pos, w.sentence, w.sentenceTr, w.def]));
  const csv = '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'so-tu-song-ngu.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
