# Discord Tool Reg & Token Suite

Bộ công cụ kiểm tra và đăng ký tài khoản tự động (Kèm Web Captcha Harvester & HTTP Proxy Bridge).

## 📁 Danh sách tệp tin
- `token_register.cjs`: Script chính xử lý đăng ký tài khoản + Captcha Harvester UI (port 7890).
- `http_bridge.py`: Script Python trung gian gửi request qua HTTP/HTTPS Proxy.
- `token_checker.cjs`: Script kiểm tra hàng loạt trạng thái của token Discord (Sống / Chết / Locked).
- `proxy.txt`: Danh sách Proxy định dạng `ip:port:user:pass` hoặc `ip:port`.
- `results/`: Thư mục chứa kết quả xuất ra (`accounts_success.txt`, `accounts.txt`, `tokens_new.txt`, logs).

## 🚀 Hướng dẫn sử dụng

### 1. Cài đặt thư viện cần thiết
```bash
npm install axios https-proxy-agent
```

### 2. Chạy Tool Reg
```bash
node token_register.cjs
```
- Khi Discord yêu cầu xác thực Captcha, mở trình duyệt truy cập: `http://localhost:7890` để giải captcha.
- Tham số bổ sung:
  - `node token_register.cjs -n 3` (Chạy tạo 3 acc)
  - `node token_register.cjs --proxy` (Dùng proxy từ `proxy.txt`)

### 3. Chạy Tool Check Token
```bash
node token_checker.cjs
```
- Kiểm tra danh sách token sống/chết.
