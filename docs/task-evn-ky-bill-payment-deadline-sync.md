# Task: Kỳ hóa đơn EVN (kyBill) và đồng bộ hạn thanh toán (AutoCheckEvn)

Tài liệu mô tả phạm vi đã triển khai, biến môi trường, API và **lưu ý vận hành / deploy**. Không chứa secret; giá trị thật chỉ cấu hình trên server (vault, `.env` ngoài Git).

## Mục tiêu

- Trang **chưa giao mã** (cước mới theo kỳ): đồng bộ **hạn thanh toán** từ **AutoCheckEvn** đúng **chu kỳ hóa đơn EVN** (`ky`, `thang`, `nam`), tránh lệch với tháng/năm “refu” (ví dụ tháng duyệt quét UTC).
- **Neo kỳ EVN** trên `ElectricBillRecord`: `evnKyBillThang`, `evnKyBillNam` — **chỉ dùng khi đủ cặp** hợp lệ (1–12 và 2000–2100). Nếu không neo, hệ thống dùng `month` / `year` của bản ghi refu.

## Kiến trúc ngắn gọn

| Thành phần | Vai trò |
|------------|---------|
| **Assign-refu-manager-service** | Mongo `ElectricBillRecord`, ingest checkbill, staging, worker đồng bộ hạn TT, gọi AutoCheck (`GET payment-due`; `POST /api/tasks` CPC batch **chỉ** khi bật env và 404). |
| **AutoCheckEvn** | DB thông báo đã parse; lọc theo `maKH`, `region`, `ky`, `thang`, `nam`. Trả envelope có `kyBill`, `hanThanhToan`. |
| **tool-check-bill** | Batch → Excel “Có cước” (cột kỳ EVN tùy chọn), JSON snapshot → gateway/ingest. |
| **core-x-gateway** | Proxy `ELEC_SERVICE_URL` tới elec-service; RBAC `evn:view` cho prefix billing-scan / electric-bills. |
| **core-x-crm-frontend** | Trang giao mã, quét staging, nhập tay HĐ (ADMIN: block kỳ EVN). |

## Dữ liệu MongoDB

- **`ElectricBillRecord`**: thêm tùy chọn `evnKyBillThang`, `evnKyBillNam`. Không bắt buộc migration (field optional).
- **`ChargesStagingRow`**: lưu cặp kỳ EVN khi payload ingest có `evn_ky_bill_thang` / `evn_ky_bill_nam` (hoặc camelCase) **và** hợp lệ.
- **Period** (theo kỳ 1–3): các field đồng bộ hạn TT (`evnPaymentDeadlineSyncStatus`, `paymentDeadline`, …) như thiết kế worker.

## Luồng ingest → duyệt → bill

1. **Ingest** (`POST /api/checkbill/...`) map từng dòng; chỉ gắn cặp kỳ EVN khi **đủ** tháng + năm hợp lệ.
2. **Staging** hiển thị cột “Kỳ EVN” (CRM) nếu có cặp.
3. **Duyệt** staging → `upsertBillFromChargeItem`: ghi neo vào bill khi có cặp; update bill không xóa neo nếu payload không gửi cặp (giữ chỉnh tay trước đó).

## API liên quan (elec-service)

- `POST /api/electric-bills/unassigned/payment-deadline-sync` — xếp hàng đồng bộ hạn TT (body: `billIds?`, `force?`, `requestedBy?`). Cần quyền tương ứng theo controller/RBAC.
- `PATCH /api/electric-bills/:id` — ADMIN có thể set/xóa neo `evnKyBillThang` / `evnKyBillNam` (**bắt buộc gửi cả hai** field cùng lúc: số hợp lệ hoặc cả hai `null` để xóa).
- `POST /api/electric-bills/manual` — nhập tay; ADMIN có thể gửi cặp kỳ EVN cùng lúc.

Chi tiết handler nằm trong `electric-bills.controller.ts` / `electric-bills.router.ts`.

## Giới hạn tần suất (tránh spam AutoCheck / captcha)

- **Theo job (`billId` + kỳ)**: giữa hai lần **xếp hàng** cùng job, phải cách một khoảng tối thiểu (mặc định **30s** khi `force: false`, **12s** khi `force: true`). Nếu gọi quá sớm, job không vào hàng đợi — response có `cooldown` (số lần bị từ chối theo kỳ).
- **POST không truyền `billIds`** (đồng bộ toàn bộ chờ giao trên server): tối thiểu **120s** giữa hai lần (mặc định); nếu quá sớm trả **HTTP 429** và message tiếng Việt. Truyền `billIds` cụ thể không áp dụng hạn chế này.
- **CRM**: tự động xếp hàng khi có bill **thiếu hạn hoặc hạn đã quá (VN)** trên `rows` (không phụ thuộc filter); cùng tập `billId` không gửi lại trong **45s**. Nút **“Lấy lại hạn TT (EVN)”**: tối thiểu **12s** giữa hai lần bấm (phía client).

## Biến môi trường (Assign-refu-manager-service)

Chỉ tên biến — giá trị đặt trên server, **không** commit file `.env`.

