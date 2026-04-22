# Checkbill ingest: lọc trùng sau hạ cước (split1 / split2)

Tài liệu tra cứu khi nghi vấn dòng nào **vào / không vào** bảng Quét cước (staging) sau khi ingest từ tool checkbill.

## Bối cảnh nghiệp vụ

- Duyệt từ Quét cước ghi **`BillingScanHistory`** với cặp `(mã KH, số tiền, scannedAt)`.
- **Hạ cước** tạo bản ghi `SplitBillEntry` với `split1.amount` và `split2.amount` (một phần thường là “còn lại”), **không** tạo thêm từng dòng lịch sử quét tương ứng từng phần.
- Dịch vụ quét có thể đẩy lại snapshot với **đúng số từng phần**; bộ lọc theo lịch sử cũ (chỉ khớp tổng lần duyệt trước) có thể **không** bắt được → cần lớp chặn bổ sung.

## Thứ tự xử lý trong `ingestChargesSnapshot` (cố định)

1. **Trùng trong cùng payload** — cùng `maKh` + `soTienVnd` (sau chuẩn hóa) chỉ giữ một dòng.
2. **Trùng theo lịch sử duyệt** — `filterExistingFromApprovedHistory`: đã từng có `BillingScanHistory` cùng **tháng lịch `scannedAt` (theo `completedAt` snapshot, UTC)** và cùng cặp `(mã, số)` → bỏ.
3. **Trùng theo từng phần hạ cước (bổ sung)** — `filterIngestMatchingSplitPartAmounts`: cùng **tháng hóa đơn** với tạo HĐ từ quét (xem dưới) và số tiền khớp **`split1.amount` hoặc `split2.amount`** trên bản ghi tách với `status !== "cancelled"` → bỏ.
4. Ghi/upsert staging; trùng `dedupeHash` đã có trên bảng staging → không tăng dòng mới (đếm trong tổng trùng).

## Căn tháng / năm (quan trọng)

- Tạo/cập nhật hóa đơn từ quét (`upsertBillFromChargeItem`) dùng:  
  `year = completedAt.getUTCFullYear()`, `month = completedAt.getUTCMonth() + 1` (1–12).
- Lọc split dùng **cùng** cặp `(year, month)` với `findBillsByYearMonth(year, month)`.
- **Sang tháng mới (refu khác)** = bản ghi `ElectricBillRecord` khác → **không** tự dính chặn từ tách ở tháng cũ (trừ khi cùng tháng refu theo cách tính trên).

> Nếu `completed_at` của snapshot lệch UTC kỳ với nghiệp vụ “tháng hóa đơn” mong muốn, mọi bước dùng `completedAt` (lịch sử, lọc split, tạo HĐ) đều cùng giả định — đây là ràng buộc chung từ trước, không phát sinh từ riêng tính năng split.

## Điều kiện chặn theo hạ cước (đã triển khai)

- Lấy mọi `SplitBillEntry` gắn `originalBillId` thuộc hóa đơn tháng đang xét, **`status` không phải `cancelled`** (gồm `active` và `resolved`).
- Thêm khóa chặn (cùng quy ước với cột staging): `chargeDedupeKey(mã, số_tiền_làm_tròn)` cho từng `split1.amount`, `split2.amount` dương.
- Dòng ingest bị loại nếu khóa trùng khóa chặn.

**Cố tình không** dùng `originalAmount` (tổng trước tách) để tránh bỏ nhầm bản ghi mới vốn tình cờ cùng số với tổng cũ nhưng là **kỳ / nội dung khác** (so với tách một kỳ).

## Hạn chế & ngoại lệ (cần biết khi vận hành)

| Tình huống | Hệ quả / rủi ro |
|------------|-----------------|
| **Hai nghiệp vụ cùng tháng, cùng số VND tình cờ** (ví dụ kỳ 2 hợp lệ cùng trị số với `split2` của hạ cước) | Có thể bị chặn nhầm dòng mới. Xác suất thấp (số lớn, đơn vị VND) nhưng **khác 0**. |
| **Đã `resolved` split** vẫn bị chặn theo `split1`/`split2` | Nếu vẫn cần “đẩy lại” cùng số từng phần trong cùng tháng, logic hiện tại sẽ **không** cho vào staging — có thể cần bổ sung nghiệp vụ/điều chỉnh dữ liệu (kỳ tới, sửa tay, v.v.). |
| **Hủy tách** (`status = cancelled`) | Các số từng phần **không** còn trong tập chặn — quét lại cùng số **có thể** quay lại staging. |
| **Mã KH hoa thường** | Hệ thống chuẩn hóa theo cách dùng `chargeDedupeKey` (UPPER) và so với mã trên hóa đơn từ DB; cần thống nhất dữ liệu mã trên hóa đơn. |

## API response / audit

- Trong `data` trả về khi ACK thành công: `splitPartDuplicateDropped` = số dòng bỏ ở bước (3) (không bao gồm trùng payload hay trùng lịch sử, nhưng `duplicateRowsDropped` là tổng tất cả loại trùng).
- Audit metadata ingest có thể ghi thêm `splitPartDuplicateCount` (theo bản triển khai tại thời điểm deploy).

## Hướng cải tiến (chưa bắt buộc)

- Nếu mọi dòng ingest đều có `evn_ky_bill_thang` + `evn_ky_bill_nam` tin cậy, có thể thu hẹp chặn: chỉ bỏ khi trùng số từng phần **và** cùng neo kỳ EVN với kỳ gốc bị tách (giảm rủi ro trùng số tình cờ giữa hai kỳ thật).

## File code chính

- `src/modules/checkbill-ingest/checkbill-ingest.service.ts` — `filterIngestMatchingSplitPartAmounts`, tích hợp sau `filterExistingFromApprovedHistory`.
- `src/modules/electric-bills/electric-bills.repository.ts` — `findNonCancelledSplitsByOriginalBillIds`.
- `src/lib/checkbill-charge-upsert.ts` — `chargeDedupeKey` (cùng quy ước khóa với staging).

---

*Cập nhật theo triển khai phòng trùng từng phần hạ cước trên luồng ingest checkbill.*
