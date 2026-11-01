// Chạy trên MỌI trang (mọi khung): rất nhẹ, chỉ chờ có <video> thật sự phát (phim, bài giảng…)
// rồi nhờ service worker nạp phần chính của extension vào đúng khung đó. Trang không có video → không tốn gì.
(() => {
  if (window.__ysnDetector || window.__ysnLoaded) return;
  window.__ysnDetector = true;
  let asked = false;

  // Video "thật": đủ lớn, đủ dài (bỏ qua ảnh động / quảng cáo ngắn / video nền lặp lại)
  const isRealVideo = (v) => v instanceof HTMLVideoElement && !v.loop &&
    v.offsetWidth >= 240 && v.offsetHeight >= 135 &&
    (v.duration === Infinity || !(v.duration > 0) || v.duration >= 45);

  async function request(v) {
    if (asked || !isRealVideo(v)) return;
    asked = true;
    try {
      // service worker tự xét: tab này / trang này đang tắt thì không nạp (chờ lần phát sau hoặc khi bật lại)
      const r = await chrome.runtime.sendMessage({ type: 'INJECT_FULL' });
      if (r?.off) asked = false;
    } catch { asked = false; }
  }

  for (const ev of ['playing', 'loadedmetadata', 'durationchange']) {
    document.addEventListener(ev, (e) => { const v = e.target; if (!v.paused || ev === 'playing') request(v); }, true);
  }
  // Video đã phát trước khi script chạy, hoặc nằm trong shadow DOM (sự kiện không lọt ra ngoài)
  let n = 0;
  const scan = () => {
    const vids = [...document.getElementsByTagName('video')];
    if (!vids.length && n % 3 === 1) {                                   // thỉnh thoảng mới dò shadow DOM (tốn hơn)
      for (const host of document.querySelectorAll('*')) if (host.shadowRoot) vids.push(...host.shadowRoot.querySelectorAll('video'));
    }
    for (const v of vids) if (!v.paused && v.readyState >= 2) request(v);
  };
  const timer = setInterval(() => { if (asked || ++n > 45) return clearInterval(timer); if (!document.hidden) scan(); }, 4000);
  // Bật lại từ popup ("Bật trên trang này") mà không cần tải lại trang
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'YSN_DETECT_NOW' && !asked) {
      for (const v of document.getElementsByTagName('video')) if (v.offsetWidth >= 240) { request(v); break; }
    }
  });
})();
