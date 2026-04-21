# Thu chi & Hoàn tiền — ghi chú xử lý sau

Tài liệu tổng hợp các **rủi ro nghiệp vụ**, **giới hạn thiết kế** và **việc cần làm thêm** liên quan bảng thu chi, phân bổ vào màn Hoàn tiền, gateway/FE, audit. Dùng làm checklist khi bạn rảnh xử lý tiếp.

---

## 1. Phân bổ tổng `Chi` theo tỷ lệ (mô hình hiện tại)

- **Hiện trạng:** Tổng cột **Chi** của đại lý (khi Nguồn = `Agency.code`) được **chia theo tỷ lệ** trọng số ≈ **Hoàn** (số tiền − thành phí) trên **tất cả** dòng mail-queue của đại lý đó.
- **Rủi ro:** Không gắn 1-1 với **từng Mã KH / từng kỳ bill** — nếu nghiệp vụ thực tế cần bút toán đúng từng dòng, cần bổ sung (ví dụ: neo `billId` + `ky` trên bút toán thu chi, hoặc quy tắc phân bổ khác).

**Việc sau:** Chốt quy tắc với kế toán; nếu cần neo bill → thiết kế schema + API + migration.

---

## 2. Thu chi không theo kỳ / `txnDate`

- **Hiện trạng:** Khi tính mail-queue, mọi dòng thu chi có `Chi > 0` và neo đại lý đều **cộng vào một pool** — **không** lọc theo ngày giao dịch hay tháng hóa đơn.
- **Rủi ro:** Báo cáo theo kỳ có thể **lệch thời điểm** so với kỳ hoàn tiền trên UI.

**Việc sau:** Thêm filter (query param mail-queue, hoặc field kỳ trên `AccountingThuChiEntry`) và/hoặc báo cáo riêng theo `txnDate`.

---

## 3. Trùng ý nghĩa tiền (thu chi + nhập tay Mongo)

- **Hiện trạng:** `daHoan` trong Mongo là **nhập tay**; `daHoanFromThuChi` / `daHoanTotal` là **cộng thêm** từ thu chi. Cùng một khoản chi có thể được phản ánh **hai lần** nếu vận hành không tách bạch.
- **Đã có:** Cảnh báo `refundWarnings` trên GET mail-queue; UI tách cột **Từ thu chi** / **Nhập tay** / **Tổng**; xác nhận khi sửa tay nếu có phân bổ thu chi.

**Việc sau:** Quy trình nội bộ (chỉ một nguồn “đã chi” hoặc chỉ nhập tay phần chênh); training kế toán.

---

## 4. Khớp đại lý theo **tên** (không phải code trên dòng bill)

- **Hiện trạng:** Phân bổ gom theo `normalizeTextKey(tên đại lý)` sau khi resolve tên từ `Agency` theo `linkedAgencyId`. Dòng hóa đơn dùng `assignedAgencyName`.
- **Rủi ro:** Tên bill ≠ tên Agency (sai chính tả, đổi tên) → **không** khớp pool thu chi với đúng nhóm dòng.

**Việc sau:** Chuẩn hóa tên khi giao mã; hoặc lưu `agencyId` trên bill/period và gom theo id thay vì tên.

---

## 5. Hiệu năng PATCH `refund-line-states`

- **Hiện trạng:** Payload FE thường luôn có field `daHoan` → backend có thể chạy **full snapshot** mail-queue để lấy `thuChiByLine` mỗi lần PATCH (đúng logic, có thể nặng khi dữ liệu lớn).

**Việc sau:** Cache snapshot TTL ngắn; hoặc chỉ build `thuChiByLine` khi body thực sự thay đổi `daHoan` so với bản đọc trước (cần thiết kế kỹ).

---

## 6. Audit sau upsert (đã xử lý một phần)

- **Hiện trạng:** `writeAuditLog` bọc **try/catch** — lỗi audit **không** làm fail PATCH sau khi Mongo đã lưu; lỗi ghi `console.error`.
- **Việc sau:** Theo dõi log container / đưa vào shared-logger đúng schema; alert khi audit fail lặp lại.

---

## 7. Trùng `billId` + `ky` trong cùng batch PATCH (đã xử lý)

- **Hiện trạng:** Gom cảnh báo 409 theo khóa dòng để không lặp `lines` trong response.

**Việc sau:** Có thể từ chối hẳn batch nếu có trùng key (400) — nếu muốn siết hơn.

---

## 8. Màn CRM — bảng thu chi CRUD

- **Hiện trạng:** Backend + gateway RBAC + proxy đã có (`/api/accounting/thu-chi`). Màn Hoàn tiền đã tích hợp đọc phân bổ + nhập tay.
- **Chưa chắc đã có:** Trang UI riêng **quản lý thu chi** (danh sách / form) trên CRM — nếu cần, thêm route + gọi API đã expose.

**Việc sau:** Thiết kế màn Thu chi (list/filter/from-to/export) và gọi `electricityPaymentCodeAssignmentService` (hoặc service tương đương) tới `/api/accounting/thu-chi`.

---

## 9. Liên quan deploy / env

- Gateway cần `ELEC_SERVICE_URL` và rule RBAC `refund:view` cho `/api/accounting/thu-chi`.
- Log bridge: `LOG_BRIDGE_URL` + secret (theo cấu hình hiện tại) để audit CRM nhận event `elec.*`.

---

*Tạo để xử lý dần; cập nhật file này khi đã đóng từng mục.*
