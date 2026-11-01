# Song Ngữ & Thuyết Minh — Chrome Extension

Xem video trên **YouTube, Coursera, Udemy và mọi trang có video** (bài giảng, phim, video nhúng) với
**phụ đề song ngữ**, **phiên âm**, **tra từ** và **thuyết minh giọng nói** theo thời gian thực.
Không tải video, không chờ xử lý, không cần tài khoản.

> Tài liệu kèm theo: [`PRODUCT.md`](PRODUCT.md) (mô tả sản phẩm) · [`PLAN.md`](PLAN.md) (lộ trình & quyết định kỹ thuật)

## Bắt đầu nhanh (5 phút)
1. Cài tiện ích (mục **Cài đặt** bên dưới), mở một video YouTube/Coursera/Udemy.
2. Mặc định mọi tab đều tắt. Ở tab video muốn xem: bấm icon tiện ích → bật **Phụ đề** (hoặc rê chuột lên video → nút phụ đề ở góc trên-phải). Thẻ *Phụ đề* chọn các dòng hiển thị: phiên âm · gốc · dịch.
3. Nếu thẻ *Phụ đề* hiện ô **Dịch trên máy → Tải gói**: bấm một lần. Từ đó dịch offline, không bị Google chặn.
4. Bật **Thuyết minh** (chỉ cho tab này) → thẻ *Giọng đọc*: bấm ▶ nghe thử, chọn giọng (Vais nữ / MMS nam chạy trên máy, tải 1 lần).
   Muốn giọng biểu cảm như người thật: nhập key ở **⚙ Cài đặt nâng cao → Giọng online** (xem bảng giọng bên dưới).
5. Khi xem: rê chuột lên video để có thanh nút; phím `A` `S` `D` `Q` để học từng câu; bấm vào chữ để tra từ.

## Tính năng (v0.7.0)
### Mỗi tab một chế độ — mặc định TẮT
- Tab mới mở ra **không chạy gì** (không phụ đề, không thuyết minh, tiếng gốc giữ nguyên). Muốn dùng ở tab nào thì bật ở
  tab đó: rê chuột lên video → nút **Phụ đề** / **Thuyết minh** ở góc trên-phải, hoặc `Alt+Shift+S` / `Alt+Shift+D`,
  hoặc hai công tắc lớn trong popup. Bật/tắt bao nhiêu lần tuỳ ý, chỉ tab đó thay đổi.
- Tab đã bật thì tải lại trang, chuyển video / bài học trong cùng tab, kể cả khi tiện ích được cập nhật, vẫn giữ bật.
  Đóng tab hoặc mở lại trình duyệt → về mặc định tắt.
- Cỡ chữ, màu, giọng, ngôn ngữ… dùng chung cho mọi tab.

### Phụ đề
- **3 dòng bật/tắt riêng**: phiên âm (IPA Anh-Mỹ/Anh-Anh, pinyin, Latinh hoá tiếng Hàn/Nga) · phụ đề gốc · bản dịch.
  **Dòng gốc và dòng dịch chỉnh kiểu riêng**: trong popup chọn **Chỉnh kiểu chữ: Dòng dịch | Dòng gốc** → mỗi dòng có cỡ chữ,
  màu (5 màu có sẵn + **Màu khác…** chọn tuỳ ý), nền (viền/mờ/đậm), phông chữ riêng; dòng phiên âm theo kiểu của dòng gốc.
  **Kéo tay nắm ⠿** bên phải phụ đề để đổi vị trí.
- **Chia lại thành câu trọn ý** trước khi dịch và đọc, bất kể phụ đề gốc cắt dòng thế nào: phụ đề tự động của YouTube
  cắt ngang câu theo khung 5–6 giây ("…But your" | "curiosity has been hijacked.") nay được ghép đúng câu theo thời điểm
  từng từ; câu quá dài cắt ở dấu phẩy / liên từ; tag [music] giữa câu bị bỏ. Dịch đúng nghĩa, thuyết minh đọc cả câu.
