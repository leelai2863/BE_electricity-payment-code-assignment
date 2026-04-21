# Nghiệp vụ tổng thể dự án FUJISys (phần đang dùng)

Tài liệu này mô tả các nghiệp vụ đang chạy theo code hiện tại của backend `FUJISys/backend`, tập trung vào các route đang được mount trong `backend/src/index.ts`.

Không mô tả các endpoint đã đánh dấu deprecated/410 hoặc các flow không còn dùng.

## 1) Phạm vi hệ thống đang chạy

Backend hiện public các nhóm API sau:

- `/api/agencies`
- `/api/billing-scan`
- `/api/checkbill`
- `/api/electric-bills`
- `/api/vouchers`
- `/api/customer-accounts`

Mục tiêu nghiệp vụ chính:

- Quản lý mã điện và đại lý.
- Quản lý hóa đơn điện theo kỳ, giao mã, theo dõi hoàn tất.
- Quản lý hoàn tiền theo dòng đã hoàn tất giao dịch.
- Nhận snapshot cước từ tool-check-bill, đưa vào staging, duyệt để đẩy vào dữ liệu hóa đơn điện.
- Quản lý voucher theo luồng OCR -> cập nhật hồ sơ -> duyệt.
- Quản lý danh mục tài khoản khách hàng để phục vụ tra cứu/import.

## 2) Nghiệp vụ theo module

## 2.1 Đại lý (`/api/agencies`)

Nghiệp vụ:

- Quản lý danh mục đại lý.
- Trả danh sách dạng phẳng và dạng cây.
- Tạo/sửa/xóa đại lý.

API đang dùng:

- `GET /api/agencies`
- `GET /api/agencies/options`
- `GET /api/agencies/tree`
- `POST /api/agencies`
- `PATCH /api/agencies/:id`
- `DELETE /api/agencies/:id`

## 2.2 Tài khoản khách hàng (`/api/customer-accounts`)

Nghiệp vụ:

- Quản lý danh sách tài khoản khách hàng (liệt kê, import, cập nhật, xóa).
- Hỗ trợ tìm kiếm và phân trang.

API đang dùng:

- `GET /api/customer-accounts`
- `POST /api/customer-accounts/import`
- `PATCH /api/customer-accounts/:id`
- `DELETE /api/customer-accounts/:id`

## 2.3 Voucher (`/api/vouchers`)

Nghiệp vụ:

- Lấy danh sách voucher theo trạng thái.
- OCR chứng từ voucher.
- Cập nhật hồ sơ khách hàng của voucher.
- Duyệt voucher.

API đang dùng:

- `GET /api/vouchers`
- `POST /api/vouchers/:id/ocr`
- `PATCH /api/vouchers/:id/profile`
- `POST /api/vouchers/:id/approve`

## 2.4 Hóa đơn điện và giao mã (`/api/electric-bills`)

Nghiệp vụ:

- Danh sách hóa đơn chưa giao mã và đã giao mã.
- Danh sách hóa đơn phục vụ theo dõi hoàn tất theo tháng.
- Giao mã cho đại lý và cập nhật từng hóa đơn.
- Tập dữ liệu mail-queue cho màn đi mail/hoàn tiền.

API đang dùng:

- `GET /api/electric-bills/unassigned`
- `GET /api/electric-bills/invoice-list`
- `GET /api/electric-bills/invoice-completed-months`
- `GET /api/electric-bills/invoice-completed`
- `GET /api/electric-bills/mail-queue`
- `GET /api/electric-bills/assigned-codes`
- `POST /api/electric-bills/assign`
- `PATCH /api/electric-bills/:id`

## 2.5 Hoàn tiền (thuộc `electric-bills`)

Nghiệp vụ:

- Khai báo quy tắc phí hoàn tiền theo `agency + status + effectiveFrom`.
- Cập nhật trạng thái hoàn tiền theo từng dòng (kỳ) của hóa đơn.
- Hỗ trợ migrate dữ liệu local storage cũ lên DB.

