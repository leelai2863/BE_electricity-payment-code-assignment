# Ghi chú: đồng bộ hạn thanh toán EVN đa kỳ (k1–k3) & hiển thị CRM

Tài liệu này tóm tắt **vấn đề đã gặp**, **nguyên nhân**, **hướng xử lý hiện tại** (đến ~04/2026) và **hướng tối ưu có thể làm sau** — phục vụ nghiên cứu tiếp, không thay thế code.

## Bối cảnh

- Worker: `src/modules/electric-bills/payment-deadline-sync.service.ts`
- API xếp hàng: `POST /electric-bills/unassigned/payment-deadline-sync` (controller: `electric-bills.controller.ts`)
- AutoCheck: `GET .../payment-due?region=&ky=&thang=&nam=`
- CRM “Giao mã”: `fe-gateway/core-x-crm-frontend/src/components/electric/AssignCodesModule.tsx` (cột Hạn TT, modal Force)

## Các sự cố đã xác định

### 1. Modal Force một mã nhưng AutoCheck log cả loạt mã

- **Triệu chứng:** UI gửi `targeted: { billId, ky, billingThang, billingNam }` nhưng log AutoCheck quét nhiều `customerCode`.
- **Nguyên nhân:** `postUnassignedPaymentDeadlineSyncHandler` **không** truyền `targeted` xuống `enqueueUnassignedPaymentDeadlineSync` → body không có `billIds` → nhánh **quét toàn bộ** `findUnassignedCandidateBills()`.
- **Sửa:** Parse `body.targeted` và truyền vào service; `targeted` không hợp lệ → 400.

### 2. Chỉ thấy `ky=1` trên AutoCheck dù đã “leo kỳ”

- **Nguyên nhân (sớm):** Vòng gọi `payment-due` **return sớm** khi một kỳ lỗi (vd. 404), không thử kỳ tiếp theo.
- **Nguyên nhân (sau):** Với `k > startKy`, nếu kỳ đó trên Mongo **đã giao đại lý** thì `continue` **không gọi** EVN — log không có ky2/3.
- **Sửa:** Lỗi từng kỳ không dừng vòng (trừ điều kiện startKy); kỳ cao hơn vẫn gọi `payment-due` dù CRM đã giao kỳ đó.

### 3. Đã có `ky=2` 200 nhưng cột “Hạn TT” vẫn như kỳ 1

Hai lớp:

**A. Lưu DB sau khi chọn “kỳ thắng” ≠ `job.ky`**

- Khi `finalKy` (vd. 2) thắng nhưng job chạy từ `job.ky === 1`, code cũ **khôi phục** kỳ 1 bằng `syncFieldsSnapshot(period)` → giữ nguyên `paymentDeadline` cũ trên kỳ 1.
- Cột Hạn TT trên CRM chọn kỳ có **hạn muộn nhất** trong pool “chờ giao có tiền” → kỳ 1 vẫn thắng so sánh ngày.
- **Sửa:** Nếu `finalKy !== job.ky`, **không** khôi phục hạn cũ trên `job.ky`; xóa `paymentDeadline` + trường đồng bộ EVN trên kỳ job để không “cạnh tranh” với kỳ thắng.

**B. Pool hiển thị chỉ gồm kỳ có `amount`**

- Ví dụ thực tế: kỳ 1 có tiền + hạn 14/4; kỳ 2 **không có amount** nhưng có `evnPaymentDeadlineSyncStatus: ok` và hạn 24/4.
- `assignTablePrimaryPeriod` cũ chỉ lấy kỳ **chờ giao có tiền** → bỏ qua kỳ 2 → luôn hiện kỳ 1.
- **Sửa CRM:** Đưa vào pool các kỳ chờ giao có **(tiền) hoặc (EVN ok + có `paymentDeadline`)**; khi nhiều kỳ có hạn → **ưu tiên `ky` cao hơn** (khớp “nguồn sự thật” đa kỳ).

### 4. Chọn “kỳ thắng” giữa nhiều response 200

- **Cũ:** Chọn bản có `hanThanhToan` **theo lịch muộn nhất** (rồi tie-break `ky`).
- **Vấn đề nghiệp vụ:** EVN có thể coi **kỳ sau** là chuẩn dù ngày hạn không phải muộn nhất trên lịch.
- **Hiện tại:** Nếu **một** kỳ 200 → dùng kỳ đó. Nếu **≥ hai** kỳ 200 → chọn **`ky` lớn nhất** (không so ngày giữa các kỳ).

