// Bản quyền Pro qua License API của Lemon Squeezy (không cần máy chủ riêng) + đếm phút dùng miễn phí mỗi ngày.
// Chạy trong service worker (importScripts sau edition.js). Lưu ở storage.local:
//   license: { key, instanceId, pro, status, expiresAt, variantId, variantName, email, lastCheck, lastOk, error }
//   usage:   { day: 'YYYY-MM-DD', ms, coveredUntil }  — thời gian thực sự dùng (video đang chạy + đang bật tiện ích)
//   deviceId: chuỗi ngẫu nhiên — tên máy khi kích hoạt (khách nhận ra máy trong trang đơn hàng)
const LS_API = 'https://api.lemonsqueezy.com/v1/licenses/';

async function lsCall(action, params) {
  let res;
  try {
    res = await fetch(LS_API + action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  } catch (e) { throw Object.assign(new Error('Không kết nối được máy chủ bản quyền — kiểm tra mạng rồi thử lại'), { network: true }); }
  let data = null;
  try { data = await res.json(); } catch { /* không phải JSON */ }
  if (!data || (res.status >= 500 && data.error == null)) throw Object.assign(new Error(`Máy chủ bản quyền lỗi (HTTP ${res.status}) — thử lại sau`), { network: true });
  return data;
}

// Mã có đúng là của cửa hàng / sản phẩm này không (không có bước này thì mã của sản phẩm Lemon Squeezy khác cũng mở được Pro)
function lsOurs(meta) {
  if (!meta || !YSN_PRO.storeId || Number(meta.store_id) !== Number(YSN_PRO.storeId)) return false;
  return !YSN_PRO.productIds.length || YSN_PRO.productIds.map(Number).includes(Number(meta.product_id));
}
function lsStatusOk(lk) {
  return !!lk && (lk.status === 'active' || lk.status === 'inactive') && (!lk.expires_at || Date.parse(lk.expires_at) > Date.now());
}
function lsErrorVi(err, lk) {
  const e = String(err || '').toLowerCase();
  if (lk?.status === 'expired' || /expired/.test(e)) return 'Gói đã hết hạn — gia hạn hoặc mua gói mới để dùng tiếp Pro';
  if (lk?.status === 'disabled' || /disabled/.test(e)) return 'Mã đã bị vô hiệu hoá';
  if (/activation limit/.test(e)) return 'Mã đã kích hoạt trên đủ số máy cho phép — huỷ kích hoạt ở máy cũ (trong tiện ích) rồi thử lại';
  if (/not found|invalid|does not exist/.test(e)) return 'Mã không đúng — kiểm tra lại (dán nguyên mã trong email mua hàng)';
  if (/instance/.test(e)) return 'Máy này không còn trong danh sách kích hoạt của mã — kích hoạt lại';
  return err ? String(err) : 'Mã không hợp lệ';
}

async function licenseGet() { return (await chrome.storage.local.get('license')).license || null; }
async function licenseSet(l) { if (l) await chrome.storage.local.set({ license: l }); else await chrome.storage.local.remove('license'); }

async function deviceName() {
  let { deviceId } = await chrome.storage.local.get('deviceId');
  if (!deviceId) { deviceId = crypto.randomUUID().slice(0, 8); await chrome.storage.local.set({ deviceId }); }
  const p = navigator.userAgentData?.platform || (/Windows/.test(navigator.userAgent) ? 'Windows' : /Mac/.test(navigator.userAgent) ? 'macOS' : 'máy tính');
  const b = /Edg\//.test(navigator.userAgent) ? 'Edge' : 'Chrome';
  return `${b} · ${p} · ${deviceId}`;
}

function licenseFrom(key, instanceId, r, now = Date.now()) {
  return {
    key, instanceId, pro: lsStatusOk(r.license_key), status: r.license_key?.status || null, expiresAt: r.license_key?.expires_at || null,
    variantId: Number(r.meta?.variant_id) || null, variantName: r.meta?.variant_name || '', productName: r.meta?.product_name || '',
    email: r.meta?.customer_email || '', lastCheck: now, lastOk: now, error: null,
  };
}

async function licenseActivate(rawKey) {
  const key = String(rawKey || '').trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) throw new Error('Mã không đúng định dạng — dán nguyên mã trong email mua hàng');
  if (!YSN_PRO.storeId) throw new Error('Bản này chưa được cấu hình cửa hàng — liên hệ người bán');
  const old = await licenseGet();
  if (old?.key === key && old.instanceId && old.pro) return licenseValidate(true);      // đã kích hoạt máy này rồi
  const r = await lsCall('activate', { license_key: key, instance_name: await deviceName() });
  if (!r.activated) throw new Error(lsErrorVi(r.error, r.license_key));
  if (!lsOurs(r.meta)) {
    lsCall('deactivate', { license_key: key, instance_id: r.instance?.id }).catch(() => {});   // trả lại lượt kích hoạt
    throw new Error('Mã này không phải mã của Song Ngữ Pro');
  }
  if (!lsStatusOk(r.license_key)) throw new Error(lsErrorVi(r.error, r.license_key));
  // mã cũ trên máy này (nếu khác) → huỷ kích hoạt để không chiếm lượt
  if (old?.key && old.key !== key && old.instanceId) lsCall('deactivate', { license_key: old.key, instance_id: old.instanceId }).catch(() => {});
  const lic = licenseFrom(key, r.instance?.id, r);
  await licenseSet(lic);
  return lic;
}