API đang dùng:

- `POST /api/electric-bills/refund-fee-rules`
- `PATCH /api/electric-bills/refund-line-states`
- `POST /api/electric-bills/refund-migrate-localstorage`

## 2.6 Nhận dữ liệu checkbill và staging quét cước

### A. Ingest từ tool-check-bill (`/api/checkbill/charges-snapshot`)

Nghiệp vụ:

- Nhận payload `checkbill.charges_snapshot`.
- Xác thực secret qua `Authorization Bearer` hoặc `X-Api-Key`.
- Parse danh sách dòng cước từ `charges_snapshot.items` (có fallback dữ liệu cũ).
- Nếu payload bị truncate, fetch full JSON theo URL trong payload.
- Lọc trùng trong cùng batch theo khóa `ma_kh + so_tien_vnd`.
- Ghi batch ingest (audit) và ghi danh sách unique vào bảng staging.
- Trả ACK 2xx khi dữ liệu đã được ghi nhận.

API đang dùng:

- `POST /api/checkbill/charges-snapshot`

### B. Quét cước từ staging (`/api/billing-scan`)

Nghiệp vụ:

- Đọc danh sách dòng staging để hiển thị bảng Quét cước.
- Duyệt từng dòng staging:
  - Upsert vào dữ liệu hóa đơn điện.
  - Ghi lịch sử quét.
  - Xóa dòng khỏi staging sau khi duyệt thành công.

API đang dùng:

- `GET /api/billing-scan/scanned-codes`
- `POST /api/billing-scan/scanned-codes/:id/approve`
- `GET /api/billing-scan/history`

## 3) Luồng nghiệp vụ chính end-to-end

## 3.1 Luồng checkbill -> staging -> duyệt -> giao mã

1. Tool-check-bill gửi `POST /api/checkbill/charges-snapshot`.
2. Backend xác thực, dedupe theo `ma_kh + so_tien_vnd`, lưu staging unique.
3. UI Quét cước gọi `GET /api/billing-scan/scanned-codes` để hiển thị.
4. Người dùng bấm Duyệt từng dòng.
5. Backend xử lý `POST /api/billing-scan/scanned-codes/:id/approve`:
   - Đẩy vào dữ liệu hóa đơn điện.
   - Xóa dòng staging.
6. Dòng đã duyệt sẽ đi vào các màn giao mã/hóa đơn điện theo luồng hiện tại.

## 3.2 Luồng vận hành hóa đơn điện và hoàn tiền

1. Người dùng giao mã qua `POST /api/electric-bills/assign` hoặc cập nhật chi tiết qua `PATCH /api/electric-bills/:id`.
2. Dữ liệu hoàn tất được đọc qua các API invoice-completed/mail-queue.
3. Màn hoàn tiền dùng:
   - `POST /refund-fee-rules` để quản lý phí theo thời gian hiệu lực.
   - `PATCH /refund-line-states` để lưu trạng thái hoàn từng dòng.

## 4) RBAC tổng quan (qua Gateway)

Theo `core-x-gateway`:

- Nhóm `electric-bills`, `billing-scan`, `vouchers`, `agencies` thuộc capability `evn:view`.
- `mail-queue` và các route hoàn tiền có rule riêng (`refund:view`, `sentmail:view`) theo method.
- Nhóm `checkbill` dùng capability `checkbill:view` cho phần tra cứu; một số route quản trị lịch yêu cầu capability quản trị cao hơn.

## 5) Ghi chú vận hành

- Ingest secret bắt buộc: `CHECKBILL_INGEST_SECRET`.
- Cỡ payload ingest đọc từ biến max-items trong backend (theo config hiện tại).
- Với payload truncated, backend cần outbound network để fetch full JSON từ URL tool-check-bill cung cấp.

