# Triển khai BE điện (GiaoDich): từ máy dev → `scp` → chạy trên server

Tài liệu mô tả luồng **build image trên máy dev**, **đẩy qua `scp`**, rồi **khởi chạy Docker trên server** (không cần `docker build` trên server). Mongo dùng image `mongo:7` từ registry khi `compose up` lần đầu.

---

## 1. Điều kiện

**Máy dev (Windows hoặc Linux)**

- Docker Desktop / Docker Engine.
- Repo `BE_electricity-payment-code-assignment`.

**Máy chủ**

- Docker + plugin **Docker Compose v2** (lệnh `docker compose`). Nếu chỉ có bản cũ, thử `docker-compose`.
- Cổng SSH mở (ví dụ custom port **1300**).
- Thư mục đích có quyền ghi (ví dụ `/home/nam/giaoma`).
- Internet lần đầu để kéo image **`mongo:7`** (trừ khi bạn đã `docker pull` / mirror sẵn).

---

## 2. Trên máy dev: build image và tạo file đẩy lên server

Mở terminal tại thư mục gốc repo `BE_electricity-payment-code-assignment`.

### 2.1 Build image production

```powershell
docker compose -f docker-compose.prod.yml build --no-cache
```

### 2.2 Xuất image ra file `.tar`

Tạo thư mục `deploy` nếu chưa có:

```powershell
New-Item -ItemType Directory -Force -Path deploy
```

```powershell
docker save be_electricity-payment-code-assignment-backend -o deploy/be-electric-backend.docker.tar
```

File này thường **vài trăm MB**. Tuỳ chọn nén trước khi `scp` (trên máy có `gzip`, ví dụ Git Bash):

```bash
gzip -k deploy/be-electric-backend.docker.tar
```

Sau đó đẩy file `be-electric-backend.docker.tar.gz` và trên server dùng `gunzip` trước `docker load`, hoặc:

```bash
docker load < be-electric-backend.docker.tar.gz
```

(tuỳ phiên bản Docker có hỗ trợ load từ gzip hay không — an toàn nhất là giải nén về `.tar` rồi `docker load -i`.)

### 2.3 Đóng gói compose + script + `.env.example` (zip)

Trên **PowerShell**, từ thư mục gốc repo:

```powershell
Compress-Archive -LiteralPath "docker-compose.prod.yml", ".env.example", "scripts", "docs\DEPLOY-SCP-SERVER.md" -DestinationPath "deploy\compose-and-scripts.zip" -Force
```

Nội dung zip gồm: `docker-compose.prod.yml`, `.env.example`, cả thư mục `scripts/` (có `first-run-seed.sh` và các script seed), và bản tài liệu này.

---

## 3. Đẩy file lên server bằng `scp`

Thay `nam@baonamdtsc.com`, cổng **1300**, và đường dẫn đích cho đúng môi trường của bạn.

**Lưu ý:** `scp` dùng **`-P` (chữ P hoa)** để chỉ định cổng SSH.

```powershell
scp -P 1300 "deploy\be-electric-backend.docker.tar" nam@baonamdtsc.com:/home/nam/giaoma/

scp -P 1300 "deploy\compose-and-scripts.zip" nam@baonamdtsc.com:/home/nam/giaoma/
```

Nếu thư mục đích chưa tồn tại, SSH một lần để tạo:

```powershell
ssh -p 1300 nam@baonamdtsc.com "mkdir -p /home/nam/giaoma"
```

(`ssh` dùng **`-p` thường** cho cổng.)

---

## 4. Trên server: từ giải nén tới chạy stack

SSH vào server:

```bash
ssh -p 1300 nam@baonamdtsc.com
```

### 4.1 Vào thư mục triển khai

```bash
cd /home/nam/giaoma
```

### 4.2 Giải nén zip

```bash
unzip -o compose-and-scripts.zip
```

Sau bước này, cùng cấp với `docker-compose.prod.yml` và `.env.example` (và thư mục `scripts/`). File image `.tar` đã nằm sẵn trong thư mục này từ bước `scp`.

### 4.3 Nạp image backend vào Docker

```bash
docker load -i be-electric-backend.docker.tar
```

Kiểm tra image (tuỳ chọn):

```bash
docker images | grep be_electricity-payment-code-assignment-backend
```

Tên image phải khớp **`be_electricity-payment-code-assignment-backend`** như trong `docker-compose.prod.yml`.

