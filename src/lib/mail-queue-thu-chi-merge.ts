import type { MailQueueLineDto, RefundLineStateDto } from "@/types/electric-bill";
import { normalizeTextKey } from "@/lib/refund-fee-resolve";
import { refundAnchorDateUtc } from "@/lib/refund-anchor-date";
import type { AccountingThuChiLean } from "@/modules/accounting-thu-chi/accounting-thu-chi.repository";

function lineKeyFromParts(billId: string, ky: number, splitPart?: 0 | 1 | 2) {
  const sp = splitPart === 1 || splitPart === 2 ? splitPart : 0;
  return sp === 0 ? `${billId}_k${ky}` : `${billId}_k${ky}_s${sp}`;
}

function toDdMmFromDateInHoChiMinh(d: Date): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(d);
  const dd = parts.find((p) => p.type === "day")?.value ?? "";
  const mm = parts.find((p) => p.type === "month")?.value ?? "";
  if (!dd || !mm) return null;
  return `${dd}/${mm}`;
}

function lineDateKeyDdMm(line: MailQueueLineDto): string | null {
  const anchor = refundAnchorDateUtc({
    year: line.year,
    month: line.month,
    scanDdMm: line.scanDdMm,
    dealCompletedAt: line.dealCompletedAt,
  });
  if (Number.isNaN(anchor.getTime())) return null;
  return toDdMmFromDateInHoChiMinh(anchor);
}

/**
 * Cộng phân bổ Chi (thu chi, Nguồn = mã đại lý) vào từng dòng refundLineStates.
 * Ghép dòng mail-queue qua `billId` + `ky` (không phụ thuộc thứ tự mảng).
 *
 * `agencyCurrentNameById`: tên đại lý đọc lại từ DB tại thời điểm gọi (ObjectId string → name),
 * tránh lệch khi đổi tên đại lý sau khi ghi bút toán (linkedAgencyName trong bút toán là snapshot).
 */
export function mergeThuChiAllocationsIntoRefundStates(
  lines: MailQueueLineDto[],
  resolvedLineStates: RefundLineStateDto[],
  chiEntries: AccountingThuChiLean[],
  agencyCurrentNameById: Map<string, string>
): void {
  const lineByKey = new Map<string, MailQueueLineDto>();
  for (const line of lines) {
    lineByKey.set(lineKeyFromParts(line.billId, line.ky, line.splitPart), line);
  }

  for (const s of resolvedLineStates) {
    s.daHoanFromThuChi = 0;
    s.daHoanTotal = s.daHoan;
  }

  /** Danh sách từng dòng Chi theo agency + dd/mm để gán 1-1 xuống bảng Hoàn tiền. */
  const chiRowsByAgencyDate = new Map<string, number[]>();
  for (const e of chiEntries) {
    if (e.haCuocContext != null) continue;
    const idStr = e.linkedAgencyId ? String(e.linkedAgencyId) : "";
    const nameFromDb = idStr ? (agencyCurrentNameById.get(idStr) ?? "").trim() : "";
    const name = nameFromDb || String(e.linkedAgencyName ?? "").trim();
    if (!name) continue;
    const effectiveDate = e.effectivePaymentDate ?? e.txnDate;
    const dateKey = toDdMmFromDateInHoChiMinh(new Date(effectiveDate));
    if (!dateKey) continue;
    const key = `${normalizeTextKey(name)}__${dateKey}`;
    const c = typeof e.chi === "number" ? Math.trunc(e.chi) : 0;
    if (c <= 0) continue;
    const arr = chiRowsByAgencyDate.get(key) ?? [];
    arr.push(c);
    chiRowsByAgencyDate.set(key, arr);
  }

  const lineIndicesByAgencyDate = new Map<string, number[]>();
  for (let i = 0; i < resolvedLineStates.length; i++) {
    const st = resolvedLineStates[i];
    const line = lineByKey.get(lineKeyFromParts(st.billId, st.ky, st.splitPart));
    const dateKey = line ? lineDateKeyDdMm(line) : null;
    if (!dateKey) continue;
    const key = `${normalizeTextKey(st.agencyName)}__${dateKey}`;
    const arr = lineIndicesByAgencyDate.get(key) ?? [];
    arr.push(i);
    lineIndicesByAgencyDate.set(key, arr);
  }

  for (const [agencyDateKey, chiRows] of chiRowsByAgencyDate) {
    const indices = lineIndicesByAgencyDate.get(agencyDateKey) ?? [];
    if (indices.length === 0 || chiRows.length === 0) continue;

    // Không phân bổ theo trọng số nữa: hiển thị theo từng dòng Chi đã nhập ở Thu chi (agency + ngày).
    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j];
      const add = chiRows[j] ?? 0;
      const cur = resolvedLineStates[idx];
      cur.daHoanFromThuChi = add;
      cur.daHoanTotal = cur.daHoan + add;
    }

    // Nếu số dòng Chi > số dòng hoàn tiền cùng ngày, dồn phần dư vào dòng cuối để không thất thoát tổng.
    if (chiRows.length > indices.length) {
      const tail = indices[indices.length - 1];
      if (tail !== undefined) {
        let overflow = 0;
        for (let k = indices.length; k < chiRows.length; k++) overflow += chiRows[k] ?? 0;
        if (overflow > 0) {
          const cur = resolvedLineStates[tail];
          cur.daHoanFromThuChi = (cur.daHoanFromThuChi ?? 0) + overflow;
          cur.daHoanTotal = cur.daHoan + (cur.daHoanFromThuChi ?? 0);
        }
      }
    }
  }
}

/** Cảnh báo tài chính sau khi đã gắn phân bổ thu chi lên refundLineStates */
export function buildRefundFinancialWarnings(states: RefundLineStateDto[]): string[] {
  const warns: string[] = [];
  let doubleCountLines = 0;
  for (const s of states) {
    const fromTc = s.daHoanFromThuChi ?? 0;
    if (fromTc > 0 && s.daHoan > 0) doubleCountLines += 1;
  }
  if (doubleCountLines > 0) {
    warns.push(
      `Có ${doubleCountLines} dòng vừa có tiền từ bảng thu chi (Nguồn = mã đại lý, cột Chi) vừa có «Đã hoàn nhập tay» trong cơ sở dữ liệu — nguy cơ cộng trùng khoản chi. Nên chỉ nhập tay phần chênh lệch (nếu có) sau khi đối chiếu với thu chi, hoặc xóa nhập tay nếu thu chi đã đủ.`
    );
  }
  return warns;
}
