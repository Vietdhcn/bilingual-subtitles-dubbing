// Phiên bản tiện ích + gói Pro. Nạp ở mọi nơi: content script, popup, trang Nâng cao, service worker (importScripts).
//   'dev'   — bản cá nhân (thư mục extension/): không giới hạn, đủ giọng offline, không có màn hình mua.
//   'store' — bản bán trên Chrome Web Store (tools/build-store.py đổi dòng dưới): miễn phí 30 phút/ngày, Pro mở khoá.
var YSN_EDITION = 'dev';

// Lemon Squeezy: điền sau khi tạo cửa hàng + sản phẩm "Pro" (3 biến thể: tháng / năm / vĩnh viễn, bật license key).
// storeId = 0 → chưa cấu hình: không mã nào được chấp nhận.
var YSN_PRO = {
  freeMinutes: 30,                 // phút dùng miễn phí mỗi ngày (bản store, chưa mua Pro)
  warnMinutes: 5,                  // còn bấy nhiêu phút thì nhắc
  graceDays: 7,                    // mất mạng: vẫn giữ Pro tối đa 7 ngày kể từ lần kiểm tra mã thành công gần nhất
  revalidateHours: 12,             // kiểm tra lại mã với Lemon Squeezy mỗi 12 giờ
  storeId: 0,                      // Lemon Squeezy store id (số)
  productIds: [],                  // product id của sản phẩm Pro (để trống = mọi sản phẩm của cửa hàng)
  variants: { monthly: 0, yearly: 0, lifetime: 0 },   // variant id của từng gói
  checkout: { monthly: '', yearly: '', lifetime: '' }, // link thanh toán (https://<cửa-hàng>.lemonsqueezy.com/buy/<uuid>)
  prices: { monthly: '2$', yearly: '20$', lifetime: '50$' },
  portal: 'https://app.lemonsqueezy.com/my-orders',     // khách xem đơn, lấy lại mã, huỷ gia hạn
  support: '',                     // email hỗ trợ hiện cho khách (điền khi phát hành)
};

// Ngày theo giờ máy người dùng (đổi ngày lúc nửa đêm) — dùng chung cho service worker và trang.
function ysnToday(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Tình trạng gói từ dữ liệu đã lưu: license (do service worker kiểm tra với Lemon Squeezy) + usage (phút đã dùng hôm nay).
function ysnPlanOf(license, usage, now = Date.now()) {
  const limitMs = YSN_PRO.freeMinutes * 60000;
  if (YSN_EDITION !== 'store') return { edition: YSN_EDITION, pro: true, unlimited: true, limitMs, usedMs: 0, remainingMs: Infinity, blocked: false };
  const fresh = !!license?.lastOk && now - license.lastOk < YSN_PRO.graceDays * 86400000;
  const notExpired = !license?.expiresAt || Date.parse(license.expiresAt) > now;
  const pro = !!license?.pro && fresh && notExpired;
  const usedMs = usage?.day === ysnToday(new Date(now)) ? (usage.ms || 0) : 0;
  const remainingMs = pro ? Infinity : Math.max(0, limitMs - usedMs);
  const v = license?.variantId, V = YSN_PRO.variants;
  const plan = !pro ? null : v && v === V.lifetime ? 'lifetime' : v && v === V.yearly ? 'yearly' : v && v === V.monthly ? 'monthly' : 'pro';
  return { edition: 'store', pro, plan, planName: license?.variantName || '', expiresAt: license?.expiresAt || null,
    limitMs, usedMs, remainingMs, blocked: !pro && remainingMs <= 0, licenseError: license?.error || null, hasKey: !!license?.key };
}

// Bản sao trạng thái gói luôn cập nhật (đọc từ storage.local, nghe thay đổi) — dùng trong trang và popup.
var YSNPlan = {
  _license: null, _usage: null, _ready: null, _listeners: new Set(),
  load() {
    if (!this._ready) {
      this._ready = chrome.storage.local.get(['license', 'usage']).then(r => { this._license = r.license || null; this._usage = r.usage || null; return this.get(); });
      chrome.storage.onChanged.addListener((c, area) => {
        if (area !== 'local' || !(c.license || c.usage)) return;
        if (c.license) this._license = c.license.newValue || null;
        if (c.usage) this._usage = c.usage.newValue || null;
        const p = this.get();
        this._listeners.forEach(fn => { try { fn(p); } catch (e) { console.warn('[YSN] plan listener', e); } });
      });
    }
    return this._ready;
  },
  get() { return ysnPlanOf(this._license, this._usage); },
  blocked() { return this.get().blocked; },
  onChange(fn) { this._listeners.add(fn); },
};