// Kiểm tra lại mã (định kỳ hoặc khi mở trang Pro). Mất mạng → giữ nguyên, ysnPlanOf vẫn cho Pro trong graceDays.
let validating = null;
async function licenseValidate(force = false) {
  if (validating) return validating;
  validating = (async () => {
    const lic = await licenseGet();
    if (!lic?.key) return lic;
    if (!force && Date.now() - (lic.lastCheck || 0) < YSN_PRO.revalidateHours * 3600000) return lic;
    let next;
    try {
      const r = await lsCall('validate', { license_key: lic.key, instance_id: lic.instanceId || '' });
      if (r.valid && lsOurs(r.meta) && lsStatusOk(r.license_key)) next = { ...lic, ...licenseFrom(lic.key, lic.instanceId, r) };
      else next = { ...lic, pro: false, status: r.license_key?.status || 'invalid', expiresAt: r.license_key?.expires_at ?? lic.expiresAt,
        lastCheck: Date.now(), error: lsErrorVi(r.error, r.license_key) };
    } catch (e) {
      // lỗi mạng: thử lại sau 30 phút, không đổi trạng thái Pro
      next = { ...lic, lastCheck: Date.now() - YSN_PRO.revalidateHours * 3600000 + 30 * 60000, netError: e.message };
    }
    await licenseSet(next);
    return next;
  })();
  try { return await validating; } finally { validating = null; }
}

async function licenseDeactivate() {
  const lic = await licenseGet();
  if (lic?.key && lic.instanceId) { try { await lsCall('deactivate', { license_key: lic.key, instance_id: lic.instanceId }); } catch { /* vẫn xoá trên máy */ } }
  await licenseSet(null);
}

async function planNow() {
  const { license, usage } = await chrome.storage.local.get(['license', 'usage']);
  return ysnPlanOf(license || null, usage || null);
}

// Đếm phút: mỗi khung đang phát video (và đang bật phụ đề / thuyết minh) báo đoạn [from, to].
// Nhiều tab cùng phát không bị đếm trùng (chỉ cộng phần sau coveredUntil). Ghi nối tiếp nhau (không giẫm lên nhau).
let usageChain = Promise.resolve();
function usageTick(from, to) {
  const run = usageChain.then(async () => {
    const { license, usage } = await chrome.storage.local.get(['license', 'usage']);
    if (ysnPlanOf(license || null, usage || null).pro) return ysnPlanOf(license || null, usage || null);
    const now = Date.now();
    to = Math.min(Number(to) || now, now);
    from = Math.max(Number(from) || to, to - 60000);              // mỗi lần báo tối đa 60 giây
    const day = ysnToday(new Date(to));
    let u = usage?.day === day ? { ...usage } : { day, ms: 0, coveredUntil: 0 };
    const add = Math.max(0, to - Math.max(from, u.coveredUntil || 0));
    if (add > 0) { u.ms = (u.ms || 0) + add; u.coveredUntil = Math.max(u.coveredUntil || 0, to); await chrome.storage.local.set({ usage: u }); }
    return ysnPlanOf(license || null, u);
  });
  usageChain = run.catch(() => {});
  return run;
}

// Bật tính năng cho tab có bị chặn không (hết phút miễn phí)
async function planBlocked() {
  if (YSN_EDITION !== 'store') return false;
  let p = await planNow();
  if (p.blocked && p.hasKey) { await licenseValidate(true).catch(() => {}); p = await planNow(); }   // vừa gia hạn?
  return p.blocked;
}