- **Chuyển câu mượt**: khoảng lặng ngắn giữa hai câu giữ câu trước trên màn hình (không chớp trống); câu mới hiện dần 0,14 giây.
- **Tua tới đoạn chưa dịch** → dịch ngay câu đang chiếu (luồng dịch "gấp" riêng, khoảng 0,6–1 giây), phần còn lại dịch dần ở nền.
- **Tắt phụ đề song ngữ mà vẫn bật thuyết minh** → video sạch, không hiện phụ đề có sẵn của trang (CC YouTube, phụ đề Udemy…).
  Tắt cả phụ đề lẫn thuyết minh → trang trở về như cũ (CC mà tiện ích đã bật trên YouTube cũng được tắt).
- **Bản dịch có sẵn của video được ưu tiên**: video có phụ đề tiếng Việt do người dịch (TED, phim…) thì dùng bản đó thay dịch máy;
  tự phát hiện và chỉnh khi hai track lệch giờ, không khớp thì quay về dịch máy.
- **Tra từ**: bấm một chữ trong phụ đề → phiên âm, nghe phát âm (giọng thật Anh-Mỹ/Anh-Anh nếu có, giọng máy, đọc chậm), nghĩa theo từ loại,
  ví dụ, đồng nghĩa; video tự dừng khi tra. **☆ Lưu** vào **Sổ từ** (kèm câu ngữ cảnh) → xem/tìm/xuất CSV cho Anki, Quizlet ở trang Nâng cao.

### Học khi xem
- **Bảng câu**: cả bài song ngữ ở cạnh phải, câu đang nói được tô sáng và tự cuộn, bấm để tua, tìm kiếm (không dấu cũng được).
- **Thanh nút trên video** (hiện khi rê chuột): phụ đề, phiên âm, câu trước / nghe lại / câu sau, tự dừng, bảng câu, thuyết minh.
- **Phím học**: `A` câu trước · `S` nghe lại câu · `D` câu sau · `Q` tự dừng sau mỗi câu (luyện nghe, nhại theo).

### Thuyết minh
- Đọc câu dịch đúng lúc; **giọng được khoá cho cả video** (không đổi giọng giữa chừng); tốc độ **tự đo theo từng giọng** và đổi từ từ
  (mỗi câu tối đa +0.12×/−0.06×); theo tốc độ phát của video (1.25×, 1.5×…); bù trễ, không bỏ câu khi còn kịp đọc.
- Âm lượng tương đối theo mức bạn đặt trên trình phát: giọng dịch, tiếng gốc, tiếng gốc khi đang đọc (chuyển mượt), tắt hẳn tiếng gốc.
- Không đọc trong lúc quảng cáo YouTube; vẫn đọc khi chuyển sang tab khác hoặc thu nhỏ Chrome
  (tiếng gốc "im lặng" ở mức 0,01% thay vì tắt tiếng, để Chrome không tự dừng video ở nền).
- Giọng online bị chặn / hết hạn mức → tự chuyển hẳn sang giọng chạy trên máy cùng giới tính (tự tải nếu chưa có)
  thay vì im lặng; các lỗi lẻ tẻ khác chỉ đổi giọng sau 3 câu lỗi liên tiếp.
- **Video nói đúng ngôn ngữ đích** (vd. video tiếng Việt có phụ đề tiếng Anh, khoá Udemy tiếng Việt) → giữ nguyên tiếng gốc,
  không thuyết minh (nhận ngôn ngữ nói từ phụ đề tự động của YouTube / ngôn ngữ giảng của khoá Udemy). Video chỉ có phụ đề
  ngôn ngữ đích mà nói tiếng khác (phim có phụ đề Việt) thì vẫn đọc phụ đề đó.
- Mở video trong tab mới mà chưa bấm vào trang: Chrome chưa cho phát tiếng → hiện gợi ý **bấm vào video một lần**,
  bấm xong đọc tiếp bằng **đúng giọng đã chọn** (không đổi giọng).

