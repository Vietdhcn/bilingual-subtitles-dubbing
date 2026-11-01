# Phát hành bản bán lên Chrome Web Store

Bản bán được dựng tự động từ thư mục `extension/` (bản cá nhân vẫn giữ nguyên, không giới hạn):

    python3 tools/build-store.py        →  dist/song-ngu-thuyet-minh-<phiên bản>.zip   (tải lên store)
                                           dist/store/                                (Load unpacked để thử)

Khác bản cá nhân: miễn phí 30 phút/ngày, Pro mở khoá qua Lemon Squeezy; tên mới không chứa "YouTube"; không có giọng
offline Piper/MMS (dữ liệu huấn luyện cấm thương mại); kèm LICENSE GPL-3.0 + NOTICE; không có kênh test (dev-mode.json).

## Việc chỉ bạn làm được (tài khoản, giấy tờ, thanh toán)

1. **Lemon Squeezy** (https://app.lemonsqueezy.com/register)
   - Đăng ký, tạo cửa hàng (Store), điền thông tin nhận tiền: tài khoản ngân hàng Việt Nam được hỗ trợ (hoặc PayPal).
   - Lemon Squeezy sẽ duyệt cửa hàng trước khi cho bán thật (vài ngày) — cần mô tả sản phẩm + link trang store/chính sách.
   - Tạo sản phẩm **Song Ngữ Pro** với 3 biến thể (variants):
     | Biến thể | Giá | Kiểu |
     |---|---|---|
     | Theo tháng | 2 USD | Subscription, mỗi 1 tháng |
     | Theo năm | 20 USD | Subscription, mỗi 1 năm |
     | Vĩnh viễn | 50 USD | Single payment |
   - Ở mỗi biến thể bật **Generate license keys**, Activation limit = 3, License length = Unlimited
     (với gói tháng/năm, mã tự hết hạn khi gói hết hạn).
   - Sau khi tạo xong, nhắn mình — mình mở trang quản trị Lemon Squeezy của bạn trong Chrome, lấy store ID, product ID,
     variant ID, link thanh toán điền vào `store/config.json` rồi đóng gói lại. (Hoặc bạn tự điền theo mẫu trong file.)

2. **Chrome Web Store** (https://chrome.google.com/webstore/devconsole)
   - Đăng ký tài khoản nhà phát triển (phí 5 USD một lần), xác minh email; đặt tên nhà phát hành (Publisher) — đây là tên
     người bán hiện cho khách.
   - Email hỗ trợ: điền vào `store/config.json` ("support") và `store/privacy.html` (2 chỗ "[email hỗ trợ]").

3. **Trang chính sách quyền riêng tư + mã nguồn GPL** — cần một địa chỉ web công khai.
   Cách gọn nhất: một kho GitHub công khai chứa mã nguồn (đáp ứng luôn yêu cầu công bố mã của GPL) và bật GitHub Pages
   cho `store/privacy.html`. Mình làm được nếu bạn đồng ý tạo kho công khai trên GitHub của bạn.

## Nộp lên store (mình chuẩn bị sẵn, bạn bấm gửi)

- Package: tải `dist/song-ngu-thuyet-minh-0.6.0.zip`.
- Store listing: chép từ `store/listing.md`; ảnh trong `store/assets/` (5 ảnh 1280×800 + ảnh nhỏ 440×280); danh mục Education.
- Privacy practices: chép từ `store/review-notes.md` (mục đích, giải trình quyền, dữ liệu, ghi chú cho người duyệt).
- Privacy policy URL: địa chỉ trang ở bước 3.
- Distribution: Public, mọi quốc gia (hoặc chỉ Việt Nam).
- Duyệt lần đầu thường 1–7 ngày; quyền truy cập mọi trang (<all_urls>) có thể bị duyệt kỹ hơn.

## Cập nhật bản mới
1. Sửa code trong `extension/`, chạy các bài test (README).
2. Tăng "version" trong `store/config.json`, chạy `python3 tools/build-store.py`.
3. Tải zip mới lên mục Package của tiện ích trên store.

## Ghi chú
- Lemon Squeezy là đơn vị bán hộ (merchant of record): họ thu thuế VAT/thuế bán hàng của khách nước ngoài và trả tiền về cho
  bạn. Phí 5% + 0,5 USD mỗi giao dịch. Thuế thu nhập phía Việt Nam là việc của bạn (mình không phải luật sư hay kế toán).
- Kiểm tra mã: tiện ích gọi thẳng License API của Lemon Squeezy, không cần máy chủ riêng. Mất mạng vẫn giữ Pro 7 ngày.
- Khách cần lấy lại mã / huỷ gia hạn: https://app.lemonsqueezy.com/my-orders (có nút trong trang Pro của tiện ích).
