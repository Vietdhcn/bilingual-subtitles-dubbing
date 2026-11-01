# PRODUCT — Song Ngữ & Thuyết Minh (Chrome Extension)

## 1. Tầm nhìn
Giúp người xem Việt Nam và người học ngoại ngữ xem **bất kỳ video nào trên web** — YouTube, khoá học Coursera/Udemy, bài giảng,
phim, video nhúng — với **phụ đề song ngữ**, **phiên âm**, **tra từ** và **thuyết minh giọng nói** theo thời gian thực,
không tải video, không rời trang, bật một lần là chạy.

## 2. Vấn đề
- Phần lớn video chỉ có phụ đề gốc; bản dịch tự động của trang chỉ hiện **một ngôn ngữ**, không xem song song để học được.
- Người không quen đọc phụ đề (vừa làm vừa nghe, người lớn tuổi) cần **thuyết minh**; công cụ lồng tiếng AI thường bắt tải video, chờ lâu, trả phí theo phút.
- Người học cần **phát âm, nghĩa từ, nghe lại từng câu** ngay trên video, không phải chuyển qua từ điển/ứng dụng khác.

## 3. Đối tượng
| Persona | Nhu cầu chính |
|---|---|
| Người học tiếng Anh/Trung/Hàn/Nhật | Câu gốc + phiên âm + câu dịch cùng lúc; bấm chữ để tra; nghe lại, tự dừng từng câu; lưu từ để ôn |
| Người học khoá online (Coursera, Udemy Business) | Hiểu bài nhanh: song ngữ + thuyết minh giọng tự nhiên, không đổi giọng giữa chừng |
| Người xem phim / giải trí | Phụ đề tiếng Việt cho phim không có sẵn; ưu tiên bản dịch người làm khi có |
| Người xem bằng tai | Thuyết minh tự giảm tiếng gốc, chạy cả khi chuyển tab |

## 4. Tính năng (v0.5)
### 4.1 Phụ đề
- Lấy phụ đề tự động: YouTube, Udemy, textTracks (kể cả HLS/DASH), file phụ đề của trang, hoặc đọc trực tiếp phụ đề trình phát vẽ.
- Gom dòng thành câu; dịch sang ngôn ngữ đích (mặc định Tiếng Việt); **ưu tiên bản dịch có sẵn của video**, tự chỉnh lệch giờ.
- 3 dòng bật/tắt riêng: phiên âm · gốc · dịch; cỡ chữ, màu, nền, phông; kéo để đổi vị trí; ẩn phụ đề gốc của trang.
### 4.2 Học khi xem
- Tra từ (phiên âm, phát âm, nghĩa, ví dụ), sổ từ + xuất CSV.
- Bảng câu cả bài (tua, tìm, tự cuộn); câu trước / nghe lại / câu sau; tự dừng sau mỗi câu; phím A/S/D/Q; thanh nút trên video.
### 4.3 Thuyết minh
- Giọng offline nữ (Vais) và nam (MMS) cho tiếng Việt, giọng hệ thống, Google, Azure/Google Cloud (key người dùng).
- Khoá giọng theo video; tốc độ tự hiệu chỉnh, đổi từ từ; theo tốc độ phát video; ducking mượt; bỏ qua quảng cáo.
### 4.4 Mọi trang
- Tự nhận video thật đang phát trên mọi trang/khung; bật/tắt riêng từng trang; không tốn tài nguyên ở trang không có video.

## 5. Luồng người dùng
1. Cài tiện ích → mở video bất kỳ.
2. Phụ đề song ngữ hiện ngay (popup: chọn dòng hiển thị, ngôn ngữ đích, kiểu chữ).
3. Bật **Thuyết minh** → chọn giọng (nghe thử, tải giọng offline một lần) → tiếng gốc tự nhỏ lại khi đọc.
4. Học: bấm chữ để tra và lưu; mở **Bảng câu**; dùng A/S/D/Q để luyện từng câu.
5. Chuyển video / sang trang khác → tiện ích tự làm lại; trang nào không muốn thì tắt ở chân popup.

## 6. Ngoài phạm vi (hiện tại)
- Video không có bất kỳ phụ đề nào (cần nhận dạng giọng nói — xem PLAN).
- Tải video / xuất video lồng tiếng.
- Trình duyệt ngoài nhân Chromium.

## 7. Chỉ số thành công
- Câu dịch đầu tiên hiện **< 3 giây** sau khi phát (đo thật: YouTube ~2–5 s gồm cả tải phụ đề).
- Thuyết minh: **1 giọng duy nhất** suốt video, tốc độ thường **1.0–1.2×**, tỉ lệ câu bị bỏ **< 5%** (đo thật: 0/14).
- Tỉ lệ trang có phụ đề được hiển thị song ngữ **> 95%**.

## 8. Rủi ro & giảm thiểu
| Rủi ro | Giảm thiểu |
|---|---|
| Trang đổi cấu trúc phụ đề | Nhiều nguồn dự phòng (track, file, DOM trực tiếp); công cụ test tự động |
| Google giới hạn dịch | Dịch trên máy của Chrome, cầu dao, Azure/Claude |
| Thiếu giọng tiếng Việt | Giọng offline tải trong tiện ích (nữ/nam), Google, giọng online có key |
| Giấy phép thành phần | Ghi rõ trong README/THIRD_PARTY_NOTICES; MMS chỉ dùng cá nhân |