| Loại giọng | Tiếng Việt | Ghi chú |
|---|---|---|
| Neural offline (chạy trên máy) | **Vais** (nữ, Piper), **MMS** (nam, Meta) | Không gửi văn bản ra ngoài. Tải 1 lần (63 MB / 114 MB). Chạy đa luồng, nhanh hơn thời gian thực 3–10 lần. Có thêm giọng nam/nữ cho Anh, Pháp, Đức, Nga, Trung, Tây Ban Nha, Bồ Đào Nha. |
| Giọng hệ thống | An (nam) trên Windows; Edge có HoaiMy/NamMinh | Offline, miễn phí. |
| Google | 1 giọng nữ | Online, miễn phí. |
| **Biểu cảm, giống người thật** (cần key) | **Gemini TTS**: 30 giọng nam/nữ, điều khiển cảm xúc bằng câu mô tả · **Google Cloud Chirp 3 HD**: 30 giọng · **ElevenLabs** · **OpenAI** (13 giọng) | API chính thức. Gemini lấy key miễn phí tại aistudio.google.com/apikey (có gói miễn phí); Chirp 3 HD có hạn mức miễn phí; ElevenLabs gói miễn phí nhỏ; OpenAI trả theo lượt. Ô **Cách đọc** (Gemini, OpenAI) cho phép viết kiểu “giọng kể chuyện ấm áp, truyền cảm”. |
| Online có key | Azure: HoaiMy (nữ), NamMinh (nam), giọng đa ngôn ngữ/HD | API chính thức, gói F0 miễn phí hằng tháng. |

### Dịch
Thứ tự: **bản dịch có sẵn của video** → **dịch trên máy của Chrome** (Translator API, offline, không giới hạn) → Google Translate
→ Azure Translator (nếu có key). Hoặc chọn **Claude** (key của bạn) để dịch theo ngữ cảnh.
- Chrome chỉ cho mỗi trang dùng gói dịch trên máy sau **một cú bấm của người dùng**. Khi Google chặn, video hiện nút
  **“Bật dịch trên máy”** — bấm một lần cho trang đó (YouTube, Udemy, Coursera…). Popup cũng có nút **Tải gói**.
- Google bị chặn: phần dịch nghỉ 20 phút, giọng Google nghỉ 3 phút (hai cầu dao riêng, không kéo nhau).
Cache bản dịch 150 video gần nhất; tải `.srt` song ngữ.

### Tải video kèm phụ đề / thuyết minh (với Video Catcher)
Cài thêm tiện ích **Video Catcher** (cùng tác giả): trong menu tải của nó có mục *Phụ đề & thuyết minh (CC and dịch)* — file tải về
có phụ đề in cứng đúng kiểu đang xem hoặc track bật/tắt, và thuyết minh trộn sẵn (tiếng gốc hạ như khi xem) hoặc làm bản âm thanh thứ 2.
Tiện ích này chỉ cung cấp dữ liệu (phụ đề ASS/SRT, giọng đọc cả video) qua `window.postMessage`; việc tải và ghép do Video Catcher làm.

### Mọi trang có video
| Trang | Nguồn phụ đề |
|---|---|
| YouTube (cả video nhúng trên trang khác) | Phụ đề mà chính trình phát YouTube tải về (không giả danh client khác) |
| Udemy, Udemy Business | API bài giảng của trang, bằng phiên đăng nhập của bạn |
| Coursera, edX, Vimeo, TED, video.js, Plyr, hls.js, Shaka… | `textTracks` của `<video>` — kể cả HLS/DASH nạp phụ đề dần theo đoạn |
| Trình phát tự vẽ phụ đề từ file | Tự tìm file `.vtt .srt .ass .ttml .json` mà trang đã tải |
| Trình phát chỉ vẽ phụ đề lên trang (Netflix, JW Player, ArtPlayer…) | **Chế độ trực tiếp**: đọc phụ đề đang hiện, dịch và đọc ngay |

