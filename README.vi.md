# Antigravity with Gemini (`g2a`)

**[English](README.md)** | **Tiếng Việt**

> **Gemini phụ trách suy nghĩ & lập kế hoạch. Antigravity phụ trách thực thi mã nguồn.**

Lấy cảm hứng từ dự án [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt), **G2A** kết hợp sức mạnh suy luận sâu (Deep Thinking tokens) và cửa sổ ngữ cảnh khổng lồ (2M tokens) của **Google Gemini** với năng lực thao tác code, terminal và kiểm thử vượt trội của **Antigravity**.

---

## 💡 Điểm Nổi Bật

1. **Cầu nối MCP Chỉ Đọc (Read-Only)**: Cung cấp 9 công cụ MCP an toàn giúp Gemini tự kiểm tra cấu trúc code, đọc từng dòng cần thiết và xem git diff mà **không cần tải lên toàn bộ mã nguồn**.
2. **Tích hợp Thinking trực tiếp vào Antigravity**: Trang bị các MCP tool (`gemini_plan`, `gemini_review`, `gemini_think`) để Antigravity chủ động xin kế hoạch hoặc review code từ Gemini Thinking.
3. **An toàn bảo mật tối đa**:
   - Máy chủ MCP tuyệt đối không có công cụ ghi, xóa hay chạy lệnh nguy hiểm.
   - Giải pháp `realpath` ngăn chặn triệt để tấn công vượt thư mục (`../`) và liên kết tượng trưng (symlink escape).
   - Tự động chặn các file bí mật: `.env*`, SSH private key, token credentials.
   - Xác thực OAuth 2.1 PKCE kết hợp mã ghép đôi CSPRNG 6 số dùng 1 lần (hạn 5 phút, khóa sau 5 lần sai).
4. **Tích hợp sẵn Antigravity Skill**: Cài đặt một chạm vào hệ thống skill của Antigravity để điều phối chu trình `[G2A]` tự động.

---

## ⚡ Hướng Dẫn Cài Đặt Nhanh

### 1. Clone và Build

```bash
# Clone repository
git clone https://github.com/pnbaominh/antigravity-with-gemini.git
cd antigravity-with-gemini

# Cài đặt dependencies và biên dịch TypeScript
npm install
npm run build
```

### 2. Thiết lập ban đầu

```bash
# Khởi tạo workspace, cài đặt Antigravity skill và kiểm tra hệ thống
node ./bin/g2a.js setup

# Khởi động bridge chạy ngầm (daemon)
node ./bin/g2a.js start

# Xem trạng thái hoạt động
node ./bin/g2a.js status
```

---

## 🛠️ Bảng Lệnh CLI `g2a`

| Lệnh | Ý nghĩa |
|---|---|
| `g2a setup` | Cài đặt skill, chạy chẩn đoán và tạo mã pairing ban đầu |
| `g2a start` | Khởi động bridge ngầm (thêm `-f` để chạy trực tiếp) |
| `g2a stop` | Dừng bridge đang chạy |
| `g2a status` | Xem trạng thái PID, cổng mạng, URL SSE và tunnel |
| `g2a doctor` | Kiểm tra môi trường (Node >= 20, Git, Cloudflared) |
| `g2a pair` | Tạo mã pairing 6 chữ số mới |
| `g2a plan "<task>"` | Nhờ Gemini Thinking lập kế hoạch phân đoạn chi tiết |
| `g2a review` | Nhờ Gemini review độc lập git diff và kết quả test |
| `g2a tunnel` | Bật Cloudflare Quick Tunnel để kết nối từ xa |
| `g2a mcp` | Chạy máy chủ G2A MCP qua Stdio kết nối trực tiếp Antigravity harness |

---

## 🧪 Kiểm Thử (Tests)

Chạy bộ test tự động với Vitest:

```bash
npm test
```

Bao gồm các bài test:
- Chống tấn công path traversal (`../`) và symlink escape.
- Chặn đọc các file nhạy cảm (`.env`, `id_rsa`).
- Sinh mã pairing ngẫu nhiên, giới hạn số lần thử và tự hủy sau khi hết hạn.
- Xác thực chuẩn OAuth 2.1 PKCE.
- Đăng ký đầy đủ 9 công cụ MCP an toàn.

---

## 📄 Bản Quyền

Phát hành theo giấy phép MIT. Xem file [LICENSE](LICENSE) để biết thêm chi tiết.