## Hành vi hiện tại (tóm tắt)

| Thành phần | Hành vi |
|------------|---------|
| Escalate (env `PAYMENT_DEADLINE_ESCALATE_PAST_KY`) | Gọi tuần tự `startKy…3`, gom mọi 200, chọn **max ky** nếu ≥2 bản 200. |
| Lưu Mongo | Ghi hạn + sync vào `finalKy`; nếu khác `job.ky` thì xóa hạn/sync kiểu cạnh tranh trên `job.ky`. |
| CRM cột Hạn TT | Pool: chờ giao ∧ (có tiền ∨ EVN ok có hạn); chọn hiển thị: **ky cao nhất** trong các kỳ có `paymentDeadline`. |
| Force modal | Phải đi qua controller với `targeted` để chỉ enqueue một bill. |

## Hướng nghiên cứu / tối ưu sau (gợi ý)

1. **Policy có cấu hình:** Tách `PAYMENT_DEADLINE_WINNER_STRATEGY = max_ky | latest_date | hybrid` (vd. hybrid: ưu tiên max ky chỉ khi các kỳ cùng tháng/năm billing; hoặc chỉ khi `kyBill` khớp refu).
2. **So ngày theo múi giờ VN:** Mọi so sánh “muộn nhất” nên thống nhất `Asia/Ho_Chi_Minh` (calendar day) thay vì `Date.parse` thuần nếu một ngày tái dùng rule `latest_date`.
3. **Đồng bộ `amount` kỳ phụ:** Khi EVN chỉ ra rõ kỳ đang phát hành, có nên backfill `amount` cho kỳ 2/3 từ tiền kỳ 1 (fingerprint) hay để trống — ảnh hưởng báo cáo và filter tiền.
4. **Nhiều kỳ đồng thời “đúng” trên EVN:** Trường hợp k1/k2 là hai đợt cước khác nhau (hai hạn hợp lệ); hiện UI chỉ một “primary” deadline — có cần hiển thị **đủ cột theo kỳ** thay vì một ô tổng hợp?
5. **Revert / snapshot:** Khi `revertOnFailure`, kiểm tra snapshot đa kỳ có cần khôi phục cả kỳ đã clear hay không.
6. **Test tự động:** Unit test cho `resolvePaymentDueWithPastKyEscalation` (mock client) và cho `assignTablePrimaryPeriod` (fixture JSON như ticket thực tế).

## Tham chiếu code

- `payment-deadline-sync.service.ts` — `resolvePaymentDueWithPastKyEscalation`, `runOneJob`, `enqueueUnassignedPaymentDeadlineSync`
- `electric-bills.controller.ts` — `postUnassignedPaymentDeadlineSyncHandler` (`targeted`)
- `AssignCodesModule.tsx` — `assignTablePrimaryPeriod`, Force modal → `submitForceEvnTargetedSync`

## Chuẩn hóa slot tiền theo kỳ EVN (sau ~04/2026)

Khi ô `finalKy` **chưa có `amount`**, worker chọn **kỳ nguồn** (`pickSourceKyForRelocateToFinalKy`): ưu tiên `job.ky` nếu có tiền, không thì kỳ chờ giao có tiền nhỏ nhất khác `finalKy` — rồi `relocateUnassignedBillingSourceKyToTargetKy` gom tiền + meta quét sang `finalKy` (tránh tách dòng: tiền k1 / hạn k2 khi `job.ky === finalKy` hoặc tiền vẫn nằm k1).

CRM: cột **Kỳ** (trước là “EVN”) ưu tiên hiển thị kỳ có `evnPaymentDeadlineSyncStatus: ok` + hạn, **ky cao nhất**; chưa đồng bộ thì fallback theo các kỳ có tiền chờ giao.

### Sửa dữ liệu Mongo đã lệch (một lần)

Worker khi đồng bộ hạn TT **đã ghi Mongo** (không chỉ UI). Các bản ghi sai **trước** khi deploy bản relocate / repair cần **chạy lại sync** hoặc chạy script:

`npm run migrate:normalize-evn-period-slots` — mặc định **dry-run** (chỉ log). Ghi DB: `MIGRATE_APPLY=true` rồi chạy lại (cùng `MONGODB_URI`). Hàm `repairSplitBillAmountIntoEvnTruthKySlot` export từ `payment-deadline-sync.service.ts`.

## Liên quan

- `docs/task-evn-ky-bill-payment-deadline-sync.md` — mô tả luồng tổng thể task.