Trên trang lạ, phần chính của tiện ích chỉ được nạp vào **đúng khung có video đang phát** (kể cả video trong iframe);
trang không có video không tốn gì. Bật/tắt riêng từng trang bằng công tắc ở chân popup; tắt tự bật mọi trang ở trang Nâng cao.
Video chưa có phụ đề: bật CC trong trình phát của trang, tiện ích tự nhận.

### Phím tắt
`Alt+Shift+S` bật/tắt phụ đề · `Alt+Shift+D` bật/tắt thuyết minh · `A` `S` `D` `Q` khi xem (xem trên) · `Esc` đóng bảng tra từ.

## Cài đặt (chế độ nhà phát triển)
1. Mở Chrome (hoặc Edge/Brave) → `chrome://extensions`, bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `extension/`.
3. Mở một video → bấm icon tiện ích → bật **Phụ đề** (và **Thuyết minh** nếu muốn).
4. Sau khi cập nhật code: bấm **↻ Tải lại** trên thẻ tiện ích. Từ bản 0.5.3 tiện ích tự nạp lại vào các tab đang mở
   (bản cũ trong tab tự dọn), không cần F5. Riêng lần đầu nâng cấp từ bản ≤ 0.5.2 thì F5 các tab video một lần.

Không cần build — JS thuần (Manifest V3).

## Bản bán trên Chrome Web Store
Cùng một mã nguồn, `edition.js` quyết định phiên bản: thư mục `extension/` là **bản cá nhân** (`YSN_EDITION = 'dev'`,
không giới hạn, đủ giọng offline); `python3 tools/build-store.py` dựng **bản bán** vào `dist/store/` và
`dist/song-ngu-thuyet-minh-<phiên bản>.zip` (tải lên store). Khác biệt của bản bán:
- **Miễn phí 30 phút/ngày** đủ mọi tính năng (chỉ tính lúc video đang chạy và tab đang bật phụ đề hoặc thuyết minh; nhiều tab cùng
  phát không bị đếm trùng; còn 5 phút thì nhắc; hết giờ thì tự tắt ở tab, hiện lời mời nâng cấp; lượt mới lúc 0 giờ).
- **Pro** (2$/tháng, 20$/năm, 50$ vĩnh viễn) mở khoá bằng mã bản quyền **Lemon Squeezy**: tiện ích gọi thẳng License API
  (`background/license.js`), không cần máy chủ riêng; chỉ nhận mã đúng store/product; kiểm tra lại 12 giờ/lần, mất mạng vẫn giữ Pro 7 ngày.
  Mục **Pro** ở trang Nâng cao: bảng giá, nhập mã, kiểm tra lại, huỷ kích hoạt trên máy, link quản lý gói. Popup hiện "Miễn phí · còn N phút" / "Pro".
- Tên mới không dùng "YouTube" làm tên; bỏ giọng offline Piper/MMS (dữ liệu huấn luyện cấm thương mại); kèm `LICENSE` (GPL-3.0) + `NOTICE.txt`.
- Cấu hình cửa hàng (store ID, product/variant ID, link thanh toán, email hỗ trợ, giá): `store/config.json`.
- Hồ sơ nộp store: `store/listing.md`, `store/review-notes.md`, `store/privacy.html`, ảnh trong `store/assets/`;
  các bước phát hành: `store/HUONG-DAN-PHAT-HANH.md`.

## Nguồn dữ liệu & giấy phép bên thứ ba
- **YouTube**: `content/page-bridge.js` (MAIN world) chỉ *quan sát* response `/api/timedtext` mà trình phát tải và gọi API của chính trình phát để bật track.
- **Giọng Piper**: model từ kho chính thức `rhasspy/piper-voices` (Vais: CC BY 4.0). **MMS** (giọng nam): `facebook/mms-tts-vie`
  bản ONNX của Xenova, giấy phép **CC BY-NC 4.0 — chỉ dùng cá nhân, phi thương mại**.