| Biến | Mô tả |
|------|--------|
| `MONGODB_URI` | Kết nối MongoDB (bắt buộc runtime). |
| `AUTOCHECK_EVN_URL` | Base URL AutoCheckEvn (bỏ dư `/` cuối). |
| `AUTOCHECK_EVN_API_KEY` | Header `x-api-key` nếu AutoCheck yêu cầu. |
| `AUTOCHECK_EVN_HTTP_TIMEOUT_MS` | Timeout HTTP (mặc định 28000). |
| `AUTOCHECK_EVN_TASK_POLL_MS` / `AUTOCHECK_EVN_TASK_POLL_MAX_MS` | Poll task CPC sau `POST /api/tasks`. |
| `PAYMENT_DEADLINE_CPC_SCRAPE_ON_404` | Chỉ khi giá trị **`true`**: sau 404 toàn vùng, gọi `POST /api/tasks` quét CPC theo kỳ/tháng (AutoCheck xử lý **hàng loạt mã**, không phải một bill). **Mặc định tắt** — tránh một job làm quét cả danh sách. |
| `PAYMENT_DEADLINE_SYNC_TICK_MS` | Chu kỳ worker queue (mặc định 700). |
| `PAYMENT_DEADLINE_MIN_ENQUEUE_INTERVAL_MS` | Khoảng cách tối thiểu giữa hai lần xếp hàng cùng bill+kỳ khi **không** `force` (mặc định 30000). |
| `PAYMENT_DEADLINE_MIN_ENQUEUE_INTERVAL_FORCE_MS` | Tương tự khi `force: true` (mặc định 12000). |
| `PAYMENT_DEADLINE_SYNC_EMPTY_BILL_IDS_COOLDOWN_MS` | POST **không** có `billIds` — khoảng cách tối thiểu (mặc định 120000). |
| `PAYMENT_DEADLINE_ESCALATE_PAST_KY` | `false` để tắt toàn bộ: (1) xếp hàng vẫn **bỏ qua** kỳ đã có hạn; (2) worker **không** leo k+1 khi hạn trả về đã qua. Khi bật (mặc định): kỳ đã đồng bộ `ok` nhưng hạn **&lt; hôm nay (VN)** vẫn có thể được xếp hàng lại; sau `payment-due` nếu hạn vẫn quá hạn thì gọi tiếp k+1..3 (kỳ có tiền + chưa gán đại lý). |
| `CHECKBILL_INGEST_SECRET` | Xác thực ingest snapshot (Bearer / `x-api-key`). |
| `CHECKBILL_INGEST_MAX_ITEMS` / `RECEIVED_INGEST_MAX_ITEMS` | Trần số dòng items. |
| `GATEWAY_CALLBACK_URL` / `CHECKBILL_GATEWAY_CALLBACK_URL` | Callback sau ingest (tuỳ chọn). |
| `GATEWAY_CALLBACK_SECRET` / `CHECKBILL_GATEWAY_CALLBACK_SECRET` | Secret header callback (tuỳ chọn). |

Các biến khác (`PORT`, `CORS_ORIGIN`, log bridge, …) giữ theo chuẩn service hiện có.

## tool-check-bill (Excel snapshot)

- File **Có cước**: thêm 2 cột (sau Tên KH): **Kỳ EVN (tháng)**, **Kỳ EVN (năm)** — tùy chọn.
- Đọc lại: cột **F** = tháng, **G** = năm; chỉ đưa vào JSON khi **cả hai** hợp lệ.
- Batch tự điền từ `bills[0].term` dạng `MM/YYYY` khi có (MB/Shopee sau classify). Vietin: nếu `billingCycle` không khớp định dạng đó thì có thể **không** tự điền — có thể bổ sung parse sau.

## Lưu ý deploy & vận hành

1. **Thứ tự**: Nên deploy **elec-service** cùng hoặc trước **CRM** nếu có thay đổi DTO/API; gateway cần `ELEC_SERVICE_URL` trỏ đúng instance mới.
2. **Dữ liệu cũ**: Bill/staging trước bản có kỳ EVN **không** có neo — đồng bộ hạn TT vẫn dùng `month`/`year` refu. Các case lệch kỳ cần **PATCH admin** hoặc ingest/Excel có cặp.
3. **Staging cũ**: Không có field kỳ EVN cho đến khi có **lô ingest mới** hoặc tái xử lý nguồn.
4. **PERIOD_MISMATCH**: Client từ chối ghi hạn TT nếu `kyBill` trong JSON không khớp tham số đã gửi — báo lỗi có mã `PERIOD_MISMATCH`; kiểm tra neo kỳ và dữ liệu AutoCheck.
5. **Không commit** `.env`, khóa, token vào Git; đã cấu hình trên server thì chỉ cần xác nhận biến trùng tên với bảng trên.
6. **Repo liên quan** (deploy độc lập theo CI/CD từng repo): `Assign-refu-manager-service`, `fe-gateway` (CRM + gateway), `tool-check-bill`.

## Smoke test gợi ý (sau deploy)

- Một bill chưa giao có cước: gọi đồng bộ hạn TT → `paymentDeadline` / trạng thái period cập nhật hoặc lỗi có message rõ.
- Ingest một dòng có `evn_ky_bill_thang` / `evn_ky_bill_nam` → duyệt staging → bill có neo → đồng bộ dùng đúng `thang`/`nam`.
- ADMIN: PATCH cặp neo và xóa neo (`null`/`null`).

---

*Tài liệu này đi kèm commit task kỳ EVN + đồng bộ hạn thanh toán; cập nhật khi có thay đổi hành vi API hoặc env.*
