# PLAN — Lộ trình phát triển

## Kiến trúc tổng quan
```
┌──────────────────────────── Chrome (Manifest V3) ─────────────────────────────┐
│ content/  detector.js trên mọi khung → service worker nạp phần chính vào khung có video │
│   sites + subsources : lấy phụ đề (YouTube player, Udemy API, textTracks, file, DOM)    │
│   main.js            : 3 chế độ static / stream / live, vòng cập nhật rAF + timeupdate │
│   translator / phonetic : hàng đợi theo nội dung câu, ưu tiên quanh vị trí đang xem    │
│   overlay / panel / lookup : phụ đề 3 dòng, thanh nút, bảng câu, tra từ, sổ từ          │
│   dubber + voices    : thuyết minh, khoá giọng, tốc độ tự hiệu chỉnh, ducking           │
│ background/ service worker: dịch (Chrome → Google → Azure/Claude), tải phụ đề an toàn,  │
│             tra từ, TTS online, phím tắt, ghi nhớ khung đang có video                  │
│ offscreen/  (cách ly COOP/COEP, 4 luồng): Piper, MMS, Translator API, phiên âm espeak  │
│ popup/ options/ : cài đặt nhanh, bật/tắt theo trang, giọng, sổ từ, model offline       │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Đã xong
### v0.1–v0.2
- Khung MV3 không cần build; phụ đề song ngữ YouTube; dịch Google có cache; thuyết minh Web Speech/Google TTS + ducking.
- Âm lượng & cỡ chữ riêng; giọng online Azure/Google Cloud (API chính thức, key người dùng); adapter generic, **Udemy** (API bài giảng),
  **Coursera** (`<track>`); test thật bằng Claude in Chrome.
### v0.3
- Bỏ mọi cách giả danh client khác: phụ đề YouTube lấy từ chính trình phát (page-bridge quan sát `/api/timedtext`).
- Giọng **Piper offline** (onnxruntime-web + espeak-ng WASM) trong offscreen; danh mục giọng hợp nhất; giao diện popup mới.
### v0.4
- **Giọng không đổi giữa chừng**: khoá giọng theo video; lỗi thì thử lại đúng giọng đó, chỉ đổi hẳn sau 3 lần lỗi liên tiếp (cùng giới tính).
- Tốc độ làm mượt (+0.12×/−0.06× mỗi câu), cao độ tách khỏi tốc độ, chuẩn hoá âm lượng Piper, ducking trễ 0.7s.
- **Phiên âm** (IPA theo từ, Anh-Mỹ/Anh-Anh; pinyin; Hàn/Nga Latinh hoá), **tra từ** (từ điển, phát âm thật, nghĩa tiếng Việt).
- Dịch trên máy bằng Translator API của Chrome (tải gói ngay trong popup); Google có cầu dao 20 phút khi bị chặn.
- Chạy khi tab ẩn (sự kiện `timeupdate`), gom câu thông minh hơn.
### v0.5 (bản này)
- Thuyết minh: gửi thẳng tới offscreen (không qua service worker), giọng chưa tải thì **tải nền và chờ** (không thay giọng khác);
  **tự đo tốc độ đọc từng giọng** (Vais ≈ 19–20 ký tự/giây) → tốc độ phần lớn 1.0–1.2×; theo tốc độ phát của video; không bỏ câu còn kịp đọc.
  Đo thật 75 giây: 1 giọng duy nhất, 0 lỗi, 0 câu bị bỏ.
- **Mọi trang có video**: detector nhẹ trên mọi khung, nạp phần chính theo yêu cầu (cả iframe khác tên miền, YouTube nhúng);
  nguồn phụ đề textTracks nạp dần (HLS/DASH), file `.vtt/.srt/.ass/.ttml/.json` trang đã tải, **chế độ trực tiếp** đọc phụ đề DOM;
  ẩn phụ đề gốc kể cả trình phát lạ (so khớp nội dung câu); bật/tắt theo trang.
- **Bản dịch có sẵn của video** (phụ đề ngôn ngữ đích do người làm) được ưu tiên; tự phát hiện lệch giờ (quét mốc câu + neo tiếng động).
- **Học khi xem**: bảng câu (tua, tìm, tự cuộn), thanh nút trên video, A/S/D/Q, tự dừng sau mỗi câu, kéo vị trí phụ đề, sổ từ + xuất CSV.
- **Giọng nam tiếng Việt offline** (MMS, Meta; đo cao độ 118 Hz) + đọc số/ký hiệu thành chữ; offscreen đa luồng (COOP/COEP) → Piper nhanh 2.2×, MMS 2.7×.
- YouTube: chờ hết quảng cáo mới bật phụ đề, không hiện/đọc phụ đề trong quảng cáo; phím tắt đổi cài đặt ngay ở service worker.
- Đã test (Edge headless + CDP): YouTube, YouTube nhúng trong iframe, Wikimedia Commons (video.js, 43 track, dùng phụ đề tiếng Việt có sẵn),
  trang thử phụ đề DOM / file .srt / track nạp dần / iframe khác tên miền; kiểm thử đơn vị trình đọc phụ đề và ước lượng độ lệch track.

### v0.7
- **Xuất cho Video Catcher** (`content/export.js`): tiện ích tải video cùng trang hỏi qua `window.postMessage`
  (`YSN_EXPORT_PING/RUN/CANCEL`) → trả phụ đề **ASS đúng kiểu chữ đang cài** (3 dòng phiên âm/gốc/dịch, cỡ, màu, nền, phông, vị trí;
  PlayRes = kích thước video đang hiện) + SRT, và **thuyết minh cả video** thành WAV 22,05 kHz gửi theo khúc 5 phút
  (giọng đang chọn, tốc độ tự co giãn/làm mượt như dubber.js, không chồng câu; MMS/Google/giọng fixedRate co giãn giữ cao độ bằng WSOLA)
  kèm **đường bao âm lượng tiếng gốc** 1 kHz (originalVolume/duckVolume, ramp 0,12 s vào, giữ 0,7 s, 0,35 s ra). Giọng hệ thống
  (Web Speech) không ghi ra file được → thay bằng giọng trên máy cùng giới tính; giọng online có thể bị tắt từ phía Video Catcher.
  Chỉ đọc trạng thái, không đổi cài đặt; chỉ nhận thông điệp từ chính khung hoặc khung cha.

## Việc tiếp theo
- [ ] Test trên Chrome thật (đăng nhập): Coursera, Udemy Business (chuyển bài kế tiếp), video TED trên YouTube có phụ đề tiếng Việt lệch giờ,
      trang phim dùng JW Player/ArtPlayer (cần trình duyệt giải mã H.264 — Edge headless không giải mã được).
- [ ] Mở file phụ đề của người dùng (.srt) cho video không có phụ đề (kéo thả lên video).
- [ ] Ẩn bản dịch cho tới khi rê chuột (chế độ luyện nghe), lặp đoạn A–B.
- [ ] Glossary: thuật ngữ người dùng ghi đè bản dịch; dịch theo ngữ cảnh nhiều câu với Claude.
- [ ] Video không có phụ đề: nhận dạng giọng nói (Whisper WebGPU trong trình duyệt hoặc helper cục bộ).
- [ ] Đóng gói phát hành: icon, chính sách quyền riêng tư, tuân thủ GPL (espeak-ng), giấy phép phi thương mại của MMS.

## Quyết định kỹ thuật
| Chủ đề | Quyết định | Lý do |
|---|---|---|
| Phụ đề YouTube | Quan sát response `/api/timedtext` của chính trình phát (MAIN world), bật track bằng API trình phát | Không giả danh client khác; URL timedtext tự gọi cần token `pot` |
| Trang bất kỳ | Detector 1 KB trên mọi khung + `chrome.scripting` nạp phần chính theo yêu cầu | Không tốn tài nguyên ở trang không có video; hoạt động cả trong iframe |
| Chế độ nguồn | static / stream (danh sách lớn dần) / live (DOM) | Phủ được cả HLS nạp dần và trình phát chỉ vẽ phụ đề |
| Bản dịch, phiên âm | Lưu theo nội dung câu (Map) | Danh sách câu thay đổi không làm lệch; câu lặp chỉ dịch 1 lần |
| Dịch | Chrome Translator (offline) → Google → Azure; Claude tuỳ chọn | Không giới hạn khi có gói máy; Google có cầu dao khi bị chặn, không lặp lại yêu cầu |
| Thuyết minh | Khoá giọng theo video, tốc độ hiệu chỉnh theo audio thật, làm mượt | Người nghe không thấy “đổi người đọc” |
| Giọng offline | Piper (espeak-ng) + MMS (theo chữ cái) trong offscreen, onnxruntime-web 4 luồng | Chất lượng neural, không gửi văn bản ra ngoài, đủ nhanh để tải trước 2 câu |
| Test | Edge headless + CDP (profile mới mỗi lần, chỉ nạp tiện ích này) | Chrome ≥137 bỏ `--load-extension`; chạy được khi màn hình khoá |
| Lưu trữ | Cài đặt `storage.sync`; cache dịch (150 video) và sổ từ `storage.local`; trạng thái khung `storage.session` | Đồng bộ cài đặt giữa máy, dữ liệu lớn để cục bộ |

## Rủi ro cần theo dõi
1. YouTube đổi cơ chế tải phụ đề/giao diện (lớp `.ytp-caption-window-container`, `ad-showing`) → kiểm tra định kỳ trên một video YouTube có phụ đề.
2. Endpoint Google miễn phí có thể chặn theo IP → cầu dao 20 phút + gợi ý tải gói dịch trên máy.
3. Trình phát lạ đổi lớp CSS → chế độ trực tiếp dựa vào danh sách bộ chọn + so khớp vị trí/nội dung; cần bổ sung khi gặp trang mới.
4. Giấy phép: espeak-ng GPL-3.0 (đóng gói), MMS CC BY-NC 4.0 (người dùng tự tải) — cần xử lý trước khi phát hành thương mại.