- Thư viện chạy offline trong `extension/offscreen/vendor`: onnxruntime-web (MIT), piper-phonemize (MIT) chứa **espeak-ng (GPL-3.0)**,
  pinyin-pro (MIT) — xem `THIRD_PARTY_NOTICES.txt`. Phát hành công khai cần tuân thủ GPL-3.0.
- Tra từ: Free Dictionary API (`dictionaryapi.dev`, dữ liệu Wiktionary CC BY-SA), âm thanh phát âm từ Wikimedia.

## Cách hoạt động
```
Khung có video (content scripts)                         Service worker            Offscreen document (cách ly, đa luồng)
────────────────────────────────                         ──────────────            ─────────────────────────────────────
detector.js   mọi trang: chờ <video> phát ──INJECT_FULL──► nạp phần chính vào khung
sites.js      YouTube / Udemy / generic adapter
subsources.js textTracks · file phụ đề · DOM trực tiếp
captions.js   gom câu, căn bản dịch có sẵn
translator.js hàng đợi dịch theo nội dung câu ──TRANSLATE──► Chrome Translator ─────► LOCAL_TRANSLATE
                                                          → Google → Azure / Claude
phonetic.js   dòng phiên âm ─────────────────PHONETIC────────────────────────────────► espeak-ng IPA, pinyin…
overlay.js    3 dòng phụ đề, thanh nút, tay nắm kéo
panel.js      bảng câu, A/S/D/Q, tự dừng
lookup.js     tra từ + sổ từ ────────────────LOOKUP──────► dictionaryapi.dev + dịch
dubber.js     thuyết minh, khoá giọng ───────PIPER_SYNTH (gửi thẳng) ───────────────► Piper / MMS (onnxruntime-web)
main.js       điều phối 3 chế độ: static · stream · live
```
- Đồng bộ hoàn toàn theo `video.currentTime` (chịu được tua, tạm dừng, quảng cáo, đổi tốc độ); tab ẩn vẫn chạy theo sự kiện `timeupdate`.
- Bản dịch/phiên âm lưu theo **nội dung câu** nên danh sách câu lớn dần (HLS, chế độ trực tiếp) không bị lệch.
- Trang Nâng cao/offscreen được cách ly (COOP/COEP trong manifest) → onnxruntime chạy 4 luồng.

## Cấu trúc thư mục
```
extension/
├─ manifest.json
├─ dev-mode.json                  # {"devChannel": false} — chỉ bật khi chạy công cụ test
├─ background/service-worker.js   # dịch, nạp script theo khung, tải phụ đề an toàn, TTS online, tra từ
├─ background/cloud-tts.js        # giọng online: Azure, Google Cloud, Gemini, OpenAI, ElevenLabs
├─ offscreen/                     # tts.js (Piper, dịch trên máy, phiên âm), mms.js (giọng MMS), phonetics.js, vendor/
├─ content/
│  ├─ detector.js                 # mọi trang/khung: nhận video thật đang phát
│  ├─ settings.js  captions.js  sites.js  subsources.js  translator.js  phonetic.js
│  ├─ overlay.js / overlay.css    # phụ đề, thanh nút, bảng câu, bảng tra từ
│  ├─ voices.js  dubber.js  lookup.js  panel.js  main.js
│  └─ page-bridge.js              # MAIN world trên YouTube
├─ popup/                         # cài đặt nhanh, xem trước, giọng, bật/tắt theo trang
├─ options/                       # trang web, sổ từ, dịch, giọng offline/online, bộ nhớ
└─ icons/
tools/build-store.py              # đóng gói bản bán → dist/store/ + file zip tải lên store
```

