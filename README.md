# GiaoDich — Backend

Express + MongoDB API phục vụ hệ thống quản lý mã cước điện (V-GREEN / EVNCPC).

---

## Mục lục

1. [Yêu cầu hệ thống](#1-yêu-cầu-hệ-thống)
2. [Cấu trúc thư mục](#2-cấu-trúc-thư-mục)
3. [Biến môi trường (.env)](#3-biến-môi-trường-env)
4. [Chạy với Docker](#4-chạy-với-docker)
5. [Deploy production (Docker, bảo mật)](#5-deploy-production-docker-bảo-mật)
6. [Chạy ở chế độ dev (không Docker)](#6-chạy-ở-chế-độ-dev-không-docker)
7. [Import dữ liệu từ Excel](#7-import-dữ-liệu-từ-excel)
8. [Cấu trúc cơ sở dữ liệu (MongoDB)](#8-cấu-trúc-cơ-sở-dữ-liệu-mongodb)
9. [API Reference](#9-api-reference)
10. [Luồng nghiệp vụ chính](#10-luồng-nghiệp-vụ-chính)
11. [Restore dữ liệu từ dump](#11-restore-dữ-liệu-từ-dump)

---

## 1. Yêu cầu hệ thống

| Phần mềm | Phiên bản tối thiểu |
|----------|---------------------|
| Node.js  | 20+                 |
| Docker Desktop | bất kỳ       |
| MongoDB Compass (tuỳ chọn) | bất kỳ |

---

## 2. Cấu trúc thư mục

```
backend/
├── src/
│   ├── index.ts                  # Entry point — khởi tạo Express, mount router
│   ├── services/
│   │   ├── vouchers/router.ts    # /api/vouchers — danh sách & sửa profile mã
│   │   ├── electric-bills/router.ts  # /api/electric-bills — quản lý hóa đơn theo kỳ
│   │   ├── billing-scan/router.ts    # /api/billing-scan — kết quả quét cước
│   │   ├── agencies/router.ts    # /api/agencies — đại lý (sẽ tách service riêng)
│   │   └── customer-accounts/router.ts  # /api/customer-accounts
│   ├── models/
│   │   ├── ElectricBillRecord.ts # Hóa đơn điện theo tháng + kỳ thanh toán
│   │   ├── VoucherCode.ts        # Mã cước (code + status)
│   │   ├── AuditLog.ts           # Lịch sử thao tác
│   │   ├── Agency.ts             # Đại lý
│   │   ├── AssignedCode.ts       # Giao mã theo tháng (chống trùng)
│   │   ├── BillingScanHistory.ts # Lịch sử quét
│   │   └── CustomerAccount.ts    # Tài khoản khách hàng EVN
│   ├── lib/
│   │   ├── mongodb.ts            # Kết nối Mongoose (cached)
│   │   ├── electric-bill-serialize.ts  # DTO mapper ElectricBillRecord → JSON
│   │   ├── electric-bill-completion.ts # Kiểm tra đủ điều kiện hoàn tất kỳ
│   │   ├── electric-bill-mongo-periods.ts  # Chuyển DTO period → Mongo schema
│   │   ├── period-scan-merge.ts  # Điền số tiền quét vào kỳ 1→2→3
│   │   ├── scan-ddmm.ts          # Validate ngày thanh toán DD/MM
│   │   ├── agency-registry.ts    # Chuyển list đại lý → cây (tree)
│   │   ├── agency-repository.ts  # CRUD đại lý (MongoDB)
│   │   ├── openai-vision.ts      # OCR ảnh CCCD/hóa đơn qua OpenAI
│   │   ├── audit.ts              # Ghi AuditLog
│   │   └── format-vnd.ts         # Format số tiền VND
│   └── types/
│       ├── electric-bill.ts      # DTO types
│       └── voucher.ts            # VoucherRow type
├── scripts/
│   ├── import-billing-from-xlsx.ts   # ★ Import Excel → electricbillrecords
│   └── restore-mongo-seed-to-docker.ps1  # Restore mongodump vào Docker
├── mongo-seed/                   # Dữ liệu khởi tạo MongoDB lần đầu (init scripts)
├── docker-compose.yml            # Dev: Mongo publish cổng host (27018)
├── docker-compose.prod.yml       # Production: Mongo không publish cổng
├── .env.example                  # Mẫu biến (dev + gợi ý prod); copy → `.env`
└── package.json
```

---

## 3. Biến môi trường (.env)

Copy file mẫu rồi chỉnh:

```bash
cp .env.example .env
```

| Biến | Mô tả | Giá trị mặc định |
|------|-------|-----------------|
| `MONGODB_URI` | URI kết nối MongoDB | `mongodb://localhost:27018/giaodich_voucher` |
| `MONGO_HOST_PORT` | Cổng host publish Mongo (Docker) | `27018` |
| `PORT` | Cổng Express | `3001` |
| `CORS_ORIGIN` | Origin cho phép CORS | `http://localhost:1381` (tuỳ CRM/gateway) |
| `BILLING_XLSX_PATH` | Đường dẫn file Excel cước (tuỳ chọn) | — |

> **Lưu ý cổng:** Mongo trong Docker dùng cổng nội bộ `27017`; host dùng `27018` (mặc định) để tránh xung đột với Mongo cài máy. Frontend/dev kết nối qua `localhost:27018`.

---

## 4. Chạy với Docker

### Khởi động lần đầu

```bash
# Từ thư mục backend/
docker compose up -d --build
```

Lệnh này sẽ:
1. Build image backend từ `Dockerfile`
2. Kéo image `mongo:7`
3. Tạo volume `mongo_data` (dữ liệu bền vững)
4. Chạy backend tại `http://localhost:3001`
5. Chạy MongoDB tại `localhost:27018` (host) / `mongo:27017` (nội bộ compose)

### Kiểm tra trạng thái

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f mongo
```

### Dừng hệ thống

```bash
docker compose down          # giữ dữ liệu
docker compose down -v       # xóa cả volume (reset database)
```

### Kết nối MongoDB Compass

```
mongodb://localhost:27018
Database: giaodich_voucher
```

### Health check

```bash
curl http://localhost:3001/health
# → {"ok":true}
```

---

## 5. Deploy production (Docker, bảo mật)

**Tài liệu triển khai qua `scp` và chạy trên server:** [docs/DEPLOY-SCP-SERVER.md](docs/DEPLOY-SCP-SERVER.md).

Dùng file [`docker-compose.prod.yml`](docker-compose.prod.yml) thay cho `docker-compose.yml` khi lên **server thật** (build image tại chỗ).

**CI/CD (GitHub Actions + GHCR, không build trên server):** xem [docs/cicd-deploy.md](docs/cicd-deploy.md). Compose kéo image: [`docker-compose.deploy.yml`](docker-compose.deploy.yml).

| So sánh | `docker-compose.yml` (dev) | `docker-compose.prod.yml` (prod) |
|---------|---------------------------|-----------------------------------|
| Mongo publish cổng host | Có (`27018:27017`) — seed từ máy, Compass | **Không** — Mongo chỉ lắng nghe trong mạng Docker |
| `CORS_ORIGIN` | Mặc định theo `.env` | **Trên Internet:** set URL frontend thật (HTTPS) trong `.env` (compose có fallback localhost nếu quên) |
| API ra ngoài | `3001:3001` (đổi được `BACKEND_HOST_PORT`) | Mặc định **`1389:3001`** (tunnel); đổi `BACKEND_HOST_PORT` trong `.env` nếu cần |

### Khởi động trên server

```bash
cd backend
cp .env.example .env
# Sửa .env: CORS_ORIGIN=https://app.cua-ban.com, BACKEND_HOST_PORT=1389 (mặc định compose đã 1389 nếu không set)

docker compose -f docker-compose.prod.yml up -d --build
```

- Compose đọc biến substitute từ file **`.env`** cùng thư mục (không cần `--env-file` riêng).
- Backend nội bộ vẫn dùng `MONGODB_URI=mongodb://mongo:27017/giaodich_voucher` — **không cần** mở Mongo ra internet.
- Tunnel/reverse proxy trỏ HTTPS tới cổng host backend (mặc định **1389**), ví dụ `https://giaoma.nguyentrungnam.com` → `127.0.0.1:1389`.

### Seed lần đầu (bắt buộc — volume Mongo mới)

Thư mục `mongo-seed/` chỉ dùng cho script init Mongo khi volume **trống**; hiện không thay cho seed ứng dụng. Sau lần đầu stack chạy ổn định (Mongo healthy, `giaodich-backend` up), chạy **một lần**:

```bash
npm run docker:seed
# hoặc trên Linux:
# sh scripts/first-run-seed.sh
```

Lệnh này chạy trong container: `seed-vgreen-electric-bills` + `seed-voucher-codes`. Lặp lại khi tạo volume Mongo mới hoặc môi trường mới.

### Liên kết domain với fe-gateway

| Nơi cấu hình | Biến | Giá trị mẫu |
|--------------|------|-------------|
| **core-x-gateway** `.env` | `ELEC_SERVICE_URL` | `https://giaoma.nguyentrungnam.com` (HTTPS, **không** thêm `/api`) |
| **BE** `.env` | `CORS_ORIGIN` | URL CRM mà browser mở (một origin), ví dụ `https://crm.example.com` |
| **CRM build** | `VITE_GATEWAY_PUBLIC_URL` / `VITE_IAM_PUBLIC_URL` | URL public gateway / IAM (docker-compose `args` hoặc env build) |

Gateway proxy: `/api/billing-scan`, `/api/electric-bills`, `/api/vouchers`, `/api/agencies`, … → cùng path trên BE.

### Import Excel trên prod (Mongo không mở cổng host)

Script đã được copy vào image (`Dockerfile` có `COPY scripts`). Trên server:

```bash
# Copy file Excel vào container
docker cp ./maHĐ.xlsx giaodich-backend:/tmp/maHĐ.xlsx

# Chạy import (URI nội bộ giống backend)
docker compose -f docker-compose.prod.yml exec backend \
  sh -c 'MONGODB_URI=mongodb://mongo:27017/giaodich_voucher npx tsx scripts/import-billing-from-xlsx.ts /tmp/maHĐ.xlsx'
```

Hoặc dùng CI/CD chạy job one-off trên cùng Docker network với `MONGODB_URI=mongodb://mongo:27017/...`.

---

## 6. Chạy ở chế độ dev (không Docker)

> Cần MongoDB đang chạy (có thể chỉ chạy `docker compose up -d mongo`).

```bash
# Cài dependencies
npm install

# Chạy dev với hot-reload (tsx watch)
npm run dev
```

Server khởi động tại `http://localhost:3001`.

---

## 7. Import dữ liệu từ Excel

### 7.1 Import mã cước từ file Excel (dùng hàng ngày)

Đây là script chính để đưa dữ liệu từ Excel vào UI **trang Quét cước**.

**Cấu trúc file Excel:**

| Cột A | Cột B | Cột C | Cột D |
|-------|-------|-------|-------|
| Mã khách hàng | Số tiền (VND) | EVN | Hạn thanh toán (DD/MM) |
| `PC05II0947012` | `15.892.913` | `EVNCPC` | `06/04` |
| `PA05040062618` | `32,961,427` | `EVNHCMC` | `09/04` |

- Dòng đầu nếu là header sẽ tự động bị bỏ qua
- Số tiền chấp nhận định dạng: `15.892.913`, `15,892,913`, `15892913`
- Cột C (EVN) là tuỳ chọn — bỏ trống sẽ mặc định `EVNCPC`
- Cột D (hạn) là tuỳ chọn — bỏ trống không sao

**Chạy lệnh:**

```bash
# Từ thư mục backend/
npm run seed:billing -- ./maHĐ.xlsx

# Hoặc dùng biến môi trường
BILLING_XLSX_PATH=./maHĐ.xlsx npm run seed:billing
```

Sau khi chạy xong → F5 trang Quét cước trên UI sẽ thấy dữ liệu.

---

## 8. Cấu trúc cơ sở dữ liệu (MongoDB)

Database: **`giaodich_voucher`**

### Collection: `electricbillrecords`

Collection trung tâm — mỗi document là một hóa đơn cước của một khách hàng theo tháng.

```
{
  customerCode: "PC05II0947012",   // Mã khách hàng EVN (unique/tháng)
  year: 2026,
  month: 3,
  monthLabel: "T3/2026",
  company: "V-GREEN",
  evn: "EVNCPC",
  periods: [                        // 3 kỳ thanh toán trong tháng
    {
      ky: 1,                        // Kỳ 1, 2 hoặc 3
      amount: 15892913,             // Số tiền VND (null nếu chưa có cước)
      paymentDeadline: "...",       // Hạn thanh toán (ISO)
      scanDdMm: "06/04",           // Ngày thanh toán DD/MM (nhập tay)
      ca: "10h" | "16h" | "24h",  // Ca thanh toán
      assignedAgencyId: "...",      // ID đại lý được giao
      assignedAgencyName: "...",
      dlGiaoName: "...",            // Tên đại lý giao thực tế
      paymentConfirmed: false,      // Đã xác nhận thanh toán
      cccdConfirmed: false,         // Đã xác nhận CCCD
      customerName: "...",          // Tên chủ hộ
      cardType: "...",              // Loại thẻ
      dealCompletedAt: null         // Thời điểm hoàn tất kỳ (→ Đi mail)
    },
    { ky: 2, ... },
    { ky: 3, ... }
  ],
  assignedAgencyId: "...",          // Tổng: đại lý được giao (bill-level)
  dealCompletedAt: null             // Tổng: hoàn tất tất cả kỳ
}
```

**Index:** `{ customerCode, year, month }` unique — mỗi khách hàng chỉ có 1 bản ghi/tháng.

### Collection: `vouchercodes`

Theo dõi trạng thái xử lý từng mã cước.

```
{
  code: "PC05II0947012",   // Mã khách hàng (unique)
  status: 0 | 1 | 2 | 3 | 4
    // 0 = Chờ quét
    // 1 = Đã quét, có bill
    // 2 = Đã upload OCR, chờ duyệt
    // 3 = Đã duyệt
    // 4 = Hoàn thành (đã gửi mail)
  billingScanHasBill: true | false | null
}
```

### Collection: `agencies`

Danh sách đại lý (sẽ tách ra service riêng).

### Collection: `auditlogs`

Ghi lại mọi thao tác thay đổi dữ liệu (actor, action, entity, timestamp).

---

## 9. API Reference

Base URL: `http://localhost:3001`

### Vouchers — `/api/vouchers`

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/vouchers` | Danh sách mã cước. Query: `?status=0\|1\|2\|3\|4` |
| PATCH | `/api/vouchers/:id/profile` | Cập nhật thủ công thông tin khách hàng (customerProfile) |
| POST | `/api/vouchers/:id/ocr` | OCR ảnh CCCD/hóa đơn qua OpenAI Vision |
| POST | `/api/vouchers/:id/approve` | Duyệt mã (status → 3) |

### Electric Bills — `/api/electric-bills`

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/electric-bills/unassigned` | Hóa đơn chưa giao đại lý. Query: `?amountFilter=lt30\|lt70\|lt100\|lt300\|lte500\|gt500` |
| GET | `/api/electric-bills/invoice-list` | Toàn bộ hóa đơn còn kỳ chưa hoàn tất |
| GET | `/api/electric-bills/invoice-completed-months` | Các tháng đã có hóa đơn hoàn tất |
| GET | `/api/electric-bills/invoice-completed` | Hóa đơn hoàn tất theo tháng. Query: `?year=&month=` |
| GET | `/api/electric-bills/mail-queue` | Các kỳ đã hoàn tất (đủ điều kiện gửi mail/hoàn tiền) |
| GET | `/api/electric-bills/assigned-codes` | Tra cứu giao mã. Query: `?agencyId=&customerCode=` |
| POST | `/api/electric-bills/assign` | Giao hóa đơn cho đại lý. Body: `{ billId, agencyId, agencyName }` |
| PATCH | `/api/electric-bills/:id` | Cập nhật thông tin kỳ thanh toán (period data) |

### Billing Scan — `/api/billing-scan`

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/billing-scan/scanned-codes` | Danh sách mã V-GREEN có cước chưa hoàn tất (dùng cho trang Quét cước) |
| GET | `/api/billing-scan/history` | Lịch sử quét |

### Agencies — `/api/agencies`

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/agencies` | Danh sách đại lý |
| GET | `/api/agencies/options` | Danh sách đại lý (format tuỳ chọn dropdown) |
| GET | `/api/agencies/tree` | Cây đại lý |
| POST | `/api/agencies` | Tạo đại lý mới. Body: `{ name, code? }` |

### Health

```
GET /health → { "ok": true }
```

---

## 10. Luồng nghiệp vụ chính

### 10.1 Luồng từ Excel → UI Quét cước

```
File Excel (mã KH + số tiền + hạn)
          │
          ▼
  npm run seed:billing -- ./maHĐ.xlsx
          │
          ▼ upsert (customerCode + year + month)
  collection: electricbillrecords
          │
          ▼ GET /api/billing-scan/scanned-codes
          │   filter: company=V-GREEN, chưa dealCompletedAt
          ▼
  UI: Trang Quét cước
```

### 10.2 Luồng xử lý kỳ thanh toán

```
Quét cước            Giao đại lý          Nhập liệu kỳ           Hoàn tất
──────────────       ────────────────     ─────────────────────   ─────────────
seed:billing   →   POST /assign      →   PATCH /:id (periods)  →  dealCompletedAt
(amount,           (assignedAgencyId)    - scanDdMm (DD/MM)        ─────────────
 deadline)                               - ca (10h/16h/24h)        → mail-queue
                                         - customerName
                                         - paymentConfirmed ✓
                                         - cccdConfirmed ✓
```

### 10.3 Điều kiện hoàn tất một kỳ (`dealCompletedAt`)

Tất cả điều kiện sau phải đủ trước khi đánh dấu hoàn tất:

- [x] Có số tiền cước (`amount != null`)
- [x] Đã giao đại lý (`assignedAgencyId` hợp lệ)
- [x] Đã xác nhận thanh toán (`paymentConfirmed = true`)
- [x] Đã xác nhận CCCD (`cccdConfirmed = true`)
- [x] Có tên khách hàng (`customerName` không trống)
- [x] Có ngày thanh toán hợp lệ (`scanDdMm` định dạng DD/MM, không tương lai)
- [x] Có ca thanh toán (`ca` = `10h` | `16h` | `24h`)

Khi một kỳ hoàn tất → xuất hiện trong `GET /api/electric-bills/mail-queue` → trang Đi mail & Hoàn tiền.

### 10.4 Luồng VoucherCode (trạng thái mã)

```
Status 0 (Chờ quét)
     ↓ Import dữ liệu thực tế (Excel/API) vào MongoDB
Status 1 (Đã quét, có bill)
     ↓ Đại lý upload ảnh CCCD/hóa đơn + OCR
Status 2 (Chờ duyệt)
     ↓ Quản lý mã duyệt
Status 3 (Đã duyệt)
     ↓ Gửi mail thành công
Status 4 (Hoàn thành)
```

---

## 11. Restore dữ liệu từ dump

Nếu có bản dump MongoDB (`mongodump`), restore vào Docker:

```bash
# Bước 1: đặt dump vào đúng vị trí
# backend/mongo-seed/dump/giaodich_voucher/  ← thư mục chứa file .bson

# Bước 2: chạy script (PowerShell, từ thư mục backend/)
npm run docker:restore-mongo-seed

# Hoặc trực tiếp:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-mongo-seed-to-docker.ps1
```

**Archive gzip** (vd. `mongodump --archive --gzip`): container `giaodich-mongo` phải đang chạy.

```bash
npm run docker:restore-prod-gz
# hoặc file khác:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-mongo-archive-to-docker.ps1 -ArchivePath .\ten-file.gz
```

Script dùng `mongorestore --drop` — sẽ **ghi đè** collection hiện có.

---

## NPM Scripts nhanh

| Script | Mô tả |
|--------|-------|
| `npm run dev` | Chạy dev server với hot-reload |
| `npm run build` | TypeScript type-check |
| `npm run seed:billing -- ./file.xlsx` | **Import Excel cước → electricbillrecords** |
| `npm run docker:restore-mongo-seed` | Restore mongodump (thư mục) vào Docker Mongo |
| `npm run docker:restore-prod-gz` | Restore `assign_refu_prod.gz` (archive gzip) vào container |
| `npm run docker:prod:up` | Production: `docker compose -f docker-compose.prod.yml` (biến trong `.env`) |
| `npm run docker:prod:down` | Dừng stack production |
| `npm run docker:seed` | Trong container `giaodich-backend`: V-GREEN bills + voucher seed (sau lần đầu `up`) |
