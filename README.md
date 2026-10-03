# Discord Tool Reg & Token Suite

Bộ công cụ kiểm tra và đăng ký tài khoản tự động (Kèm Web Captcha Harvester & HTTP Proxy Bridge).

## 📁 Danh sách tệp tin
- `token_register.cjs`: Script chính xử lý đăng ký tài khoản + Captcha Harvester UI (port 7890) + Tự động Verify Email + Auto Live Warmup.
- `token_warmer.cjs`: Script bảo dưỡng và nuôi dưỡng dàn token Discord (Keep-Alive WebSocket Gateway, HypeSquad, Natural Presence) giúp token sống lâu 1 tháng - 1 năm.
- `token_checker.cjs`: Script kiểm tra hàng loạt trạng thái của token Discord (Sống / Chết / Locked).
- `http_bridge.py`: Script Python trung gian gửi request qua HTTP/HTTPS Proxy (LWPCookieJar session & redirect tracking).
- `proxy.txt`: Danh sách Proxy định dạng `ip:port:user:pass` hoặc `ip:port`.
- `results/`: Thư mục chứa kết quả xuất ra (`accounts_success.txt`, `accounts.txt`, `tokens_new.txt`, `tokens_live.txt`).

## 🚀 Hướng dẫn sử dụng

### 1. Cài đặt thư viện cần thiết
```bash
npm install axios https-proxy-agent ws
```

### 2. Chạy Tool Reg (Kèm Tự Động Verify Email & Live Warmup)
```bash
node token_register.cjs
```
- Khi Discord yêu cầu xác thực Captcha, mở trình duyệt truy cập: `http://localhost:7890` để giải captcha.
- Tự động trích xuất token xác thực từ SendGrid `click.discord.com` và hoàn tất verify email chính thức.
- Tự động kích hoạt cơ chế Live Warmup:
  - Tham gia HypeSquad House (tăng điểm Trust Score).
  - Cấu hình client settings (dark theme, locale) và cập nhật bio/pronouns ngẫu nhiên.
  - Kết nối Discord Gateway WebSocket v9, gửi Opcode 2 `IDENTIFY` và duy trì Heartbeat như web client thật.
- Các tùy chọn nâng cao:
  - `node token_register.cjs -n 3` (Chạy tạo 3 acc liên tiếp)
  - `node token_register.cjs --proxy` (Dùng proxy xoay vòng từ `proxy.txt`)
  - `node token_register.cjs --skip-warmup` (Bỏ qua bước warmup nếu cần tốc độ nhanh)

### 3. Chạy Tool Nuôi Dưỡng Token Sống Lâu (Token Warmer & Life-Keeper)
```bash
node token_warmer.cjs
```
- Đọc danh sách token từ `results/tokens_new.txt` (hoặc `-f file.txt`).
- Tự động kiểm tra trạng thái token (Live / Phone Locked / Dead).
- Với token Live:
  - Tự động online WebSocket Gateway 15-20s kèm Opcode 1 Heartbeat.
  - Set trạng thái hoạt động tự nhiên (Playing Minecraft, GTA V, VS Code, Spotify...).
  - Cập nhật huy hiệu HypeSquad House nếu thiếu.
  - Phân loại và xuất danh sách sạch: `results/tokens_live.txt`.
- Tùy chọn:
  - `node token_warmer.cjs --duration 20` (Giữ online 20s mỗi token)
  - `node token_warmer.cjs --proxy` (Nuôi qua proxy)

### 4. Chạy Tool Check Token
```bash
node token_checker.cjs
```
- Kiểm tra danh sách token sống/chết.