## Xử lý sự cố
| Hiện tượng | Cách xử lý |
|---|---|
| Không thấy phụ đề trên trang phim | Bật phụ đề (CC) trong trình phát của trang; tiện ích tự nhận trong vài giây. Kiểm tra công tắc trang ở chân popup. |
| Dòng dịch là “…” lâu | Google đang tạm chặn mạng của bạn → bấm nút **Bật dịch trên máy** trên video (hoặc **Tải gói** trong popup); hoặc nhập key Azure/Claude ở trang Nâng cao. |
| Thuyết minh im lặng khi đổi tab / thu nhỏ Chrome | Thường do không có bản dịch (Google chặn, xem dòng trên) hoặc giọng Google bị chặn — từ bản 0.5.4 tự tải giọng offline và chuyển sang (không nhảy qua lại giữa các giọng đang lỗi). Xem lỗi ở `chrome://extensions` → nút **Lỗi** của tiện ích. |
| Sang bài video từ bài đọc/quiz thì không có phụ đề, không đọc (Coursera, Udemy) | Lỗi tranh chấp khi đổi bài, đã sửa ở 0.5.5. |
| Tắt thuyết minh xong video im luôn (khi bật “Tắt hẳn tiếng gốc”) | Đã sửa ở 0.5.5: tắt thuyết minh trả tiếng gốc về đúng mức của bạn. |
| Video tiếng Việt bị tắt tiếng gốc, máy đọc đè lên | Đã sửa ở 0.5.5: video nói đúng ngôn ngữ đích thì không thuyết minh. |
| Giọng Vais (offline) im hẳn, nhật ký lỗi có "[espeak] Aborted" rồi "memory access out of bounds" | Đã sửa ở 0.5.7: bỏ ký tự làm hỏng bộ phiên âm (emoji, ký tự điều khiển…), chia nhỏ lô, và nếu bộ phiên âm vẫn hỏng thì tự tạo lại — câu sau đọc bình thường. |
| Kéo thanh trượt trong popup xong thì bấm nút nào cũng không ăn khoảng 1 phút | Đã sửa ở 0.5.7: cài đặt lưu ở bộ nhớ trong máy (không giới hạn số lần ghi), tự đồng bộ lên tài khoản sau 2 giây. |
| Tắt phụ đề song ngữ thì phụ đề tiếng Anh của trang hiện lên | Đã sửa ở 0.5.6: còn thuyết minh thì phụ đề của trang vẫn ẩn. Muốn xem phụ đề của trang kèm thuyết minh: tắt **Ẩn phụ đề có sẵn của trang** trong popup. |
| Thuyết minh im lặng ở câu đầu | Giọng offline đang tải lần đầu (popup ghi “Đang tải giọng…”), sẽ đọc ngay khi xong — không đổi sang giọng khác. |
| Không nghe tiếng | Chrome chặn âm thanh tới khi bạn bấm vào trang một lần — video hiện gợi ý, bấm vào video là đọc tiếp. |
| Udemy/Coursera báo không có phụ đề | Mở đúng trang **bài giảng** của khoá đã ghi danh. |
| Vừa cập nhật mà tính năng cũ | Tải lại tiện ích ở `chrome://extensions` rồi **F5** tab video. |

## Quyền sử dụng
- `storage`: cài đặt, cache bản dịch, sổ từ · `offscreen`: chạy giọng offline / dịch trên máy · `scripting` + `<all_urls>`:
  nạp phần chính vào khung có video trên trang bất kỳ và tải file phụ đề của trang.
- Văn bản chỉ gửi tới dịch vụ dịch/giọng bạn chọn (Google, Azure, Claude, Gemini, OpenAI, ElevenLabs…); giọng offline và dịch trên máy không gửi gì ra ngoài.
- API key chỉ lưu trong Chrome của bạn (`chrome.storage.sync`) và gửi thẳng tới đúng nhà cung cấp.

## Giấy phép
GPL-3.0 (file `LICENSE`) — vì tiện ích đóng gói espeak-ng (GPL-3.0). Thành phần bên thứ ba: `store/NOTICE.txt`,
`extension/offscreen/vendor/THIRD_PARTY_NOTICES.txt`.
