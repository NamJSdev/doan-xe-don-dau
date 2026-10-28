# 💒 Ứng Dụng Định Vị & Bám Đoàn Xe Đón Dâu (Android & iPhone PWA)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NamJSdev/doan-xe-don-dau)

Giải pháp định vị trực tiếp thời gian thực cho đoàn xe ngày cưới, giúp các xe bám sát **Xe Hoa / Xe Dẫn Đoàn** mà không sợ lạc đường hay rẽ nhầm ngõ.

## ✨ Các tính năng chính
1. **Phân vai trò xe rõ ràng**:
   - 💐 **Xe Hoa / Xe Dẫn Đoàn** (Hiệu ứng radar nổi bật, nút 1 chạm `💐 Bám Xe Hoa` ở thanh trên cùng).
   - 🚗 **Xe Trong Đoàn** (Hiển thị tên xe, biển số, tốc độ trực tiếp trên nóc xe).
   - 📸 **Xe Quay Chụp / Hậu Cần**.
2. **Chế độ Bám Xe (Follow Mode) kép**:
   - **Vệt đường thực tế xe trước đã đi (Breadcrumb Trail)**: Tự động lọc nhiễu GPS và vẽ lại chính xác lộ trình + mũi tên hướng đi mà xe đang chọn vừa chạy qua.
   - **Chỉ đường đuổi kịp (Live Routing OSRM)**: Vẽ đường dẫn từ vị trí xe của bạn đến vị trí hiện tại của xe đang bám, kèm khoảng cách và thời gian dự kiến.
   - **3 chế độ khoá Camera**: `🎯 Khóa xe trước`, `🔄 Cả 2 xe` (tự động căn khung hình vừa cả xe mình và xe trước), hoặc `🖐️ Tự do`.
3. **Điểm Hẹn Đám Cưới cố định**:
   - Đánh dấu **🏠 Nhà Trai**, **👰 Nhà Gái**, **🥂 Nhà Hàng**, **📍 Điểm Tập Kết** để cả đoàn cùng thấy và bấm chỉ đường bất cứ lúc nào.
4. **Tin nhắn báo hiệu 1 chạm cho tài xế**:
   - `🚦 Đèn đỏ`, `↪️ Chú ý rẽ`, `🐢 Đợi tôi với`, `✅ Bám sát`, `⚠️ Đông xe` — hiện bong bóng thông báo ngay trên bản đồ kèm âm báo.
5. **Chế độ Chạy Thử Mô Phỏng (`🎮 Chạy thử`)**:
   - Tạo sẵn Xe Hoa & Xe Số 2 chạy tự động trên đường phố thực tế để bạn kiểm thử toàn bộ tính năng trước ngày cưới.

---

## 🚀 Cách chạy và sử dụng

### 1. Chạy thử trên máy tính
```bash
npm start
```
Mở trình duyệt tại: **http://localhost:3000**

### 2. Lưu ý quan trọng khi mở trên Điện Thoại (iPhone Safari & Android Chrome)
Trình duyệt trên điện thoại (iOS/Android) bắt buộc kết nối **HTTPS** mới cho phép bật định vị GPS (trừ `localhost`). Để dùng trên điện thoại bằng 4G/5G trong ngày đón dâu, bạn có 2 cách cực nhanh (miễn phí):

- **Cách 1 (Test nhanh ngay lập tức từ máy tính)**:
  Mở thêm 1 cửa sổ Terminal và chạy:
  ```bash
  npx localtunnel --port 3000
  ```
  hoặc dùng Cloudflare Tunnel / ngrok để lấy đường link `https://...` gửi vào nhóm Zalo đoàn xe.

- **Cách 2 (Deploy cố định miễn phí lên Render.com / Railway.app cho ngày cưới)**:
  Đẩy thư mục code này lên GitHub và kết nối với [Render.com](https://render.com) (đã có sẵn file cấu hình `render.yaml`). Bạn sẽ có một đường link `https://doan-xe-don-dau.onrender.com` hoạt động 24/24 cho cả đoàn quét mã QR!