### 4.4 Tạo file `.env` từ mẫu

```bash
cp .env.example .env
nano .env
```

Chỉnh tối thiểu:

- **`CORS_ORIGIN`**: một origin HTTPS mà **trình duyệt** dùng khi mở CRM (URL public của gateway/CRM), ví dụ `https://crm.example.com`.
- **`OPENAI_API_KEY`** (và model nếu cần) nếu dùng OCR.
- **`BACKEND_HOST_PORT`**: mặc định compose là **1389** nếu không set; đổi nếu tunnel trỏ cổng khác.

Compose đọc **`.env`** cùng thư mục để thay biến trong `docker-compose.prod.yml`.

### 4.5 Khởi động stack (không `--build`)

Image backend đã có sẵn sau `docker load`; **không** cần build lại trên server:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Lần đầu, Docker sẽ kéo **`mongo:7`** nếu chưa có.

Nếu hệ thống chỉ có lệnh cũ:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 4.6 Seed dữ liệu lần đầu (bắt buộc với volume Mongo mới)

Sau khi `giaodich-backend` và Mongo đã chạy ổn:

```bash
sh scripts/first-run-seed.sh
```

Hoặc tương đương (nếu có `npm` trên host và container đúng tên):

```bash
npm run docker:seed
```

Chỉ cần chạy **một lần** cho môi trường/volume mới (hoặc lặp lại sau khi xoá volume Mongo và dựng lại).

---

## 5. Kiểm tra

```bash
docker compose -f docker-compose.prod.yml ps
curl -sS http://127.0.0.1:1389/health
```

Kỳ vọng `health` trả JSON dạng `{ "ok": true }` (hoặc tương đương). Nếu đổi `BACKEND_HOST_PORT` trong `.env`, thay **1389** bằng cổng đó.

**Tunnel / domain:** trỏ HTTPS (ví dụ `https://giaoma.nguyentrungnam.com`) về **`127.0.0.1:<BACKEND_HOST_PORT>`** trên server.

**fe-gateway (deploy riêng):** trong `core-x-gateway/.env` đặt:

```env
ELEC_SERVICE_URL=https://giaoma.nguyentrungnam.com
```

(không thêm path `/api`; gateway proxy giữ nguyên prefix `/api/electric-bills`, …)

---

## 6. Cập nhật bản mới (chỉ backend)

Trên **máy dev**: build + save + zip lại như mục 2, rồi `scp` đè file cũ.

Trên **server**:

```bash
cd /home/nam/giaoma
docker compose -f docker-compose.prod.yml down
docker load -i be-electric-backend.docker.tar
docker compose -f docker-compose.prod.yml up -d
```

Nếu có thay đổi `docker-compose.prod.yml` hoặc `.env.example`, giải nén lại zip (hoặc copy tay file mới). **Seed lần đầu** không cần chạy lại trừ khi bạn reset volume Mongo.

---

## 7. Gỡ lỗi ngắn

| Hiện tượng | Hướng xử lý |
|------------|-------------|
| `docker compose`: command not found | Cài Docker Compose plugin hoặc dùng `docker-compose`. |
| `docker load`: không đúng image name | Đảm bảo file tar build từ cùng repo có `image: be_electricity-payment-code-assignment-backend` trong compose. |
| Backend restart loop | Xem log: `docker compose -f docker-compose.prod.yml logs -f backend`. |
| CRM gọi API lỗi CORS | Kiểm tra `CORS_ORIGIN` trong `.env` BE khớp origin thật của CRM. |
| Gateway 404 ELEC | Kiểm tra `ELEC_SERVICE_URL` trên gateway và tunnel tới BE. |

---

## 8. File trong repo liên quan

| File | Vai trò |
|------|--------|
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | Stack prod: backend + Mongo, publish backend ra host (mặc định 1389). |
| [`.env.example`](../.env.example) | Mẫu biến môi trường; copy → `.env` trên server. |
| [`scripts/first-run-seed.sh`](../scripts/first-run-seed.sh) | Seed V-GREEN + voucher trong container. |
| [`package.json`](../package.json) | Script `docker:seed`, `docker:prod:up`, … |

Các file `deploy/be-electric-backend.docker.tar` và `deploy/compose-and-scripts.zip` thường **không commit** (đã liệt kê trong `.gitignore`).
