# Trả lời các mục "Privacy practices" và ghi chú cho người duyệt

## Single purpose (Mục đích duy nhất)
Hiển thị phụ đề song ngữ (bản gốc + bản dịch, kèm phiên âm và tra từ) và thuyết minh giọng nói cho video trên trang web,
để người dùng học ngoại ngữ khi xem video.
(EN) Show bilingual subtitles (original + translation, with phonetics and word lookup) and an optional translated voice-over
for videos on web pages, to help users learn languages while watching.

## Permission justification
- storage: lưu cài đặt, trạng thái bật/tắt của từng tab, bản dịch đã làm (để xem lại không dịch lại), sổ từ, số phút đã dùng
  trong ngày và trạng thái bản quyền Pro.
  (EN) Stores settings, per-tab on/off state, cached translations, saved words, daily usage minutes and Pro license status.
- offscreen: chạy bộ tạo phiên âm IPA (espeak-ng, WebAssembly) và dịch trên máy (Translator API) trong một offscreen document,
  vì service worker không chạy được WebAssembly dài/nặng và không có DOM.
  (EN) Runs the on-device phonetics engine (espeak-ng WebAssembly) and on-device translation in an offscreen document.
- scripting: nạp bộ phụ đề vào đúng khung (frame) đang có video trên các trang ngoài danh sách cố định, chỉ khi người dùng
  bật tiện ích ở tab đó; nạp lại vào các tab đang mở sau khi tiện ích được cập nhật.
  (EN) Injects the subtitle engine into the frame that contains a video on sites outside the fixed list, only after the user
  turns the extension on for that tab; re-injects into open tabs after an update.
- Host permission <all_urls>: tiện ích hoạt động trên mọi trang có video mà người dùng xem (phim, bài giảng, video nhúng):
  cần đọc phụ đề của video trên trang đó, tải file phụ đề (.vtt/.srt) từ máy chủ của trang, và gọi dịch vụ dịch / giọng đọc.
  Không đọc nội dung khác của trang. Người dùng có thể tắt "Tự bật trên mọi trang" hoặc tắt riêng từng trang.
  (EN) The extension works on any site where the user watches captioned video; it needs to read that video's captions,
  fetch caption files from the site's servers and call translation/voice services. It does not read other page content.

## Remote code
Không. Mọi mã JavaScript/WebAssembly nằm trong gói. (No remote code.)

## Data usage (mục "What user data do you plan to collect")
Đánh dấu:
- Website content (nội dung trang): chữ phụ đề của video đang xem được gửi tới dịch vụ dịch (Google Translate khi máy chưa có
  gói dịch; Azure/Claude nếu người dùng tự nhập key) và dịch vụ giọng đọc để đọc thuyết minh.
- Personally identifiable information: email mua hàng — Lemon Squeezy trả về khi kích hoạt mã, chỉ lưu trên máy để hiện
  "mã của ai"; không gửi đi đâu khác.
Không đánh dấu các mục còn lại (không thu thập lịch sử duyệt web, vị trí, thông tin tài chính, thông tin xác thực…).
Tích cả 3 cam kết: không bán dữ liệu cho bên thứ ba; không dùng cho mục đích khác ngoài tính năng; không dùng để xét tín dụng.

## Ghi chú cho người duyệt (Test instructions)
Tiện ích mặc định TẮT ở mọi tab. Để thử: mở một video YouTube có phụ đề (vd. https://www.youtube.com/watch?v=UF8uR6Z6KLc),
rê chuột lên video → bấm nút "Phụ đề" ở góc trên-phải (hoặc Alt+Shift+S). Thuyết minh: nút "Thuyết minh" (Alt+Shift+D).
Bản miễn phí dùng đủ tính năng 30 phút/ngày; tính năng không cần mua để duyệt.
(EN) The extension is OFF by default in every tab. Open a captioned YouTube video, hover it and click "Phụ đề" (top-right)
or press Alt+Shift+S; "Thuyết minh" / Alt+Shift+D for voice-over. The free tier gives 30 minutes per day with every feature,
so no purchase is needed for review.
